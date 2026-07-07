// The presentation-layer orchestrator: owns the ONLY mutable reference to the
// world, translates device-agnostic intents into sim commands, drives enemy
// AI (as ENEMY_STRIKE commands — the sim never acts on its own), and manages
// modals. Modals pause the overworld but never the loop itself; every modal
// dismissal funnels through one closeModal() so no stale flags survive.

import { makeWorld } from '../sim/world.js';
import { reduce } from '../sim/reduce.js';
import { CONTENT } from '../sim/content.js';
import { exportSaga } from '../sim/saga.js';
import { readonly } from './readonly.js';
import { makeInput } from './input.js';
import { render } from './renderer.js';
import { saveGame, clearSave } from './save.js';
import { nightAmount } from './daynight-tint.js';
import { describeObjective } from './objective-text.js';

const MOVE_REPEAT_MS = 140;
const TICK_MS = 500;
const DODGE_MS = 400;       // i-frames = withholding ENEMY_STRIKE this long
const ENEMY_CD_MS = 900;
const MAX_FRAME_MS = 100;   // cap max delta or any stall becomes chaos

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function startGame(canvas, seed, options = {}, initialWorld = null) {
  const ctx = canvas.getContext('2d');
  const input = makeInput(canvas);

  let world = initialWorld || makeWorld(seed, options);
  let ro = readonly(world);
  const view = {
    px: world.player.x, py: world.player.y,
    toasts: [], modal: null, dodging: false, device: 'keyboard',
    guide: '', shakeX: 0, shakeY: 0, punch: {}, playerPunch: 0, night: 0,
  };
  // The vale greets you once — but not a run resumed from a save.
  if (!initialWorld) {
    view.modal = {
      kind: 'dialog', title: 'PROLOGUE',
      lines: CONTENT.arc.intro,
      buttons: [{ id: 'confirm', label: 'Begin' }],
    };
  }
  let nextMoveAt = 0, nextTickAt = 0, dodgeUntil = 0;
  let nextChargeAt = 0, wasCharging = false;
  const CHARGE_TICK_MS = 100; // press-and-hold cadence — see reduce.js for the rate curve
  const enemyCd = {};
  let last = 0, frameNow = 0;

  // Juice: additive presentation-only feedback, driven by sim EVENTS, never
  // by writes to state. Hit-stop briefly freezes gameplay LOGIC (not the
  // render loop, so shake/decay still animate) — the pause is what sells an
  // impact as costing something. Screen shake and per-entity "punch" (a
  // squash pulse) are pure cosmetic reactions to what already happened.
  let hitStopUntil = 0, shakeUntil = 0, shakeStart = 0, shakeMag = 0;
  const PUNCH_MS = 160, PLAYER_PUNCH_MS = 120;
  const punchUntil = {};
  let playerPunchUntil = 0;
  function hitStop(ms) { hitStopUntil = Math.max(hitStopUntil, frameNow + ms); }
  function shake(mag, ms) {
    if (frameNow + ms >= shakeUntil) { shakeStart = frameNow; shakeUntil = frameNow + ms; }
    shakeMag = Math.max(shakeMag, mag);
  }
  function punch(id) { punchUntil[id] = frameNow + PUNCH_MS; }
  function playerPunch() { playerPunchUntil = frameNow + PLAYER_PUNCH_MS; }

  function dispatch(cmd) {
    const events = reduce(world, cmd);
    for (const e of events) onEvent(e);
    if (!world.flags.ended) saveGame(world);
    return events;
  }

  function toast(text) {
    view.toasts.unshift({ text, ttl: 2600 });
    if (view.toasts.length > 4) view.toasts.pop();
  }

  function closeModal() {
    view.modal = null; // single dismissal path — nothing else to restore, by design
  }

  function onEvent(e) {
    switch (e.type) {
      case 'talked': {
        const npc = world.npcs[e.npc];
        // Presentation text (dialog) comes from CONTENT; sim state stays lean.
        const lines = CONTENT.regions[world.region.id].npcs[e.npc]?.dialog || [];
        if (npc.shop && npc.shop.length) {
          const itemId = npc.shop[0];
          const item = world.items[itemId];
          view.modal = {
            kind: 'shop', itemId, title: npc.name,
            lines: [
              ...lines,
              `${item.name} — heals ${item.heal} HP — ${item.price} coins. You have ${world.player.coins}.`,
            ],
            buttons: [
              { id: 'confirm', label: `Buy ${item.name}` },
              { id: 'alt', label: `Drink ${item.name}` },
              { id: 'cancel', label: 'Leave' },
            ],
          };
        } else if (!view.modal) {
          view.modal = {
            kind: 'dialog', title: npc.name,
            lines,
            buttons: [{ id: 'cancel', label: 'Close' }],
          };
        }
        break;
      }
      case 'quest_offered': {
        const def = world.quests.defs[e.quest];
        view.modal = {
          kind: 'offer', quest: e.quest, title: `Quest: ${e.quest}`,
          lines: [
            ...def.objectives.map(describeObjective),
            `Reward: ${def.reward.coins} coins`,
            'No pressure — the offer stands if you walk away.',
          ],
          buttons: [
            { id: 'confirm', label: 'Accept' },
            { id: 'cancel', label: 'Later' },
          ],
        };
        break;
      }
      case 'enemy_appeared': toast(`A ${e.kind} emerges onto the road.`); break;
      case 'pickup_appeared': toast(`Something glints nearby.`); break;
      case 'picked_up': toast(`Picked up ${e.item}`); break;
      case 'broke': toast(`Crate smashed — +${e.coins} coins`); punch(e.target); shake(2, 90); break;
      case 'enemy_hit':
        toast(`Hit for ${e.dmg}`);
        punch(e.target);
        if (e.kind === 'melee' || e.kind === 'aura') playerPunch();
        hitStop(e.kind === 'aura' ? 70 : 45);
        shake(Math.min(6, 2 + e.dmg * 0.6), 120);
        break;
      case 'no_effect':
        // Distinct from enemy_hit: the attack landed but the target is
        // immune to this attack kind (e.g. an aura-warded husk shrugging
        // off a blast) — a clear refusal, not a silent no-op, but lighter
        // than a real hit (no hitstop/shake).
        toast('No effect — try a different approach.');
        punch(e.target);
        break;
      case 'enemy_defeated':
        toast(`${e.kind} defeated!`);
        hitStop(90);
        shake(5, 160);
        if (e.target === world.arc.bossDef.id) {
          view.modal = {
            kind: 'fate', title: 'It kneels, beaten',
            lines: ['The Ravager is finished either way.', 'What are you?'],
            buttons: [
              { id: 'confirm', label: 'Spare it' },
              { id: 'alt', label: 'Finish it' },
            ],
          };
        }
        break;
      case 'player_hit':
        toast(`Took ${e.dmg} damage`);
        hitStop(60);
        shake(Math.min(8, 3 + e.dmg * 0.7), 180);
        break;
      case 'skill_up': toast(`${e.skill} rose to ${e.lvl}!`); break;
      case 'objective_progress': toast(`${e.quest}: ${e.at}/${e.of}`); break;
      case 'quest_completed': toast(`Quest complete! +${e.reward.coins} coins`); break;
      case 'healed': toast(`Recovered — HP ${e.hp}`); break;
      case 'bought': toast(`Bought — ${e.coins} coins left`); break;
      case 'no_aura': toast('Not enough aura — Charge first'); break;
      case 'too_far': toast('Too far away'); break;
      case 'cant_afford': toast('Not enough coins'); break;
      case 'no_item': toast('Nothing to drink'); break;
      case 'player_defeated':
        view.modal = {
          kind: 'defeat', title: 'You fall...',
          lines: ['The vale goes quiet.'],
          buttons: [{ id: 'confirm', label: 'Rise Again' }],
        };
        break;
      case 'exit_locked': toast('The gate is sealed. You are not done here.'); break;
      case 'boss_appeared':
        shake(10, 450);
        hitStop(150);
        view.modal = {
          kind: 'dialog', title: 'The Ravager',
          lines: CONTENT.arc.bossAppeared,
          buttons: [{ id: 'confirm', label: 'Stand' }],
        };
        break;
      case 'mentor_fallen':
        shake(8, 300);
        hitStop(150);
        view.modal = {
          kind: 'dialog', title: 'Oren falls',
          lines: CONTENT.arc.mentorFallen,
          buttons: [{ id: 'confirm', label: 'Alone' }],
        };
        break;
      case 'prologue_complete': {
        clearSave(); // nothing left to continue into — the run is finished
        const code = exportSaga(world);
        view.modal = {
          kind: 'finale', title: 'THE VALE FALLS BEHIND', code,
          lines: [
            ...CONTENT.arc.finale,
            '',
            CONTENT.arc.exportHint,
            code,
          ],
          buttons: [{ id: 'confirm', label: 'Copy code' }],
        };
        break;
      }
    }
  }

  // Nearest living/available entity of a kind within range.
  function nearest(map, range, ok = () => true) {
    let best = null, bestD = range + 1;
    for (const id of Object.keys(map).sort()) {
      const e = map[id];
      if (!ok(e)) continue;
      const d = dist(world.player, e);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  function handleModal(presses) {
    const m = view.modal;
    if (presses.confirm || (m.kind !== 'shop' && presses.interact)) {
      if (m.kind === 'offer') { dispatch({ type: 'ACCEPT_QUEST', questId: m.quest }); closeModal(); toast('Quest accepted'); }
      else if (m.kind === 'shop') { dispatch({ type: 'BUY', itemId: m.itemId }); }
      else if (m.kind === 'defeat') { world = makeWorld(seed, options); ro = readonly(world); closeModal(); toast('A new dawn'); }
      else if (m.kind === 'fate') { dispatch({ type: 'CHOOSE_FATE', fate: 'spare' }); closeModal(); toast('You walk away. It watches you go.'); }
      else if (m.kind === 'finale') {
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(m.code).catch(() => {});
        toast('Code copied. See you in Part II.');
      }
      else closeModal();
      return;
    }
    if (presses.alt || presses.blast) {
      if (m.kind === 'shop') dispatch({ type: 'USE_ITEM', itemId: m.itemId });
      else if (m.kind === 'fate') { dispatch({ type: 'CHOOSE_FATE', fate: 'finish' }); closeModal(); toast('It ends here.'); }
      return;
    }
    if (presses.cancel || presses.dodge) {
      if (m.kind === 'fate' || m.kind === 'defeat') return; // the choice won't be dismissed
      closeModal();
    }
  }

  function handleWorld(now, move, presses, chargeHeld) {
    if (presses.dodge) { dodgeUntil = now + DODGE_MS; toast('Dodge!'); }

    if (move.dx || move.dy) {
      if (now >= nextMoveAt) {
        dispatch({ type: 'MOVE', dx: move.dx, dy: move.dy });
        nextMoveAt = now + MOVE_REPEAT_MS;
      }
    } else {
      nextMoveAt = 0; // released: next press moves instantly
    }

    if (presses.attack) {
      const id = nearest(world.enemies, 1, (e) => e.alive);
      if (id) dispatch({ type: 'MELEE', enemyId: id });
      else toast('No enemy in reach');
    }
    if (presses.blast) {
      const id = nearest(world.enemies, 3, (e) => e.alive);
      if (id) dispatch({ type: 'AURA_BLAST', enemyId: id });
      else toast('No enemy in range');
    }
    // Press-and-hold: a fresh hold always fires immediately (start:true
    // resets the sim's ramp), then repeats at a fixed real-time cadence for
    // as long as the button stays down. A quick tap still charges a little —
    // it just doesn't reward mashing.
    if (chargeHeld) {
      if (!wasCharging || now >= nextChargeAt) {
        dispatch({ type: 'CHARGE', start: !wasCharging });
        nextChargeAt = now + CHARGE_TICK_MS;
      }
    }
    wasCharging = chargeHeld;
    if (presses.interact) {
      const npcId = nearest(world.npcs, 1);
      const pickId = nearest(world.pickups, 1, (p) => !p.taken);
      const crateId = nearest(world.destructibles, 1, (d) => !d.broken);
      if (npcId) dispatch({ type: 'TALK', npcId });
      else if (pickId) dispatch({ type: 'INTERACT', pickupId: pickId });
      else if (crateId) dispatch({ type: 'BREAK', destructibleId: crateId });
      else toast('Nothing here');
    }

    // Enemy AI: adjacent living enemies strike on cooldown — unless the
    // player is inside the dodge window (that withholding IS the i-frames).
    const dodging = now < dodgeUntil;
    if (!dodging) {
      for (const id of Object.keys(world.enemies).sort()) {
        const e = world.enemies[id];
        if (!e.alive || dist(world.player, e) > 1) continue;
        if (now >= (enemyCd[id] || 0)) {
          dispatch({ type: 'ENEMY_STRIKE', enemyId: id });
          enemyCd[id] = now + ENEMY_CD_MS;
        }
      }
    }

    // Ally AI: while the mentor stands, he trades blows with the boss.
    const bossId = world.arc.bossDef.id;
    const boss = world.enemies[bossId];
    if (boss && boss.alive && world.arc.bossSpawned && !world.arc.mentorDown) {
      if (now >= (enemyCd.__ally || 0)) {
        dispatch({ type: 'ALLY_STRIKE', enemyId: bossId });
        enemyCd.__ally = now + 1200;
      }
    }

    if (now >= nextTickAt) {
      dispatch({ type: 'TICK' });
      nextTickAt = now + TICK_MS;
    }
  }

  function frame(now) {
    const dt = Math.min(now - last || 16, MAX_FRAME_MS);
    last = now;
    frameNow = now;

    const { move, presses, device, chargeHeld } = input.poll();
    view.device = input.hasTouch && device === 'keyboard' ? 'touch' : device;

    // Hit-stop: gameplay logic freezes for a few dozen ms; the frame still
    // renders, so the shake/punch from the hit that caused it plays out.
    // Freeze windows are short (45-150ms) — an instantaneous tap landing
    // inside one is a rare, low-stakes miss, not a correctness issue.
    const frozen = now < hitStopUntil;
    if (!frozen) {
      if (view.modal) handleModal(presses);
      else handleWorld(now, move, presses, chargeHeld);
    }

    // The guide line: the arc's next incomplete step, in order. One hint at
    // a time — never a checklist dump.
    const arc = world.arc;
    const order = ['move', 'talk', 'quest', 'capsule', 'crate', 'melee', 'aura', 'tonic', 'pass'];
    let guideKey = order.find((k) => !arc.steps[k]);
    if (!guideKey) {
      if (!arc.bossDefeated) guideKey = 'boss';
      else if (!arc.complete) guideKey = 'choice';
      else if (!world.flags.ended) guideKey = 'gate';
    }
    view.guide = world.flags.ended ? '' : (CONTENT.arc.guide[guideKey] || '');

    // Smooth display position — floats live here, never in the sim.
    const k = Math.min(1, dt * 0.02);
    view.px += (world.player.x - view.px) * k;
    view.py += (world.player.y - view.py) * k;
    view.dodging = now < dodgeUntil;
    for (const t of view.toasts) t.ttl -= dt;
    view.toasts = view.toasts.filter((t) => t.ttl > 0);

    // Screen shake: random jitter that eases out over its window; entirely
    // cosmetic, computed fresh each frame from `now` (no stored ambient
    // state that would need to survive save/load — it's presentation only).
    if (now < shakeUntil) {
      const span = Math.max(1, shakeUntil - shakeStart);
      const decay = Math.max(0, (shakeUntil - now) / span);
      view.shakeX = (Math.random() * 2 - 1) * shakeMag * decay;
      view.shakeY = (Math.random() * 2 - 1) * shakeMag * decay;
    } else {
      view.shakeX = 0; view.shakeY = 0; shakeMag = 0;
    }
    for (const id of Object.keys(punchUntil)) {
      const remain = punchUntil[id] - now;
      if (remain <= 0) { delete punchUntil[id]; delete view.punch[id]; }
      else view.punch[id] = Math.max(0, Math.min(1, remain / PUNCH_MS));
    }
    view.playerPunch = Math.max(0, Math.min(1, (playerPunchUntil - now) / PLAYER_PUNCH_MS));
    view.night = nightAmount(world.tick);

    input.setZones(render(ctx, ro, view));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Test hook: the harness is just another device driving the same seams.
  return {
    world: () => ro,
    dispatch,
    view,
  };
}
