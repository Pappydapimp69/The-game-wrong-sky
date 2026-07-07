// The presentation-layer orchestrator: owns the ONLY mutable reference to the
// world, translates device-agnostic intents into sim commands, drives enemy AI
// (as ENEMY_STRIKE commands — the sim never acts on its own), plays sound, and
// manages modals. Modals pause the overworld but never the loop itself; every
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
import { makeAudio } from './audio.js';

const MOVE_REPEAT_MS = 140;
const TICK_MS = 500;
const DODGE_MS = 400;
const ENEMY_CD_MS = 900;
const MAX_FRAME_MS = 100;

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function startGame(canvas, seed, options = {}, initialWorld = null) {
  const ctx = canvas.getContext('2d');
  const input = makeInput(canvas);
  const audio = makeAudio();

  let world = initialWorld || makeWorld(seed, options);
  let ro = readonly(world);
  if (world.flags.audio) audio.enable(); // a resumed save that already had sound on
  const view = {
    px: world.player.x, py: world.player.y,
    toasts: [], modal: null, dodging: false, device: 'keyboard',
    guide: '', shakeX: 0, shakeY: 0, punch: {}, playerPunch: 0, night: 0,
  };
  if (!initialWorld) {
    view.modal = {
      kind: 'dialog', title: 'WRONG SKY',
      lines: CONTENT.arc.intro,
      buttons: [{ id: 'confirm', label: 'Step through' }],
    };
  }
  let nextMoveAt = 0, nextTickAt = 0, dodgeUntil = 0;
  let nextChargeAt = 0, wasCharging = false;
  const CHARGE_TICK_MS = 100;
  const enemyCd = {};
  let last = 0, frameNow = 0, lastModalDy = 0;

  let hitStopUntil = 0, shakeUntil = 0, shakeStart = 0, shakeMag = 0;
  const PUNCH_MS = 160, PLAYER_PUNCH_MS = 120;
  const punchUntil = {};
  let playerPunchUntil = 0;
  function hitStop(ms) { hitStopUntil = Math.max(hitStopUntil, frameNow + ms); }
  function shake(mag, ms) { if (frameNow + ms >= shakeUntil) { shakeStart = frameNow; shakeUntil = frameNow + ms; } shakeMag = Math.max(shakeMag, mag); }
  function punch(id) { punchUntil[id] = frameNow + PUNCH_MS; }
  function playerPunch() { playerPunchUntil = frameNow + PLAYER_PUNCH_MS; }

  function dispatch(cmd) {
    const events = reduce(world, cmd);
    for (const e of events) onEvent(e);
    if (!world.flags.ended) saveGame(world);
    return events;
  }

  function toast(text) { view.toasts.unshift({ text, ttl: 2600 }); if (view.toasts.length > 4) view.toasts.pop(); }
  function closeModal() { view.modal = null; }

  // Aggregate the flat inventory array into a display list.
  function inventoryItems() {
    const counts = {};
    for (const id of world.player.inventory) counts[id] = (counts[id] || 0) + 1;
    return Object.keys(counts).sort().map((id) => ({
      id, name: (world.items[id] && world.items[id].name) || id,
      count: counts[id], usable: !!(world.items[id] && world.items[id].heal),
    }));
  }
  function openInventory() { view.modal = { kind: 'inventory', items: inventoryItems(), sel: 0 }; }

  function onEvent(e) {
    switch (e.type) {
      case 'talked': {
        const npc = world.npcs[e.npc];
        const lines = CONTENT.regions[world.region.id].npcs[e.npc]?.dialog || [];
        if (npc.shop && npc.shop.length) {
          const itemId = npc.shop[0];
          const item = world.items[itemId];
          view.modal = {
            kind: 'shop', itemId, title: npc.name,
            lines: [...lines, `${item.name} — heals ${item.heal} HP — ${item.price} coins. You have ${world.player.coins}.`],
            buttons: [
              { id: 'confirm', label: `Buy ${item.name}` },
              { id: 'alt', label: `Drink ${item.name}` },
              { id: 'cancel', label: 'Leave' },
            ],
          };
        } else if (!view.modal) {
          view.modal = { kind: 'dialog', title: npc.name, lines, buttons: [{ id: 'cancel', label: 'Close' }] };
        }
        break;
      }
      case 'quest_offered': {
        const def = world.quests.defs[e.quest];
        view.modal = {
          kind: 'offer', quest: e.quest, title: `Quest: ${def.name}`,
          lines: [...def.objectives.map(describeObjective), `Reward: ${def.reward.coins} coins`, 'No pressure — the offer stands if you walk away.'],
          buttons: [{ id: 'confirm', label: 'Accept' }, { id: 'cancel', label: 'Later' }],
        };
        break;
      }
      case 'enemy_appeared': toast(`A ${world.enemies[e.target] ? kindName(world.enemies[e.target].kind) : e.kind} stirs.`); break;
      case 'well_appeared': toast('A well reveals itself — attune it.'); break;
      case 'pickup_appeared': toast('Something glints nearby.'); break;
      case 'picked_up': toast(`Picked up ${prettify(e.item)}`); audio.play('pickup'); break;
      case 'attuned':
        if (e.facet === 'audio') { audio.enable(); toast('The world sounds again.'); }
        else toast(`${cap(e.facet)} returns to the world.`);
        audio.play('attune');
        shake(3, 200); hitStop(60);
        break;
      case 'broke': toast(`Broken — +${e.coins} coins`); punch(e.target); shake(2, 90); audio.play('break'); break;
      case 'enemy_hit':
        toast(`Hit for ${e.dmg}`); punch(e.target);
        if (e.kind === 'melee' || e.kind === 'aura') { playerPunch(); audio.play(e.kind); }
        hitStop(e.kind === 'aura' ? 70 : 45);
        shake(Math.min(6, 2 + e.dmg * 0.6), 120);
        break;
      case 'no_effect': toast('No effect — try the other way.'); punch(e.target); audio.play('no_effect'); break;
      case 'enemy_defeated':
        toast(`${kindName(e.kind)} defeated!`); hitStop(90); shake(5, 160); audio.play('defeat');
        if (e.target === world.arc.bossDef.id) {
          view.modal = {
            kind: 'fate', title: 'The Second kneels',
            lines: ['It is beaten either way.', 'Do you take its power, or leave it be?'],
            buttons: [{ id: 'confirm', label: 'Spare it' }, { id: 'alt', label: 'Claim its power' }],
          };
        }
        break;
      case 'player_hit': toast(`Took ${e.dmg} damage`); hitStop(60); shake(Math.min(8, 3 + e.dmg * 0.7), 180); audio.play('hurt'); break;
      case 'skill_up': toast(`${cap(e.skill)} rose to ${e.lvl}!`); break;
      case 'power_claimed': toast(`You claim the Second's aura — Aura ${e.lvl}`); break;
      case 'objective_progress': toast(`${e.at}/${e.of}`); audio.play('quest'); break;
      case 'quest_completed': toast(`Quest complete! +${e.reward.coins} coins`); audio.play('quest'); break;
      case 'healed': toast(`Recovered — HP ${e.hp}`); audio.play('heal'); break;
      case 'bought': toast(`Bought — ${e.coins} coins left`); break;
      case 'no_aura': toast('Not enough aura — Charge first'); break;
      case 'too_far': toast('Too far away'); break;
      case 'cant_afford': toast('Not enough coins'); break;
      case 'no_item': toast('Nothing to drink'); break;
      case 'nothing_there': break;
      case 'player_defeated':
        view.modal = { kind: 'defeat', title: 'You fall...', lines: ['The Reach goes quiet.'], buttons: [{ id: 'confirm', label: 'Rise Again' }] };
        break;
      case 'exit_locked': toast('The rift is sealed. You are not done here.'); break;
      case 'boss_appeared':
        shake(10, 450); hitStop(150); audio.play('boss');
        view.modal = { kind: 'dialog', title: 'The Second', lines: CONTENT.arc.bossAppeared, buttons: [{ id: 'confirm', label: 'Stand' }] };
        break;
      case 'boss_taunted':
        shake(8, 300); hitStop(120); audio.play('boss');
        view.modal = { kind: 'dialog', title: 'It stops holding back', lines: CONTENT.arc.bossTaunted, buttons: [{ id: 'confirm', label: 'Endure' }] };
        break;
      case 'chapter_complete': {
        clearSave();
        audio.play('chapter');
        const code = exportSaga(world);
        view.modal = {
          kind: 'finale', title: 'THE RIFT CLOSES BEHIND YOU', code,
          lines: [...CONTENT.arc.finale, '', CONTENT.arc.exportHint, code],
          buttons: [{ id: 'confirm', label: 'Copy code' }],
        };
        break;
      }
    }
  }

  function nearest(map, range, ok = () => true) {
    let best = null, bestD = range + 1;
    for (const id of Object.keys(map).sort()) {
      const el = map[id];
      if (!ok(el)) continue;
      const d = dist(world.player, el);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  function handleModal(presses, move) {
    const m = view.modal;
    if (m.kind === 'inventory') {
      const n = m.items.length;
      if (n) {
        if (move.dy > 0 && lastModalDy <= 0) m.sel = (m.sel + 1) % n;
        if (move.dy < 0 && lastModalDy >= 0) m.sel = (m.sel - 1 + n) % n;
      }
      // A tapped/clicked item row is a direct pick.
      for (const it of m.items) { if (presses[`item:${it.id}`]) { m.sel = m.items.indexOf(it); useSelected(m); return; } }
      if (presses.confirm || presses.interact) { useSelected(m); return; }
      if (presses.cancel || presses.dodge || presses.inventory) closeModal();
      return;
    }
    if (presses.confirm || (m.kind !== 'shop' && presses.interact)) {
      if (m.kind === 'offer') { dispatch({ type: 'ACCEPT_QUEST', questId: m.quest }); closeModal(); toast('Quest accepted'); }
      else if (m.kind === 'shop') { dispatch({ type: 'BUY', itemId: m.itemId }); }
      else if (m.kind === 'defeat') { world = makeWorld(seed, options); ro = readonly(world); closeModal(); toast('A new dawn'); }
      else if (m.kind === 'fate') { dispatch({ type: 'CHOOSE_FATE', fate: 'spare' }); closeModal(); toast('You let it live. It watches you go.'); }
      else if (m.kind === 'finale') { if (navigator.clipboard?.writeText) navigator.clipboard.writeText(m.code).catch(() => {}); toast('Code copied. See you in Part III.'); }
      else closeModal();
      return;
    }
    if (presses.alt || presses.blast) {
      if (m.kind === 'shop') dispatch({ type: 'USE_ITEM', itemId: m.itemId });
      else if (m.kind === 'fate') { dispatch({ type: 'CHOOSE_FATE', fate: 'claim' }); closeModal(); toast('You take what it was. It costs you nothing you can name yet.'); }
      return;
    }
    if (presses.cancel || presses.dodge) {
      if (m.kind === 'fate' || m.kind === 'defeat') return; // undismissable choices
      closeModal();
    }
  }

  function useSelected(m) {
    const it = m.items[m.sel];
    if (!it) return;
    if (!it.usable) { toast('A key item — nothing to use it on yet.'); return; }
    dispatch({ type: 'USE_ITEM', itemId: it.id });
    m.items = inventoryItems();
    if (m.sel >= m.items.length) m.sel = Math.max(0, m.items.length - 1);
  }

  function handleWorld(now, move, presses, chargeHeld) {
    if (presses.inventory) { openInventory(); return; }
    if (presses.dodge) { dodgeUntil = now + DODGE_MS; toast('Dodge!'); }

    if (move.dx || move.dy) {
      if (now >= nextMoveAt) { dispatch({ type: 'MOVE', dx: move.dx, dy: move.dy }); nextMoveAt = now + MOVE_REPEAT_MS; }
    } else { nextMoveAt = 0; }

    if (presses.attack) {
      const id = nearest(world.enemies, 1, (en) => en.alive);
      if (id) dispatch({ type: 'MELEE', enemyId: id }); else toast('No enemy in reach');
    }
    if (presses.blast) {
      const id = nearest(world.enemies, 3, (en) => en.alive);
      if (id) dispatch({ type: 'AURA_BLAST', enemyId: id }); else toast('No enemy in range');
    }
    if (chargeHeld) {
      if (!wasCharging || now >= nextChargeAt) { dispatch({ type: 'CHARGE', start: !wasCharging }); nextChargeAt = now + CHARGE_TICK_MS; }
    }
    wasCharging = chargeHeld;
    if (presses.interact) {
      const npcId = nearest(world.npcs, 1);
      const wellId = nearest(world.wells, 1, (wl) => !wl.attuned);
      const pickId = nearest(world.pickups, 1, (p) => !p.taken);
      const crateId = nearest(world.destructibles, 1, (d) => !d.broken);
      if (npcId) dispatch({ type: 'TALK', npcId });
      else if (wellId) dispatch({ type: 'ATTUNE', wellId });
      else if (pickId) dispatch({ type: 'INTERACT', pickupId: pickId });
      else if (crateId) dispatch({ type: 'BREAK', destructibleId: crateId });
      else toast('Nothing here');
    }

    // Enemy AI: adjacent living enemies strike on cooldown — unless the player
    // is inside the dodge window (that withholding IS the i-frames).
    const dodging = now < dodgeUntil;
    if (!dodging) {
      for (const id of Object.keys(world.enemies).sort()) {
        const en = world.enemies[id];
        if (!en.alive || dist(world.player, en) > 1) continue;
        if (now >= (enemyCd[id] || 0)) { dispatch({ type: 'ENEMY_STRIKE', enemyId: id }); enemyCd[id] = now + ENEMY_CD_MS; }
      }
    }

    if (now >= nextTickAt) { dispatch({ type: 'TICK' }); nextTickAt = now + TICK_MS; }
  }

  // The guide line: the next incomplete beat, in order. One hint at a time.
  function computeGuide() {
    if (world.flags.ended) return '';
    const g = CONTENT.arc.guide;
    const q = 'mend-the-sky';
    const talkedSable = world.quests.offered[q] || world.quests.active[q] || world.quests.completed[q];
    if (!talkedSable) return g.talk;
    if (world.quests.offered[q]) return g.quest;
    if (world.arc.bossDefeated && !world.arc.complete) return g.choice;
    if (world.arc.complete) return g.gate;
    if (world.arc.bossSpawned) return g.boss;
    if (world.quests.completed[q]) return g.rift;
    if (!world.flags.audio && world.wells.resonance && !world.wells.resonance.attuned) return g.resonance;
    if (!world.visual.color) return g.color;
    const lensDone = world.player.inventory.includes('lens-shard');
    if (!world.visual.light) return g.light;
    if (!lensDone) return g.collect;
    if (!world.visual.depth) return g.depth;
    return g.rift;
  }

  function frame(now) {
    const dt = Math.min(now - last || 16, MAX_FRAME_MS);
    last = now; frameNow = now;

    const { move, presses, device, chargeHeld } = input.poll();
    view.device = input.hasTouch && device === 'keyboard' ? 'touch' : device;

    const frozen = now < hitStopUntil;
    if (!frozen) {
      if (view.modal) handleModal(presses, move);
      else handleWorld(now, move, presses, chargeHeld);
    }
    lastModalDy = move.dy;

    view.guide = computeGuide();

    const k = Math.min(1, dt * 0.02);
    view.px += (world.player.x - view.px) * k;
    view.py += (world.player.y - view.py) * k;
    view.dodging = now < dodgeUntil;
    for (const t of view.toasts) t.ttl -= dt;
    view.toasts = view.toasts.filter((t) => t.ttl > 0);

    if (now < shakeUntil) {
      const span = Math.max(1, shakeUntil - shakeStart);
      const decay = Math.max(0, (shakeUntil - now) / span);
      view.shakeX = (Math.random() * 2 - 1) * shakeMag * decay;
      view.shakeY = (Math.random() * 2 - 1) * shakeMag * decay;
    } else { view.shakeX = 0; view.shakeY = 0; shakeMag = 0; }
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

  return { world: () => ro, dispatch, view };
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function prettify(s) { return String(s).replace(/-/g, ' '); }
function kindName(kind) { return (CONTENT.enemyKinds[kind] && CONTENT.enemyKinds[kind].name) || kind; }
