// Canvas renderer. Receives the world through the read-only proxy — it can
// look at everything and touch nothing. Continuous cosmetic detail (smooth
// sprite positions, toast fades) lives HERE, never in authoritative state.
// Returns this frame's touch/click zones so input hit-tests what was drawn.

import { canSense, enemyReadout } from '../sim/info.js';
import { withHint } from './device-labels.js';
import { describeObjective } from './objective-text.js';

export const TILE = 20;
export const OX = 80, OY = 20; // world viewport offset inside the canvas

export const COLORS = {
  bg: '#05070f', ground: '#101527', grid: '#141b33', wall: '#2b3350',
  player: '#ffb74d', aura: '#7ec8ff', npc: '#6de0c2', enemy: '#e05a5a',
  dead: '#3a3f52', crate: '#a1745b', pickup: '#ffd75e', text: '#cdd6f4',
  dim: '#8892b0', hp: '#e05a5a', bar: '#1a2140', good: '#7CFC9A',
};

export function render(ctx, w, view) {
  const { canvas } = ctx;
  const zones = [];
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Screen shake offsets the WORLD layer only — HUD/modal text must stay
  // readable, so it's restored before any of that is drawn.
  ctx.save();
  ctx.translate(view.shakeX || 0, view.shakeY || 0);

  // --- region ---
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(OX, OY, w.region.w * TILE, w.region.h * TILE);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= w.region.w; x++) {
    ctx.beginPath(); ctx.moveTo(OX + x * TILE, OY); ctx.lineTo(OX + x * TILE, OY + w.region.h * TILE); ctx.stroke();
  }
  for (let y = 0; y <= w.region.h; y++) {
    ctx.beginPath(); ctx.moveTo(OX, OY + y * TILE); ctx.lineTo(OX + w.region.w * TILE, OY + y * TILE); ctx.stroke();
  }
  for (const key of Object.keys(w.region.blocked)) {
    const [x, y] = key.split(',').map(Number);
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(OX + x * TILE, OY + y * TILE, TILE, TILE);
  }

  const tile = (x, y) => [OX + x * TILE, OY + y * TILE];

  // --- entities ---
  for (const id of Object.keys(w.destructibles)) {
    const d = w.destructibles[id];
    const [x, y] = tile(d.x, d.y);
    ctx.strokeStyle = COLORS.crate;
    if (d.broken) { ctx.strokeRect(x + 5, y + 5, TILE - 10, TILE - 10); }
    else { ctx.fillStyle = COLORS.crate; fillSquashed(ctx, x + 3, y + 3, TILE - 6, TILE - 6, view.punch[id] || 0); }
  }
  for (const id of Object.keys(w.pickups)) {
    const p = w.pickups[id];
    if (p.taken) continue;
    const [x, y] = tile(p.x, p.y);
    ctx.fillStyle = COLORS.pickup;
    ctx.beginPath();
    ctx.moveTo(x + TILE / 2, y + 4); ctx.lineTo(x + TILE - 4, y + TILE / 2);
    ctx.lineTo(x + TILE / 2, y + TILE - 4); ctx.lineTo(x + 4, y + TILE / 2);
    ctx.closePath(); ctx.fill();
  }
  for (const id of Object.keys(w.npcs)) {
    const n = w.npcs[id];
    const [x, y] = tile(n.x, n.y);
    if (id === 'warden' && w.arc.mentorDown) {
      // Fallen: flat and dim, but present — he survives to speak the legend.
      ctx.fillStyle = COLORS.dead;
      ctx.fillRect(x + 2, y + TILE - 9, TILE - 4, 6);
      continue;
    }
    ctx.fillStyle = COLORS.npc;
    ctx.fillRect(x + 4, y + 3, TILE - 8, TILE - 6);
    ctx.fillStyle = COLORS.dim;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(n.name, x + TILE / 2, y - 3);
  }
  for (const id of Object.keys(w.enemies)) {
    const e = w.enemies[id];
    const [x, y] = tile(e.x, e.y);
    const big = id === w.arc.bossDef.id ? 4 : 0; // the Ravager looms
    ctx.fillStyle = e.alive ? COLORS.enemy : COLORS.dead;
    fillSquashed(ctx, x + 4 - big, y + 4 - big, TILE - 8 + big * 2, TILE - 8 + big * 2, view.punch[id] || 0);
    if (e.alive) {
      // Skill-gated information: exact readout only if perception clears the
      // kind's senseReq — otherwise the world just shows "???".
      if (canSense(w.player, e.kind)) {
        ctx.fillStyle = COLORS.bar;
        ctx.fillRect(x + 2, y - 5, TILE - 4, 3);
        ctx.fillStyle = COLORS.hp;
        ctx.fillRect(x + 2, y - 5, (TILE - 4) * (e.hp / e.maxHp), 3);
      }
      ctx.fillStyle = COLORS.dim;
      ctx.font = '8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(enemyReadout(w.player, e), x + TILE / 2, y - 8);
      ctx.textAlign = 'left';
    }
  }

  // --- player (smooth display position, dodge flicker, aura ring) ---
  const px = OX + view.px * TILE, py = OY + view.py * TILE;
  if (w.player.aura > 0) {
    ctx.strokeStyle = COLORS.aura;
    ctx.globalAlpha = 0.25 + 0.5 * (w.player.aura / w.player.maxAura);
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (view.dodging) ctx.globalAlpha = 0.45;
  ctx.fillStyle = COLORS.player;
  // A quick stretch (not a squash) on the player's own landed hit — reads as
  // a lunge rather than an impact taken.
  fillSquashed(ctx, px + 3, py + 3, TILE - 6, TILE - 6, view.playerPunch || 0, true);
  ctx.globalAlpha = 1;

  // Night: a world-clock decision (raises enemy aggression, see
  // src/sim/daynight.js), tinted here so it reads as pressure, not paint.
  if (view.night > 0.05) {
    ctx.fillStyle = `rgba(8,12,36,${(view.night * 0.4).toFixed(3)})`;
    ctx.fillRect(OX, OY, w.region.w * TILE, w.region.h * TILE);
  }

  ctx.restore(); // end of the shaken world layer

  // --- HUD ---
  ctx.textAlign = 'left';
  ctx.font = '12px system-ui, sans-serif';
  bar(ctx, 10, 8, 130, 10, w.player.hp / w.player.maxHp, COLORS.hp, `HP ${w.player.hp}/${w.player.maxHp}`);
  bar(ctx, 10, 24, 130, 10, w.player.aura / w.player.maxAura, COLORS.aura, `Aura ${w.player.aura}/${w.player.maxAura}`);
  ctx.fillStyle = COLORS.pickup;
  ctx.fillText(`⛁ ${w.player.coins}`, 150, 17);
  ctx.fillStyle = COLORS.dim;
  const sk = w.player.skills;
  ctx.fillText(`Melee ${sk.melee.lvl} · Aura ${sk.aura.lvl}`, 150, 33);

  // Quest tracker
  const activeIds = Object.keys(w.quests.active).sort();
  if (activeIds.length) {
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.text;
    let qy = 14;
    for (const qId of activeIds) {
      ctx.fillText(qId, canvas.width - 10, qy); qy += 14;
      const def = w.quests.defs[qId];
      const st = w.quests.active[qId];
      ctx.fillStyle = COLORS.dim;
      def.objectives.forEach((o, i) => {
        ctx.fillText(`${describeObjective(o)} ${st.progress[i]}/${o.n || 1}`, canvas.width - 10, qy);
        qy += 13;
      });
      ctx.fillStyle = COLORS.text;
    }
    ctx.textAlign = 'left';
  }

  // Arc guide — one hint, top center.
  if (view.guide) {
    ctx.fillStyle = COLORS.pickup;
    ctx.font = 'italic 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(view.guide, canvas.width / 2, 14);
    ctx.textAlign = 'left';
  }

  // The eastern gate — sealed until the arc completes.
  const gate = w.region.zones['east-gate'];
  if (gate) {
    const [gx, gy] = tile(gate.x, gate.y);
    ctx.strokeStyle = w.arc.complete ? COLORS.good : COLORS.dim;
    ctx.lineWidth = 2;
    ctx.strokeRect(gx + 2, gy - TILE + 2, TILE - 4, TILE * 3 - 4);
    ctx.lineWidth = 1;
    ctx.fillStyle = w.arc.complete ? COLORS.good : COLORS.dim;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(w.arc.complete ? 'OPEN' : 'SEALED', gx + TILE / 2, gy + TILE * 2 + 6);
    ctx.textAlign = 'left';
  }

  // Toasts
  ctx.font = '11px system-ui, sans-serif';
  view.toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.ttl / 600));
    ctx.fillStyle = COLORS.good;
    ctx.fillText(t.text, 10, canvas.height - 46 - i * 14);
  });
  ctx.globalAlpha = 1;

  // Control legend in the ACTIVE device's own language — words, not glyphs.
  ctx.fillStyle = COLORS.dim;
  ctx.font = '11px system-ui, sans-serif';
  const legends = {
    keyboard: 'Move WASD/Arrows · Attack J · Blast K · Charge L · Interact E · Dodge Space',
    gamepad: 'Move Stick/D-Pad · Attack A · Blast X · Charge Y · Interact RB · Dodge B',
    touch: 'Use the on-screen pad and buttons',
  };
  ctx.fillText(legends[view.device] || legends.keyboard, 10, canvas.height - 8);

  // --- touch controls (drawn only for touch) ---
  if (view.device === 'touch') {
    const dz = 34;
    const cx = 58, cy = canvas.height - 64;
    const dirs = [
      { id: 'up', x: cx - dz / 2, y: cy - dz * 1.5, label: '▲' },
      { id: 'down', x: cx - dz / 2, y: cy + dz / 2, label: '▼' },
      { id: 'left', x: cx - dz * 1.5, y: cy - dz / 2, label: '◀' },
      { id: 'right', x: cx + dz / 2, y: cy - dz / 2, label: '▶' },
    ];
    for (const d of dirs) zones.push(touchBtn(ctx, { ...d, w: dz, h: dz }));
    const acts = [
      { id: 'attack', label: 'ATK' }, { id: 'blast', label: 'BLAST' },
      { id: 'charge', label: 'CHG' }, { id: 'interact', label: 'USE' },
      { id: 'dodge', label: 'DODGE' },
    ];
    acts.forEach((a, i) => {
      zones.push(touchBtn(ctx, {
        ...a, w: 52, h: 30,
        x: canvas.width - 62, y: canvas.height - 44 - i * 36,
      }));
    });
  }

  // --- modal (pauses the overworld; drawn last, gets its own zones) ---
  if (view.modal) {
    ctx.fillStyle = 'rgba(3,5,12,0.82)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px system-ui, sans-serif';
    const lines = view.modal.lines;
    const startY = Math.max(60, canvas.height / 2 - (lines.length * 18 + 70) / 2);
    ctx.fillText(view.modal.title, canvas.width / 2, startY);
    let ly = startY + 28;
    for (const line of lines) {
      // Long payloads (the saga code) get a small mono face and stay inside
      // the canvas; prose gets the normal face.
      if (line.length > 60) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = COLORS.good;
      } else {
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillStyle = COLORS.dim;
      }
      ctx.fillText(line, canvas.width / 2, ly, canvas.width - 40);
      ly += 18;
    }
    view.modal.buttons.forEach((b, i) => {
      const bw = 170, bh = 30;
      const x = canvas.width / 2 - bw / 2;
      const y = ly + 10 + i * 40;
      // Hint recomputed every frame from the ACTIVE device — a baked-in
      // "(Enter)" would go stale the moment a gamepad player pressed A.
      const label = withHint(view.device, b.hintAction || b.id, b.label);
      zones.push(touchBtn(ctx, { id: b.id, label, x, y, w: bw, h: bh }));
    });
    ctx.textAlign = 'left';
  }

  return zones;
}

// Squash & stretch: `strength` 0..1 decaying, drawn as a volume-preserving
// deformation around the rect's center — wider+shorter (impact taken) or
// taller+narrower (stretch, e.g. the player's own lunge). Cosmetic only.
function fillSquashed(ctx, x, y, w, h, strength, stretch = false) {
  if (!strength) { ctx.fillRect(x, y, w, h); return; }
  const amt = 0.35 * strength;
  const sx = stretch ? 1 - amt * 0.6 : 1 + amt;
  const sy = stretch ? 1 + amt * 0.6 : 1 - amt;
  const cx = x + w / 2, cy = y + h / 2;
  const nw = w * sx, nh = h * sy;
  ctx.fillRect(cx - nw / 2, cy - nh / 2, nw, nh);
}

function bar(ctx, x, y, w, h, frac, color, label) {
  ctx.fillStyle = COLORS.bar;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.fillStyle = COLORS.text;
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText(label, x + 3, y + h - 2);
}

function touchBtn(ctx, z) {
  ctx.fillStyle = 'rgba(136,146,176,0.18)';
  ctx.strokeStyle = 'rgba(136,146,176,0.6)';
  ctx.fillRect(z.x, z.y, z.w, z.h);
  ctx.strokeRect(z.x, z.y, z.w, z.h);
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(z.label, z.x + z.w / 2, z.y + z.h / 2 + 4);
  ctx.textAlign = 'left';
  return z;
}
