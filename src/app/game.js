// The presentation-layer orchestrator: owns the ONLY mutable reference to the
// world, translates device-agnostic intents into sim commands, drives enemy AI
// (as ENEMY_STRIKE commands — the sim never acts on its own), plays sound, and
// manages modals. Modals pause the overworld but never the loop itself; every
// dismissal funnels through one closeModal() so no stale flags survive.
//
// Modal navigation (uniform across every modal): options are a navigable list
// with NO default selection — a stray press can't accidentally confirm
// anything. A modal with exactly one option instead requires a deliberate
// PRESS-AND-HOLD on blast/X (a button distinct from confirm/attack, which
// used to double-fire on the same physical gamepad button) so combat mashing
// can never eat a story beat. Mouse/touch always select-and-confirm directly
// by tapping the option's zone, no navigation required.

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
const HOLD_DISMISS_MS = 1200; // single-button dialogs: hold blast/X this long
const KALEIDOSCOPE_MS = 7000; // the light well's hue-cycle color reveal
const WALK_FRAME_MS = 220;

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function startGame(canvas, seed, options = {}, initialWorld = null) {
  const ctx = canvas.getContext('2d');
  const input = makeInput(canvas);
  const audio = makeAudio();

  let world = initialWorld || makeWorld(seed, options);
  let ro = readonly(world);
  if (world.flags.audio) audio.enable();
  let respawn = JSON.stringify(world);

  const view = {
    px: world.player.x, py: world.player.y,
    toasts: [], modal: null, dodging: false, device: 'keyboard',
    guide: '', shakeX: 0, shakeY: 0, punch: {}, playerPunch: 0, night: 0,
    facing: 'down', walkFrame: 0, charging: false,
    projectiles: [],
    // Kaleidoscope: null until the light well fires this session, then a
    // {start,until} window the renderer reads to hue-cycle sprites into their
    // true color. A RESUMED save where light was already attuned shows full
    // color immediately (null = "no animation in progress", not "off").
    kaleidoscope: null,
  };
  if (!initialWorld) {
    view.modal = mkDialog('WRONG SKY', CONTENT.arc.intro, 'continue');
  }
  let nextMoveAt = 0, nextTickAt = 0, dodgeUntil = 0;
  let nextChargeAt = 0, wasCharging = false;
  const CHARGE_TICK_MS = 100;
  const enemyCd = {};
  let last = 0, frameNow = 0, lastModalDy = 0, nextWalkFrameAt = 0;

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
    if (!world.flags.ended && world.player.hp > 0) saveGame(world);
    return events;
  }

  function toast(text) { view.toasts.unshift({ text, ttl: 2600 }); if (view.toasts.length > 4) view.toasts.pop(); }
  function closeModal() { view.modal = null; }

  // --- modal construction helpers -------------------------------------------
  // Every modal is { kind, title, lines, options:[{id,label,hintAction?}], sel,
  // holdStart, holdProgress }. `sel` starts null: nothing is pre-highlighted.
  function mkModal(kind, title, lines, options) {
    return { kind, title, lines, options, sel: null, holdStart: null, holdProgress: 0 };
  }
  function mkDialog(title, lines, optionId, label) {
    return mkModal('dialog', title, lines, [{ id: optionId, label: label || 'Continue', hintAction: 'confirm' }]);
  }

  // Shop text includes the live coin balance — must be rebuilt after a
  // BUY/USE_ITEM or it goes stale while the modal (which fully covers the
  // HUD behind it) stays open.
  function shopLines(dialogLines, itemId) {
    const item = world.items[itemId];
    return [...dialogLines, `${item.name} — heals ${item.heal} HP — ${item.price} coins. You have ${world.player.coins}.`];
  }

  function inventoryItems() {
    const counts = {};
    for (const id of world.player.inventory) counts[id] = (counts[id] || 0) + 1;
    return Object.keys(counts).sort().map((id) => ({
      id, name: (world.items[id] && world.items[id].name) || id,
      count: counts[id], usable: !!(world.items[id] && world.items[id].heal),
    }));
  }
  function openInventory() {
    const items = inventoryItems();
    const options = items.map((it) => ({ id: `use:${it.id}`, label: `${it.name}${it.count > 1 ? ` x${it.count}` : ''}`, usable: it.usable }));
    options.push({ id: 'close', label: 'Close', hintAction: 'cancel' });
    view.modal = mkModal('inventory', 'Satchel', [], options);
  }

  // --- sim event -> presentation --------------------------------------------
  function onEvent(e) {
    switch (e.type) {
      case 'talked': {
        const npc = world.npcs[e.npc];
        const lines = CONTENT.regions[world.region.id].npcs[e.npc]?.dialog || [];
        if (npc.shop && npc.shop.length) {
          const itemId = npc.shop[0];
          view.modal = mkModal('shop', npc.name, shopLines(lines, itemId),
            [
              { id: 'buy', label: `Buy ${world.items[itemId].name}` },
              { id: 'drink', label: `Drink ${world.items[itemId].name}` },
              { id: 'leave', label: 'Leave', hintAction: 'cancel' },
            ]);
          view.modal.itemId = itemId;
          view.modal.dialogLines = lines;
        } else if (!view.modal) {
          view.modal = mkDialog(npc.name, lines, 'close', 'Close');
        }
        break;
      }
      case 'quests_offered': {
        const options = e.quests.map((qid) => {
          const def = world.quests.defs[qid];
          const branchOpt = CONTENT.branch.options[qid.replace('reveal-', '')];
          const label = branchOpt ? branchOpt.label : def.name;
          return { id: qid, label };
        });
        options.push({ id: 'notnow', label: 'Not now', hintAction: 'cancel' });
        const flavor = questOfferFlavor(e.quests);
        view.modal = mkModal('offer', 'Sable', flavor, options);
        break;
      }
      case 'enemy_appeared': toast(`${kindName(world.enemies[e.target]?.kind || e.kind)} stirs.`); break;
      case 'pickup_appeared': toast('Something glints nearby.'); break;
      case 'picked_up': toast(`Picked up ${prettify(e.item)}`); audio.play('pickup'); break;
      case 'well_hint': {
        const wl = CONTENT.regions[world.region.id].wells[e.well];
        toast(wl?.hint || '...nothing happens.');
        break;
      }
      case 'attuned':
        if (e.facet === 'audio') { audio.enable(); toast('The world sounds again.'); }
        else if (e.facet === 'light') {
          toast('The world snaps into focus, all at once.');
          view.kaleidoscope = { start: frameNow, until: frameNow + KALEIDOSCOPE_MS };
        } else {
          toast(`${cap(e.facet)} takes shape.`);
        }
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
          view.modal = mkModal('fate', 'The Second kneels',
            ['It is beaten either way.', 'Do you take its power, or leave it be?'],
            [{ id: 'spare', label: 'Spare it' }, { id: 'claim', label: 'Claim its power' }]);
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
        view.modal = mkDialog('You fall...', ['The Reach goes quiet.'], 'rise', 'Rise Again');
        view.modal.kind = 'defeat';
        break;
      case 'exit_locked': toast('The rift is sealed. You are not done here.'); break;
      case 'boss_appeared':
        shake(10, 450); hitStop(150); audio.play('boss');
        view.modal = mkDialog('The Second', CONTENT.arc.bossAppeared, 'stand', 'Stand');
        break;
      case 'boss_taunted':
        shake(8, 300); hitStop(120); audio.play('boss');
        view.modal = mkDialog('It stops holding back', CONTENT.arc.bossTaunted, 'endure', 'Endure');
        break;
      case 'chapter_complete': {
        clearSave();
        audio.play('chapter');
        const code = exportSaga(world);
        view.modal = mkDialog('THE RIFT CLOSES BEHIND YOU', [...CONTENT.arc.finale, '', CONTENT.arc.exportHint, code], 'copy', 'Copy code');
        view.modal.kind = 'finale';
        view.modal.code = code;
        break;
      }
    }
  }

  // Sable's line(s) reacting to the choice(s) so far, shown atop whichever
  // quest(s) she's currently offering — keyed on the ORDER facets were picked
  // (state.flags.revealOrder), so ABC reads differently than BCA.
  function questOfferFlavor(offeredQuests) {
    if (offeredQuests.includes('hear-the-world')) return [];
    const order = world.flags.revealOrder;
    if (offeredQuests.length === 3) return CONTENT.branch.prompt;
    if (offeredQuests.length === 2) return CONTENT.branch.afterFirst[order[0]] || [];
    if (offeredQuests.length === 1 && offeredQuests[0] !== 'mend-the-sky-finale') {
      return CONTENT.branch.afterSecond[order.slice(0, 2).join(',')] || [];
    }
    if (offeredQuests.includes('mend-the-sky-finale')) return CONTENT.branch.finale[order.join(',')] || [];
    return [];
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

  // Runs whichever option the modal resolved to (navigated+confirmed, or
  // tapped directly). Each modal `kind` interprets its own option ids.
  function runOption(m, opt) {
    switch (m.kind) {
      case 'dialog': case 'defeat': case 'finale':
        if (m.kind === 'defeat') { world = JSON.parse(respawn); ro = readonly(world); saveGame(world); closeModal(); toast('You rise where you began.'); }
        else if (m.kind === 'finale') { if (navigator.clipboard?.writeText) navigator.clipboard.writeText(m.code).catch(() => {}); toast('Code copied. See you in Part III.'); closeModal(); }
        else closeModal();
        break;
      case 'offer':
        if (opt.id === 'notnow') { closeModal(); toast('The offer stands.'); }
        else { dispatch({ type: 'ACCEPT_QUEST', questId: opt.id }); closeModal(); toast('Chosen.'); }
        break;
      case 'shop':
        if (opt.id === 'buy') { dispatch({ type: 'BUY', itemId: m.itemId }); m.lines = shopLines(m.dialogLines, m.itemId); }
        else if (opt.id === 'drink') { dispatch({ type: 'USE_ITEM', itemId: m.itemId }); m.lines = shopLines(m.dialogLines, m.itemId); }
        else closeModal();
        break;
      case 'fate':
        dispatch({ type: 'CHOOSE_FATE', fate: opt.id });
        closeModal();
        toast(opt.id === 'spare' ? 'You let it live. It watches you go.' : 'You take what it was. It costs you nothing you can name yet.');
        break;
      case 'inventory':
        if (opt.id === 'close') { closeModal(); break; }
        if (!opt.usable) { toast('A key item — nothing to use it on yet.'); break; }
        dispatch({ type: 'USE_ITEM', itemId: opt.id.slice(4) });
        {
          const items = inventoryItems();
          const options = items.map((it) => ({ id: `use:${it.id}`, label: `${it.name}${it.count > 1 ? ` x${it.count}` : ''}`, usable: it.usable }));
          options.push({ id: 'close', label: 'Close', hintAction: 'cancel' });
          view.modal.options = options;
          view.modal.sel = view.modal.sel != null ? Math.min(view.modal.sel, options.length - 1) : null;
        }
        break;
    }
  }

  function handleModal(now, presses, move, blastHeld) {
    const m = view.modal;
    const opts = m.options;

    if (opts.length === 1) {
      if (blastHeld) {
        if (m.holdStart == null) m.holdStart = now;
        m.holdProgress = Math.min(1, (now - m.holdStart) / HOLD_DISMISS_MS);
        if (now - m.holdStart >= HOLD_DISMISS_MS) { runOption(m, opts[0]); }
      } else {
        m.holdStart = null;
        m.holdProgress = 0;
      }
      // Direct tap always works too (touch/mouse zone click is deliberate).
      if (presses[opts[0].id]) runOption(m, opts[0]);
      return;
    }

    if (move.dy > 0 && lastModalDy <= 0) m.sel = m.sel == null ? 0 : (m.sel + 1) % opts.length;
    if (move.dy < 0 && lastModalDy >= 0) m.sel = m.sel == null ? opts.length - 1 : (m.sel - 1 + opts.length) % opts.length;
    if (presses.confirm && m.sel != null) { runOption(m, opts[m.sel]); return; }
    for (const opt of opts) { if (presses[opt.id]) { runOption(m, opt); return; } }
    if (presses.cancel && m.kind !== 'fate' && m.kind !== 'defeat') closeModal();
  }

  function handleWorld(now, move, presses, chargeHeld) {
    if (presses.inventory) { openInventory(); return; }
    if (presses.dodge) { dodgeUntil = now + DODGE_MS; toast('Dodge!'); }

    if (move.dx || move.dy) {
      view.facing = move.dy > 0 ? 'down' : move.dy < 0 ? 'up' : move.dx > 0 ? 'right' : 'left';
      if (now >= nextWalkFrameAt) { view.walkFrame = 1 - view.walkFrame; nextWalkFrameAt = now + WALK_FRAME_MS; }
      if (now >= nextMoveAt) { dispatch({ type: 'MOVE', dx: move.dx, dy: move.dy }); nextMoveAt = now + MOVE_REPEAT_MS; }
    } else { nextMoveAt = 0; view.walkFrame = 0; }

    if (presses.attack) {
      const id = nearest(world.enemies, 1, (en) => en.alive);
      if (id) dispatch({ type: 'MELEE', enemyId: id }); else toast('No enemy in reach');
    }
    if (presses.blast) {
      const id = nearest(world.enemies, 3, (en) => en.alive);
      if (id) {
        const target = world.enemies[id];
        const x0 = world.player.x, y0 = world.player.y;
        dispatch({ type: 'AURA_BLAST', enemyId: id });
        view.projectiles.push({ x0, y0, x1: target.x, y1: target.y, start: now, duration: 180 });
      } else toast('No enemy in range');
    }
    view.charging = chargeHeld;
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

  function computeGuide() {
    if (world.flags.ended) return '';
    const g = CONTENT.arc.guide;
    if (!(world.quests.offered['hear-the-world'] || world.quests.active['hear-the-world'] || world.quests.completed['hear-the-world'])) return g.talk;
    if (world.quests.offered['hear-the-world']) return g.talk;
    if (world.quests.active['hear-the-world']) return g.hear;
    const doneCount = world.flags.revealOrder.length;
    if (world.arc.bossDefeated && !world.arc.complete) return g.choice;
    if (world.arc.complete) return g.gate;
    if (world.arc.bossSpawned) return g.boss;
    if (world.quests.completed['mend-the-sky-finale']) return g.rift;
    if (world.quests.active['mend-the-sky-finale']) {
      if (!world.visual.light) return g.light;
      return g.rift;
    }
    if (doneCount === 3) return g.finale;
    if (Object.keys(world.quests.active).some((q) => q.startsWith('reveal-'))) return g.attune;
    if (doneCount === 0) return g.choose1;
    if (doneCount === 1) return g.choose2;
    return g.choose3;
  }

  function frame(now) {
    const dt = Math.min(now - last || 16, MAX_FRAME_MS);
    last = now; frameNow = now;

    const { move, presses, device, chargeHeld, blastHeld } = input.poll();
    view.device = input.hasTouch && device === 'keyboard' ? 'touch' : device;

    const frozen = now < hitStopUntil;
    if (!frozen) {
      if (view.modal) handleModal(now, presses, move, blastHeld);
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
    view.projectiles = view.projectiles.filter((p) => now - p.start < p.duration);

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
    if (view.kaleidoscope && now >= view.kaleidoscope.until) view.kaleidoscope = null;

    input.setZones(render(ctx, ro, view, now));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { world: () => ro, dispatch, view };
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function prettify(s) { return String(s).replace(/-/g, ' '); }
function kindName(kind) { return (CONTENT.enemyKinds[kind] && CONTENT.enemyKinds[kind].name) || kind; }
