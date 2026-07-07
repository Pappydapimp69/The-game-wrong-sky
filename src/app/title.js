// Title screen: Continue / New Game / Controls. New Game always ends by
// resolving to { action: 'new', archetype, difficulty } — the caller starts
// a real makeWorld() from that, never by reopening setup over stale state.
// Continue only appears with a compatible save on the slot.

import { makeInput } from './input.js';
import { COLORS } from './renderer.js';
import { CONTENT } from '../sim/content.js';
import { hasSave, loadGame, clearSave } from './save.js';
import { withHint } from './device-labels.js';

function btn(ctx, z, device) {
  ctx.fillStyle = 'rgba(136,146,176,0.14)';
  ctx.strokeStyle = z.on ? COLORS.pickup : 'rgba(136,146,176,0.6)';
  ctx.lineWidth = z.on ? 2 : 1;
  ctx.fillRect(z.x, z.y, z.w, z.h);
  ctx.strokeRect(z.x, z.y, z.w, z.h);
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  // Hint recomputed from the ACTIVE device every frame, same as in-game modals.
  const label = z.hintAction ? withHint(device, z.hintAction, z.label) : z.label;
  ctx.fillText(label, z.x + z.w / 2, z.y + z.h / 2 + 5);
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  return z;
}

// Resolves once the player commits to Continue or New Game.
export function runTitle(canvas) {
  return new Promise((resolve) => {
    const ctx = canvas.getContext('2d');
    const input = makeInput(canvas);
    let screen = 'menu';
    let archIdx = 0;
    const archIds = Object.keys(CONTENT.archetypes);
    let difficulty = 'gentle';
    let confirmOverwrite = false;
    let selected = 0;

    function menuOptions() {
      const opts = [];
      if (hasSave()) opts.push('continue');
      opts.push('new', 'controls');
      return opts;
    }

    function handlePress(id) {
      if (screen === 'menu') {
        const opts = menuOptions();
        if (id === 'continue' && opts.includes('continue')) {
          const data = loadGame();
          if (data) { resolve({ action: 'continue', world: data }); return; }
        }
        if (id === 'new') {
          if (hasSave()) { confirmOverwrite = true; screen = 'confirm'; }
          else screen = 'setup';
        }
        if (id === 'controls') screen = 'controls';
      } else if (screen === 'confirm') {
        if (id === 'yes') { clearSave(); confirmOverwrite = false; screen = 'setup'; }
        if (id === 'no') { confirmOverwrite = false; screen = 'menu'; }
      } else if (screen === 'setup') {
        if (id === 'back') screen = 'menu';
        if (id === 'gentle') difficulty = 'gentle';
        if (id === 'harsh') difficulty = 'harsh';
        if (archIds.includes(id)) archIdx = archIds.indexOf(id);
        if (id === 'start') resolve({ action: 'new', archetype: archIds[archIdx], difficulty });
      } else if (screen === 'controls') {
        if (id === 'back') screen = 'menu';
      }
    }

    function draw(device) {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.pickup;
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText('PROLOGUE', canvas.width / 2, 90);
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = COLORS.dim;
      ctx.fillText('an open-world tale of aura and ash', canvas.width / 2, 116);

      const zones = [];
      if (screen === 'menu') {
        const opts = menuOptions();
        const labels = { continue: 'Continue', new: 'New Game', controls: 'Controls' };
        opts.forEach((id, i) => {
          zones.push(btn(ctx, {
            id, label: labels[id], on: i === selected,
            x: canvas.width / 2 - 90, y: 170 + i * 46, w: 180, h: 36,
          }, device));
        });
      } else if (screen === 'confirm') {
        ctx.fillStyle = COLORS.text;
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillText('A saved run exists. Starting new erases it.', canvas.width / 2, 190);
        zones.push(btn(ctx, { id: 'no', hintAction: 'cancel', label: 'Keep it', x: canvas.width / 2 - 190, y: 220, w: 170, h: 36 }, device));
        zones.push(btn(ctx, { id: 'yes', hintAction: 'confirm', label: 'Overwrite', x: canvas.width / 2 + 20, y: 220, w: 170, h: 36 }, device));
      } else if (screen === 'setup') {
        ctx.fillStyle = COLORS.text;
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText('Choose your path', canvas.width / 2, 155);
        archIds.forEach((id, i) => {
          const a = CONTENT.archetypes[id];
          const x = canvas.width / 2 - 300 + i * 210;
          zones.push(btn(ctx, { id, label: a.name, on: i === archIdx, x, y: 175, w: 190, h: 34 }, device));
          ctx.fillStyle = COLORS.dim;
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(a.blurb, x + 95, 226, 186);
        });
        ctx.fillStyle = COLORS.text;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.fillText('Tone', canvas.width / 2, 268);
        zones.push(btn(ctx, { id: 'gentle', label: 'Gentle', on: difficulty === 'gentle', x: canvas.width / 2 - 130, y: 280, w: 120, h: 32 }, device));
        zones.push(btn(ctx, { id: 'harsh', label: 'Harsh', on: difficulty === 'harsh', x: canvas.width / 2 + 10, y: 280, w: 120, h: 32 }, device));
        zones.push(btn(ctx, { id: 'start', hintAction: 'confirm', label: 'Begin', x: canvas.width / 2 - 90, y: 335, w: 180, h: 36 }, device));
        zones.push(btn(ctx, { id: 'back', hintAction: 'cancel', label: 'Back', x: canvas.width / 2 - 60, y: 380, w: 120, h: 28 }, device));
      } else if (screen === 'controls') {
        ctx.fillStyle = COLORS.dim;
        ctx.font = '13px system-ui, sans-serif';
        const lines = [
          'Keyboard — Move WASD/Arrows · Attack J · Blast K · Charge L · Interact E · Dodge Space',
          'Gamepad — Move Stick/D-Pad · Attack A · Blast X · Charge Y · Interact RB · Dodge B',
          'Touch — on-screen pad and buttons',
        ];
        lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, 190 + i * 22));
        zones.push(btn(ctx, { id: 'back', hintAction: 'cancel', label: 'Back', x: canvas.width / 2 - 60, y: 270, w: 120, h: 28 }, device));
      }
      ctx.textAlign = 'left';
      input.setZones(zones);
      return zones;
    }

    // Keyboard/gamepad navigation: move up/down cycles the menu, confirm
    // selects — both stick and D-pad already feed `move` via input.js, so
    // this is free navigability for players with no pointer at all.
    let lastDy = 0, lastDx = 0;
    function frame() {
      const { move, presses, device } = input.poll();
      const zones = draw(input.hasTouch && device === 'keyboard' ? 'touch' : device);

      if (screen === 'menu') {
        const opts = menuOptions();
        if (selected >= opts.length) selected = 0;
        if (move.dy > 0 && lastDy <= 0) selected = (selected + 1) % opts.length;
        if (move.dy < 0 && lastDy >= 0) selected = (selected - 1 + opts.length) % opts.length;
        if (presses.confirm) handlePress(opts[selected]);
      } else if (screen === 'setup') {
        if (move.dx > 0 && lastDx <= 0) archIdx = (archIdx + 1) % archIds.length;
        if (move.dx < 0 && lastDx >= 0) archIdx = (archIdx - 1 + archIds.length) % archIds.length;
        if (presses.confirm) handlePress('start');
        if (presses.cancel) handlePress('back');
      } else if (screen === 'confirm') {
        if (presses.confirm) handlePress('yes');
        if (presses.cancel) handlePress('no');
      } else if (screen === 'controls') {
        if (presses.cancel || presses.confirm) handlePress('back');
      }
      lastDy = move.dy; lastDx = move.dx;

      // Zone taps/clicks fire through the SAME pending-press mechanism used
      // for modals — any action id matching a drawn zone triggers it.
      for (const z of zones) {
        if (presses[z.id]) handlePress(z.id);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
