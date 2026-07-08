// Canvas renderer. Receives the world through the read-only proxy — it can look
// at everything and touch nothing. Continuous cosmetic detail (smooth sprite
// positions, camera, toast fades, lighting) lives HERE, never in authoritative
// state. Returns this frame's touch/click zones so input hit-tests what was
// drawn.
//
// WRONG SKY presentation pillars, all driven by authoritative flags the player
// restores by attuning wells:
//   - visual.player / visual.world / visual.enemies: swap flat Phase-1 blocks
//     for real pixel sprites, one layer at a time (src/app/sprites.js).
//   - visual.light: opacity-based shadowcasting (src/sim/visibility.js) — a
//     100-opacity wall fully occludes what's behind it from the player's line
//     of sight; Y-sort + ground shadows read as real depth.
//   - The light well ALSO fires a ~7s hue-cycle "kaleidoscope" (view.kaleidoscope)
//     that melts whatever sprite layers are already on into their true color —
//     grayscale until then, always.
// The camera follows the player and clamps to the region so the world fills
// the viewport at any resolution. HUD/text is anchored in screen space with
// its OWN scale — world scale and text scale are separate on purpose.

import { canSense, enemyReadout } from '../sim/info.js';
import { withHint, keyHint } from './device-labels.js';
import { describeObjective } from './objective-text.js';
import { computeVisibility } from '../sim/visibility.js';
import { drawPixelSprite } from './pixelart.js';
import { PLAYER_SPRITES, BLAST_SPRITE, ENEMY_SPRITES, TILE_SPRITES } from './sprites.js';

export const TILE = 24;
const VISION_RADIUS = 9;

export const COLORS = {
  bg: '#05070f', ground: '#141a2e', grid: '#1b2340', wall: '#39436a',
  player: '#ffb74d', aura: '#7ec8ff', npc: '#6de0c2', enemy: '#e05a5a',
  dead: '#3a3f52', crate: '#a1745b', pickup: '#ffd75e', text: '#e6ebf7',
  dim: '#98a3c0', hp: '#e05a5a', bar: '#1a2140', good: '#8ff0a6',
  well: '#b48cff', wellOn: '#e0d0ff', rival: '#ff6b8a', rift: '#8fd0ff',
};

// Grayscale twin of the palette (luminance), used until `world`/etc restore.
const GRAY = {};
for (const [k, hex] of Object.entries(COLORS)) GRAY[k] = toGray(hex);

// Sprite render filter for the current frame: grayscale until the light well
// fires, then a ~7s hue-cycle melt into true color, then NONE forever after
// (a resumed save where light was already attuned in a prior session also
// gets 'none' immediately — kaleidoscope is a one-time reveal, not a re-tint).
function spriteFilter(view, now, lightRestored) {
  if (view.kaleidoscope) {
    const t = Math.max(0, Math.min(1, (now - view.kaleidoscope.start) / (view.kaleidoscope.until - view.kaleidoscope.start)));
    const eased = 1 - Math.pow(1 - t, 3); // ease-out
    const hueDeg = Math.round((1 - eased) * 720); // a couple of full cycles, settling to 0
    const gray = Math.max(0, 1 - eased);
    return `grayscale(${gray.toFixed(2)}) hue-rotate(${hueDeg}deg)`;
  }
  return lightRestored ? 'none' : 'grayscale(1)';
}

// Canvas 2D `filter` treats 'none' as an exclusive keyword — it cannot be
// combined with other filter functions in one string ('none grayscale(...)'
// is invalid and silently drops the whole filter). Combine safely instead.
function combineFilter(base, extra) { return base === 'none' ? extra : `${base} ${extra}`; }

export function render(ctx, w, view, now = 0) {
  const { canvas } = ctx;
  const W = canvas.width, H = canvas.height;
  const zones = [];
  const vis = w.visual;
  // Flat (non-sprite) elements — wells, pickups, HUD — snap to true color the
  // instant light is attuned; only the SPRITE layer (player/world/enemies)
  // animates through the kaleidoscope, via `filter` below.
  const C = vis.light ? COLORS : GRAY;
  const filter = spriteFilter(view, now, vis.light);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // --- camera + world scale ------------------------------------------------
  const scale = H / (16 * TILE);
  const regionWpx = w.region.w * TILE, regionHpx = w.region.h * TILE;
  const viewWpx = W / scale, viewHpx = H / scale;
  const centerX = view.px * TILE + TILE / 2, centerY = view.py * TILE + TILE / 2;
  const camX = clampCam(centerX - viewWpx / 2, regionWpx, viewWpx);
  const camY = clampCam(centerY - viewHpx / 2, regionHpx, viewHpx);
  ctx.setTransform(scale, 0, 0, scale, -camX * scale + (view.shakeX || 0), -camY * scale + (view.shakeY || 0));

  const pad = 1;
  const minTX = Math.max(0, Math.floor(camX / TILE) - pad);
  const maxTX = Math.min(w.region.w - 1, Math.floor((camX + viewWpx) / TILE) + pad);
  const minTY = Math.max(0, Math.floor(camY / TILE) - pad);
  const maxTY = Math.min(w.region.h - 1, Math.floor((camY + viewHpx) / TILE) + pad);
  const onScreen = (x, y) => x >= minTX - pad && x <= maxTX + pad && y >= minTY - pad && y <= maxTY + pad;

  // --- ground + grid (culled) ---
  const worldSprites = vis.world;
  if (worldSprites) {
    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        const def = (tx + ty) % 2 === 0 ? TILE_SPRITES.groundA : TILE_SPRITES.groundB;
        drawPixelSprite(ctx, def, tx * TILE, ty * TILE, TILE, filter);
      }
    }
  } else {
    ctx.fillStyle = C.ground;
    ctx.fillRect(minTX * TILE, minTY * TILE, (maxTX - minTX + 1) * TILE, (maxTY - minTY + 1) * TILE);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let x = minTX; x <= maxTX + 1; x++) { ctx.beginPath(); ctx.moveTo(x * TILE, minTY * TILE); ctx.lineTo(x * TILE, (maxTY + 1) * TILE); ctx.stroke(); }
    for (let y = minTY; y <= maxTY + 1; y++) { ctx.beginPath(); ctx.moveTo(minTX * TILE, y * TILE); ctx.lineTo((maxTX + 1) * TILE, y * TILE); ctx.stroke(); }
  }

  const drawWall = (x, y) => {
    if (worldSprites) drawPixelSprite(ctx, TILE_SPRITES.wall, x * TILE, y * TILE, TILE, filter);
    else { ctx.fillStyle = C.wall; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
  };
  const walls = [];
  for (const key of Object.keys(w.region.blocked)) {
    const [x, y] = key.split(',').map(Number);
    if (onScreen(x, y)) { walls.push([x, y]); drawWall(x, y); }
  }

  // --- build the drawable list (entities) ---
  const drawables = [];
  const add = (x, y, fn) => { if (onScreen(x, y)) drawables.push({ x, y, fn }); };

  for (const id of Object.keys(w.destructibles)) {
    const d = w.destructibles[id];
    add(d.x, d.y, () => {
      const [x, y] = tile(d.x, d.y);
      if (d.broken) { ctx.strokeStyle = C.crate; ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12); }
      else { ctx.fillStyle = C.crate; fillSquashed(ctx, x + 4, y + 4, TILE - 8, TILE - 8, view.punch[id] || 0); }
    });
  }
  for (const id of Object.keys(w.pickups)) {
    const p = w.pickups[id];
    if (p.taken) continue;
    add(p.x, p.y, () => {
      const [x, y] = tile(p.x, p.y);
      ctx.fillStyle = C.pickup;
      ctx.beginPath();
      ctx.moveTo(x + TILE / 2, y + 5); ctx.lineTo(x + TILE - 5, y + TILE / 2);
      ctx.lineTo(x + TILE / 2, y + TILE - 5); ctx.lineTo(x + 5, y + TILE / 2);
      ctx.closePath(); ctx.fill();
    });
  }
  for (const id of Object.keys(w.wells)) {
    const wl = w.wells[id];
    add(wl.x, wl.y, () => {
      const [x, y] = tile(wl.x, wl.y);
      const cx = x + TILE / 2, cy = y + TILE / 2;
      ctx.strokeStyle = wl.attuned ? C.wellOn : C.well;
      ctx.lineWidth = wl.attuned ? 3 : 2;
      ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.34, 0, Math.PI * 2); ctx.stroke();
      if (wl.attuned) { ctx.fillStyle = C.wellOn; ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.16, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 1;
    });
  }
  const enemySprites = vis.enemies;
  for (const id of Object.keys(w.npcs)) {
    const n = w.npcs[id];
    add(n.x, n.y, () => {
      const [x, y] = tile(n.x, n.y);
      if (enemySprites) {
        drawPixelSprite(ctx, PLAYER_SPRITES['down-0'], x + 2, y + 2, TILE - 4, combineFilter(filter, 'grayscale(0.6) brightness(0.85)'));
      } else {
        ctx.fillStyle = C.npc;
        ctx.fillRect(x + 5, y + 4, TILE - 10, TILE - 7);
      }
      ctx.fillStyle = C.dim;
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.name, x + TILE / 2, y - 3);
      ctx.textAlign = 'left';
    });
  }
  for (const id of Object.keys(w.enemies)) {
    const e = w.enemies[id];
    const isBoss = id === w.arc.bossDef.id;
    add(e.x, e.y, () => {
      const [x, y] = tile(e.x, e.y);
      const big = isBoss ? 5 : 0;
      if (enemySprites && ENEMY_SPRITES[e.kind]) {
        const f = e.alive ? filter : 'grayscale(1) brightness(0.4)';
        drawPixelSprite(ctx, ENEMY_SPRITES[e.kind], x + 2 - big, y + 2 - big, TILE - 4 + big * 2, f);
      } else {
        ctx.fillStyle = !e.alive ? C.dead : (isBoss ? C.rival : C.enemy);
        fillSquashed(ctx, x + 5 - big, y + 5 - big, TILE - 10 + big * 2, TILE - 10 + big * 2, view.punch[id] || 0);
      }
      if (e.alive) {
        if (canSense(w.player, e.kind)) {
          ctx.fillStyle = C.bar; ctx.fillRect(x + 3, y - 6, TILE - 6, 3);
          ctx.fillStyle = C.hp; ctx.fillRect(x + 3, y - 6, (TILE - 6) * (e.hp / e.maxHp), 3);
        }
        ctx.fillStyle = C.dim; ctx.font = '8px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(enemyReadout(w.player, e), x + TILE / 2, y - 9); ctx.textAlign = 'left';
      }
    });
  }
  // Player (smooth display position, direction/frame-aware sprite).
  const ppx = view.px * TILE, ppy = view.py * TILE;
  add(view.px, view.py, () => {
    if (w.player.aura > 0) {
      ctx.strokeStyle = C.aura;
      ctx.globalAlpha = 0.25 + 0.5 * (w.player.aura / w.player.maxAura);
      ctx.beginPath(); ctx.arc(ppx + TILE / 2, ppy + TILE / 2, TILE * 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (view.dodging) ctx.globalAlpha = 0.45;
    if (vis.player) {
      const key = view.charging ? 'charge' : `${view.facing === 'left' || view.facing === 'right' ? 'side' : view.facing}-${view.walkFrame}`;
      const def = PLAYER_SPRITES[key] || PLAYER_SPRITES['down-0'];
      if (view.facing === 'right') {
        ctx.save();
        ctx.translate(ppx + TILE, ppy);
        ctx.scale(-1, 1);
        drawPixelSprite(ctx, def, 0, 0, TILE, filter);
        ctx.restore();
      } else {
        drawPixelSprite(ctx, def, ppx, ppy, TILE, filter);
      }
    } else {
      ctx.fillStyle = C.player;
      fillSquashed(ctx, ppx + 4, ppy + 4, TILE - 8, TILE - 8, view.playerPunch || 0, true);
    }
    ctx.globalAlpha = 1;
  });

  // Depth facet: Y-sort + ground shadows.
  if (vis.light) {
    drawables.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (const d of drawables) {
      const [x, y] = tile(d.x, d.y);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(x + TILE / 2, y + TILE - 3, TILE * 0.34, TILE * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const d of drawables) d.fn();

  // Blast projectiles: presentation-only, lerped between cast and target.
  if (vis.player) {
    for (const p of view.projectiles) {
      const t = Math.max(0, Math.min(1, (now - p.start) / p.duration));
      const px = (p.x0 + (p.x1 - p.x0) * t) * TILE + TILE / 2;
      const py = (p.y0 + (p.y1 - p.y0) * t) * TILE + TILE / 2;
      drawPixelSprite(ctx, BLAST_SPRITE, px - TILE * 0.3, py - TILE * 0.3, TILE * 0.6, filter);
    }
  }

  // Light facet: opacity-based shadowcasting from the player's line of sight.
  // A 100-opacity wall fully occludes what's behind it; walls are redrawn
  // opaque on top so they still read as solid, visible occluders.
  if (vis.light) {
    const originX = Math.round(view.px), originY = Math.round(view.py);
    const clarity = computeVisibility(w, originX, originY, VISION_RADIUS);
    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        const c = clarity.has(`${tx},${ty}`) ? clarity.get(`${tx},${ty}`) : 0;
        if (c >= 100) continue;
        ctx.fillStyle = `rgba(3,5,14,${(1 - c / 100) * 0.92})`;
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    for (const [x, y] of walls) drawWall(x, y);
  }

  // --- HUD (screen space, its own scale) -----------------------------------
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (view.night > 0.05) {
    ctx.fillStyle = `rgba(8,12,34,${(view.night * (vis.light ? 0.16 : 0.34)).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  const u = clamp(H / 540, 0.85, 3);
  ctx.textAlign = 'left';
  const pad2 = 12 * u;

  bar(ctx, pad2, pad2, 150 * u, 12 * u, w.player.hp / w.player.maxHp, COLORS.hp, `HP ${w.player.hp}/${w.player.maxHp}`, u);
  bar(ctx, pad2, pad2 + 18 * u, 150 * u, 12 * u, w.player.aura / w.player.maxAura, COLORS.aura, `Aura ${w.player.aura}/${w.player.maxAura}`, u);
  ctx.fillStyle = COLORS.pickup; ctx.font = `${12 * u}px system-ui, sans-serif`;
  ctx.fillText(`⛁ ${w.player.coins}`, pad2 + 162 * u, pad2 + 10 * u);
  ctx.fillStyle = COLORS.dim;
  const sk = w.player.skills;
  ctx.fillText(`Melee ${sk.melee.lvl} · Aura ${sk.aura.lvl} · Per ${sk.perception.lvl}`, pad2 + 162 * u, pad2 + 28 * u);

  const facets = [['self', vis.player], ['world', vis.world], ['others', vis.enemies], ['light', vis.light], ['sound', w.flags.audio]];
  ctx.font = `${11 * u}px system-ui, sans-serif`;
  let fx = pad2;
  const fy = pad2 + 44 * u;
  ctx.fillStyle = COLORS.dim; ctx.fillText('sky:', fx, fy); fx += 30 * u;
  for (const [name, on] of facets) {
    ctx.fillStyle = on ? COLORS.good : 'rgba(152,163,192,0.4)';
    ctx.fillText(on ? `✦${name}` : `·${name}`, fx, fy);
    fx += (name.length * 7 + 16) * u;
  }

  const activeIds = Object.keys(w.quests.active).sort();
  if (activeIds.length) {
    ctx.textAlign = 'right';
    let qy = pad2 + 4 * u;
    for (const qId of activeIds) {
      ctx.fillStyle = COLORS.text; ctx.font = `${12 * u}px system-ui, sans-serif`;
      ctx.fillText(w.quests.defs[qId].name, W - pad2, qy); qy += 15 * u;
      const def = w.quests.defs[qId], st = w.quests.active[qId];
      ctx.fillStyle = COLORS.dim; ctx.font = `${11 * u}px system-ui, sans-serif`;
      def.objectives.forEach((o, i) => {
        const done = st.progress[i] >= (o.n || 1);
        ctx.fillStyle = done ? COLORS.good : COLORS.dim;
        ctx.fillText(`${done ? '✓' : '•'} ${describeObjective(o)} ${st.progress[i]}/${o.n || 1}`, W - pad2, qy);
        qy += 14 * u;
      });
    }
    ctx.textAlign = 'left';
  }

  if (view.guide) {
    ctx.fillStyle = COLORS.pickup; ctx.font = `italic ${13 * u}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(view.guide, W / 2, pad2 + 6 * u); ctx.textAlign = 'left';
  }

  ctx.font = `${12 * u}px system-ui, sans-serif`;
  view.toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.ttl / 600));
    ctx.fillStyle = COLORS.good;
    ctx.fillText(t.text, pad2, H - 40 * u - i * 16 * u);
  });
  ctx.globalAlpha = 1;

  ctx.fillStyle = COLORS.dim; ctx.font = `${11 * u}px system-ui, sans-serif`;
  const legends = {
    keyboard: 'Move WASD · Attack J · Blast K · Charge L · Interact E · Items I · Dodge Space',
    gamepad: 'Move Stick/D-Pad · Attack A · Blast X · Charge Y · Interact RB · Items Start · Dodge B',
    touch: 'On-screen pad and buttons',
  };
  ctx.fillText(legends[view.device] || legends.keyboard, pad2, H - 10 * u);

  if (view.device === 'touch') {
    const dz = 42 * u, cx = 70 * u, cy = H - 92 * u;
    const dirs = [
      { id: 'up', x: cx - dz / 2, y: cy - dz * 1.5, label: '▲' },
      { id: 'down', x: cx - dz / 2, y: cy + dz / 2, label: '▼' },
      { id: 'left', x: cx - dz * 1.5, y: cy - dz / 2, label: '◀' },
      { id: 'right', x: cx + dz / 2, y: cy - dz / 2, label: '▶' },
    ];
    for (const d of dirs) zones.push(touchBtn(ctx, { ...d, w: dz, h: dz }, u));
    const acts = [
      { id: 'attack', label: 'ATK' }, { id: 'blast', label: 'BLAST' }, { id: 'charge', label: 'CHG' },
      { id: 'interact', label: 'USE' }, { id: 'inventory', label: 'BAG' }, { id: 'dodge', label: 'DODGE' },
    ];
    acts.forEach((a, i) => {
      zones.push(touchBtn(ctx, { ...a, w: 64 * u, h: 34 * u, x: W - 74 * u, y: H - 52 * u - i * 40 * u }, u));
    });
  }

  if (view.modal) zones.push(...drawModal(ctx, W, H, u, view));

  return zones;

  function tile(x, y) { return [x * TILE, y * TILE]; }
}

// --- modal ------------------------------------------------------------------
// Uniform navigable options list, no default selection. Exactly one option
// shows a press-and-hold progress bar instead of a highlight (see game.js).
function drawModal(ctx, W, H, u, view) {
  const zones = [];
  const m = view.modal;
  ctx.fillStyle = 'rgba(3,5,12,0.85)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = COLORS.text; ctx.font = `bold ${17 * u}px system-ui, sans-serif`;
  const lines = m.lines || [];
  const startY = Math.max(60 * u, H / 2 - (lines.length * 20 * u + 80 * u) / 2);
  ctx.fillText(m.title, W / 2, startY);
  let ly = startY + 30 * u;
  for (const line of lines) {
    if (line.length > 56) { ctx.font = `${11 * u}px ui-monospace, monospace`; ctx.fillStyle = COLORS.good; }
    else { ctx.font = `${14 * u}px system-ui, sans-serif`; ctx.fillStyle = COLORS.dim; }
    ctx.fillText(line, W / 2, ly, W - 48 * u);
    ly += 20 * u;
  }
  ly += 12 * u;

  const opts = m.options;
  if (opts.length === 1) {
    const bw = 220 * u, bh = 38 * u, x = W / 2 - bw / 2, y = ly;
    ctx.fillStyle = 'rgba(136,146,176,0.16)';
    ctx.strokeStyle = 'rgba(136,146,176,0.6)';
    ctx.fillRect(x, y, bw, bh); ctx.strokeRect(x, y, bw, bh);
    if (m.holdProgress > 0) {
      ctx.fillStyle = 'rgba(143,240,166,0.35)';
      ctx.fillRect(x, y, bw * m.holdProgress, bh);
    }
    ctx.fillStyle = COLORS.text; ctx.font = `bold ${13 * u}px system-ui, sans-serif`;
    // Touch dismisses on a plain tap (no hold tracked for it); keyboard/gamepad
    // require the deliberate hold. The dismiss control is ALWAYS blast —
    // options don't carry their own key hint at all (see mkModal in game.js).
    const label = view.device === 'touch'
      ? `Tap to ${opts[0].label}`
      : withHint(view.device, 'blast', `Hold to ${opts[0].label}`);
    ctx.fillText(label, x + bw / 2, y + bh / 2 + 5 * u);
    zones.push({ id: opts[0].id, x, y, w: bw, h: bh });
  } else {
    // No per-option key hint: every option (including a "not now"/"leave"
    // choice) is selected the SAME way — navigate to it, then confirm — it
    // is a choice like any other, not a button with its own dedicated key.
    // Cancel/B is a separate GLOBAL shortcut that backs out of the whole
    // dialog regardless of what's currently highlighted; it isn't "the
    // button for this one option," so it gets one shared hint below the
    // list instead of living on a single row.
    opts.forEach((opt, i) => {
      const bw = 260 * u, bh = 34 * u, x = W / 2 - bw / 2, y = ly + i * (bh + 8 * u);
      const on = m.sel === i;
      ctx.fillStyle = 'rgba(136,146,176,0.16)';
      ctx.strokeStyle = on ? COLORS.pickup : 'rgba(136,146,176,0.5)';
      ctx.lineWidth = on ? 2 : 1;
      ctx.fillRect(x, y, bw, bh); ctx.strokeRect(x, y, bw, bh); ctx.lineWidth = 1;
      ctx.fillStyle = COLORS.text; ctx.font = `${13 * u}px system-ui, sans-serif`;
      ctx.fillText(opt.usable === false ? `${opt.label} (key item)` : opt.label, x + bw / 2, y + bh / 2 + 4 * u);
      zones.push({ id: opt.id, x, y, w: bw, h: bh });
    });
    if (view.device !== 'touch') {
      const upDown = keyHint(view.device, 'up') === keyHint(view.device, 'down')
        ? keyHint(view.device, 'up') // e.g. gamepad: both are "D-Pad"
        : `${keyHint(view.device, 'up')}/${keyHint(view.device, 'down')}`;
      ctx.fillStyle = COLORS.dim; ctx.font = `${11 * u}px system-ui, sans-serif`;
      ctx.fillText(
        `${upDown} choose · ${keyHint(view.device, 'confirm')} select · ${keyHint(view.device, 'cancel')} back out`,
        W / 2, ly + opts.length * (34 * u + 8 * u) + 16 * u,
      );
    }
  }
  ctx.textAlign = 'left';
  return zones;
}

// --- helpers ----------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampCam(v, worldSize, viewSize) {
  if (worldSize <= viewSize) return (worldSize - viewSize) / 2;
  return clamp(v, 0, worldSize - viewSize);
}

function fillSquashed(ctx, x, y, w, h, strength, stretch = false) {
  if (!strength) { ctx.fillRect(x, y, w, h); return; }
  const amt = 0.35 * strength;
  const sx = stretch ? 1 - amt * 0.6 : 1 + amt;
  const sy = stretch ? 1 + amt * 0.6 : 1 - amt;
  const cx = x + w / 2, cy = y + h / 2, nw = w * sx, nh = h * sy;
  ctx.fillRect(cx - nw / 2, cy - nh / 2, nw, nh);
}

function bar(ctx, x, y, w, h, frac, color, label, u) {
  ctx.fillStyle = COLORS.bar; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.fillStyle = COLORS.text; ctx.font = `${9 * u}px system-ui, sans-serif`;
  ctx.fillText(label, x + 4 * u, y + h - 2.5 * u);
}

function touchBtn(ctx, z, u = 1) {
  ctx.fillStyle = 'rgba(136,146,176,0.18)';
  ctx.strokeStyle = 'rgba(136,146,176,0.6)';
  ctx.fillRect(z.x, z.y, z.w, z.h); ctx.strokeRect(z.x, z.y, z.w, z.h);
  ctx.fillStyle = COLORS.text; ctx.font = `bold ${12 * u}px system-ui, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(z.label, z.x + z.w / 2, z.y + z.h / 2 + 4 * u); ctx.textAlign = 'left';
  return z;
}

function toGray(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const cr = Math.round(y * 0.9), cg = Math.round(y * 0.95), cb = Math.min(255, Math.round(y * 1.08));
  return `#${((cr << 16) | (cg << 8) | cb).toString(16).padStart(6, '0')}`;
}
