// Canvas renderer. Receives the world through the read-only proxy — it can look
// at everything and touch nothing. Continuous cosmetic detail (smooth sprite
// positions, camera, toast fades, lighting) lives HERE, never in authoritative
// state. Returns this frame's touch/click zones so input hit-tests what was
// drawn.
//
// WRONG SKY presentation pillars, all driven by the authoritative `visual`
// facets the player restores by attuning wells:
//   - color: the world is drawn GRAYSCALE until restored, then in full palette.
//   - light: once restored, a darkness layer with pools of light around the
//            player, the wells, and the rift (emissive) — walls stay opaque
//            occluders you can't see through. Flat/washed before.
//   - depth: once restored, entities are Y-SORTED with ground shadows so the
//            scene reads as having real depth. Flat layer order before.
// The camera follows the player and clamps to the region, so the world fills
// the viewport at any resolution (fill-not-letterbox). HUD/text is anchored in
// screen space with its OWN scale — world scale and text scale are separate on
// purpose (Brain: test#E11, data-sized text drifts under a uniform world scale).

import { canSense, enemyReadout } from '../sim/info.js';
import { withHint } from './device-labels.js';
import { describeObjective } from './objective-text.js';

export const TILE = 24;

export const COLORS = {
  bg: '#05070f', ground: '#141a2e', grid: '#1b2340', wall: '#39436a',
  player: '#ffb74d', aura: '#7ec8ff', npc: '#6de0c2', enemy: '#e05a5a',
  dead: '#3a3f52', crate: '#a1745b', pickup: '#ffd75e', text: '#e6ebf7',
  dim: '#98a3c0', hp: '#e05a5a', bar: '#1a2140', good: '#8ff0a6',
  well: '#b48cff', wellOn: '#e0d0ff', rival: '#ff6b8a', rift: '#8fd0ff',
};

// Grayscale twin of the palette (luminance), used until `color` is restored.
// Precomputed once — cheap, and keeps the drained look one lookup away.
const GRAY = {};
for (const [k, hex] of Object.entries(COLORS)) GRAY[k] = toGray(hex);

let lightLayer = null; // offscreen darkness canvas for the `light` facet

export function render(ctx, w, view) {
  const { canvas } = ctx;
  const W = canvas.width, H = canvas.height;
  const zones = [];
  const vis = w.visual;
  const C = vis.color ? COLORS : GRAY; // active palette

  // Background (a touch of cold even when "colored" — this sky is still wrong).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // --- camera + world scale ------------------------------------------------
  // Scale so ~16 tiles are visible tall; the width shows however many fit. The
  // camera centers the player and clamps to the region so there are no black
  // bars (the region is larger than the view in both axes).
  const scale = H / (16 * TILE);
  const regionWpx = w.region.w * TILE, regionHpx = w.region.h * TILE;
  const viewWpx = W / scale, viewHpx = H / scale;
  const centerX = view.px * TILE + TILE / 2, centerY = view.py * TILE + TILE / 2;
  const camX = clampCam(centerX - viewWpx / 2, regionWpx, viewWpx);
  const camY = clampCam(centerY - viewHpx / 2, regionHpx, viewHpx);
  // World transform: world px -> screen px, plus screen-space shake.
  ctx.setTransform(scale, 0, 0, scale, -camX * scale + (view.shakeX || 0), -camY * scale + (view.shakeY || 0));

  // Visible world-tile bounds (viewport culling — only draw what's on screen).
  const pad = 1;
  const minTX = Math.max(0, Math.floor(camX / TILE) - pad);
  const maxTX = Math.min(w.region.w - 1, Math.floor((camX + viewWpx) / TILE) + pad);
  const minTY = Math.max(0, Math.floor(camY / TILE) - pad);
  const maxTY = Math.min(w.region.h - 1, Math.floor((camY + viewHpx) / TILE) + pad);
  const onScreen = (x, y) => x >= minTX - pad && x <= maxTX + pad && y >= minTY - pad && y <= maxTY + pad;

  // --- ground + grid (culled) ---
  ctx.fillStyle = C.ground;
  ctx.fillRect(minTX * TILE, minTY * TILE, (maxTX - minTX + 1) * TILE, (maxTY - minTY + 1) * TILE);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let x = minTX; x <= maxTX + 1; x++) { ctx.beginPath(); ctx.moveTo(x * TILE, minTY * TILE); ctx.lineTo(x * TILE, (maxTY + 1) * TILE); ctx.stroke(); }
  for (let y = minTY; y <= maxTY + 1; y++) { ctx.beginPath(); ctx.moveTo(minTX * TILE, y * TILE); ctx.lineTo((maxTX + 1) * TILE, y * TILE); ctx.stroke(); }

  const drawWall = (x, y) => { ctx.fillStyle = C.wall; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); };
  const walls = [];
  for (const key of Object.keys(w.region.blocked)) {
    const [x, y] = key.split(',').map(Number);
    if (onScreen(x, y)) { walls.push([x, y]); drawWall(x, y); }
  }

  // --- build the drawable list (entities) ---
  // Each drawable knows its baseline y (feet) for Y-sorting and a draw fn.
  const drawables = [];
  const add = (x, y, fn, opts = {}) => { if (onScreen(x, y)) drawables.push({ x, y, fn, glow: opts.glow || null }); };

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
    }, { glow: C.pickup });
  }
  for (const id of Object.keys(w.wells)) {
    const wl = w.wells[id];
    add(wl.x, wl.y, () => {
      const [x, y] = tile(wl.x, wl.y);
      const cx = x + TILE / 2, cy = y + TILE / 2;
      // Unattuned wells pulse a dim ring (a beacon: attention, then attune);
      // attuned wells glow bright in their facet's spirit.
      ctx.strokeStyle = wl.attuned ? C.wellOn : C.well;
      ctx.lineWidth = wl.attuned ? 3 : 2;
      ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.34, 0, Math.PI * 2); ctx.stroke();
      if (wl.attuned) { ctx.fillStyle = C.wellOn; ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.16, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 1;
    }, { glow: wl.attuned ? C.wellOn : null });
  }
  for (const id of Object.keys(w.npcs)) {
    const n = w.npcs[id];
    add(n.x, n.y, () => {
      const [x, y] = tile(n.x, n.y);
      ctx.fillStyle = C.npc;
      ctx.fillRect(x + 5, y + 4, TILE - 10, TILE - 7);
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
      ctx.fillStyle = !e.alive ? C.dead : (isBoss ? C.rival : C.enemy);
      fillSquashed(ctx, x + 5 - big, y + 5 - big, TILE - 10 + big * 2, TILE - 10 + big * 2, view.punch[id] || 0);
      if (e.alive) {
        if (canSense(w.player, e.kind)) {
          ctx.fillStyle = C.bar; ctx.fillRect(x + 3, y - 6, TILE - 6, 3);
          ctx.fillStyle = C.hp; ctx.fillRect(x + 3, y - 6, (TILE - 6) * (e.hp / e.maxHp), 3);
        }
        ctx.fillStyle = C.dim; ctx.font = '8px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(enemyReadout(w.player, e), x + TILE / 2, y - 9); ctx.textAlign = 'left';
      }
    }, { glow: isBoss && e.alive ? C.rival : null });
  }
  // Player (smooth display position).
  const ppx = view.px * TILE, ppy = view.py * TILE;
  add(view.px, view.py, () => {
    if (w.player.aura > 0) {
      ctx.strokeStyle = C.aura;
      ctx.globalAlpha = 0.25 + 0.5 * (w.player.aura / w.player.maxAura);
      ctx.beginPath(); ctx.arc(ppx + TILE / 2, ppy + TILE / 2, TILE * 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (view.dodging) ctx.globalAlpha = 0.45;
    ctx.fillStyle = C.player;
    fillSquashed(ctx, ppx + 4, ppy + 4, TILE - 8, TILE - 8, view.playerPunch || 0, true);
    ctx.globalAlpha = 1;
  }, { glow: w.player.aura > 0 ? C.aura : C.player });

  // Depth facet: Y-sort so nearer (higher y) entities overlap farther ones, and
  // give each a ground shadow. Without it, a flat, stable draw order and no
  // shadows — the world reads as paper-flat until depth is restored.
  if (vis.depth) {
    drawables.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (const d of drawables) {
      const [x, y] = tile(d.x, d.y);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(x + TILE / 2, y + TILE - 3, TILE * 0.34, TILE * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const d of drawables) d.fn();

  // Light facet: dark everywhere except pools around the player, attuned wells,
  // the boss, and the rift edge (emissive). Walls are redrawn opaque on top so
  // they read as solid occluders. Skipped entirely until `light` is restored.
  if (vis.light) {
    const sources = [{ x: view.px, y: view.py, r: 4.2 }];
    for (const id of Object.keys(w.wells)) { const wl = w.wells[id]; if (wl.attuned && onScreen(wl.x, wl.y)) sources.push({ x: wl.x, y: wl.y, r: 2.6 }); }
    const edge = w.region.zones['rift-edge']; if (edge) sources.push({ x: edge.x, y: edge.y, r: 3.2 });
    for (const id of Object.keys(w.enemies)) { const e = w.enemies[id]; if (e.alive && id === w.arc.bossDef.id && onScreen(e.x, e.y)) sources.push({ x: e.x, y: e.y, r: 2.6 }); }
    drawLight(ctx, W, H, scale, camX, camY, view, sources);
    // walls stay solid through the dark
    for (const [x, y] of walls) drawWall(x, y);
  }

  // Dusk/night: the integer world clock raises enemy aggression (daynight.js);
  // a faint screen-space tint so that pressure reads visually. Light-restored
  // scenes are already dark, so ease it down there. Drawn over the world but
  // under the HUD (which follows), so text stays readable.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (view.night > 0.05) {
    ctx.fillStyle = `rgba(8,12,34,${(view.night * (vis.light ? 0.16 : 0.34)).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // --- HUD (screen space, its own scale) -----------------------------------
  const u = clamp(H / 540, 0.85, 3); // ui scale — anchored to height, NOT world scale
  ctx.textAlign = 'left';
  const pad2 = 12 * u;

  bar(ctx, pad2, pad2, 150 * u, 12 * u, w.player.hp / w.player.maxHp, COLORS.hp, `HP ${w.player.hp}/${w.player.maxHp}`, u);
  bar(ctx, pad2, pad2 + 18 * u, 150 * u, 12 * u, w.player.aura / w.player.maxAura, COLORS.aura, `Aura ${w.player.aura}/${w.player.maxAura}`, u);
  ctx.fillStyle = COLORS.pickup; ctx.font = `${12 * u}px system-ui, sans-serif`;
  ctx.fillText(`⛁ ${w.player.coins}`, pad2 + 162 * u, pad2 + 10 * u);
  ctx.fillStyle = COLORS.dim;
  const sk = w.player.skills;
  ctx.fillText(`Melee ${sk.melee.lvl} · Aura ${sk.aura.lvl} · Per ${sk.perception.lvl}`, pad2 + 162 * u, pad2 + 28 * u);

  // Facet status — what the world has remembered so far.
  const facets = [['color', vis.color], ['light', vis.light], ['depth', vis.depth], ['sound', w.flags.audio]];
  ctx.font = `${11 * u}px system-ui, sans-serif`;
  let fx = pad2;
  const fy = pad2 + 44 * u;
  ctx.fillStyle = COLORS.dim; ctx.fillText('sky:', fx, fy); fx += 30 * u;
  for (const [name, on] of facets) {
    ctx.fillStyle = on ? COLORS.good : 'rgba(152,163,192,0.4)';
    ctx.fillText(on ? `✦${name}` : `·${name}`, fx, fy);
    fx += (name.length * 7 + 16) * u;
  }

  // Quest tracker (top-right).
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

  // Arc guide (top center, one line).
  if (view.guide) {
    ctx.fillStyle = COLORS.pickup; ctx.font = `italic ${13 * u}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(view.guide, W / 2, pad2 + 6 * u); ctx.textAlign = 'left';
  }

  // Toasts (bottom-left).
  ctx.font = `${12 * u}px system-ui, sans-serif`;
  view.toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.ttl / 600));
    ctx.fillStyle = COLORS.good;
    ctx.fillText(t.text, pad2, H - 40 * u - i * 16 * u);
  });
  ctx.globalAlpha = 1;

  // Control legend (bottom).
  ctx.fillStyle = COLORS.dim; ctx.font = `${11 * u}px system-ui, sans-serif`;
  const legends = {
    keyboard: 'Move WASD · Attack J · Blast K · Charge L · Interact E · Items I · Dodge Space',
    gamepad: 'Move Stick/D-Pad · Attack A · Blast X · Charge Y · Interact RB · Items Start · Dodge B',
    touch: 'On-screen pad and buttons',
  };
  ctx.fillText(legends[view.device] || legends.keyboard, pad2, H - 10 * u);

  // --- touch controls ------------------------------------------------------
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

  // --- modal ---------------------------------------------------------------
  if (view.modal) zones.push(...drawModal(ctx, W, H, u, view));

  return zones;

  function tile(x, y) { return [x * TILE, y * TILE]; }
}

// --- lighting ---------------------------------------------------------------
// Offscreen darkness layer with radial holes punched at light sources; drawn
// over the world so lit pools reveal it and everything else falls dark. A cheap
// stand-in for full shadow-casting — walls are redrawn opaque by the caller so
// they still read as things you cannot see through.
function drawLight(ctx, W, H, scale, camX, camY, view, sources) {
  if (!lightLayer || lightLayer.width !== W || lightLayer.height !== H) {
    lightLayer = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (lightLayer) { lightLayer.width = W; lightLayer.height = H; }
  }
  if (!lightLayer) return;
  const lc = lightLayer.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, W, H);
  lc.fillStyle = 'rgba(3,5,14,0.72)';
  lc.fillRect(0, 0, W, H);
  lc.globalCompositeOperation = 'destination-out';
  for (const s of sources) {
    const sx = (s.x * TILE + TILE / 2 - camX) * scale + (view.shakeX || 0);
    const sy = (s.y * TILE + TILE / 2 - camY) * scale + (view.shakeY || 0);
    const r = s.r * TILE * scale;
    const g = lc.createRadialGradient(sx, sy, r * 0.15, sx, sy, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath(); lc.arc(sx, sy, r, 0, Math.PI * 2); lc.fill();
  }
  lc.globalCompositeOperation = 'source-over';
  // Blit in screen space, but SAVE/RESTORE so the caller's world transform is
  // intact afterward — the caller redraws the wall occluders in world coords
  // right after this returns.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(lightLayer, 0, 0);
  ctx.restore();
}

// --- modal ------------------------------------------------------------------
function drawModal(ctx, W, H, u, view) {
  const zones = [];
  const m = view.modal;
  ctx.fillStyle = 'rgba(3,5,12,0.85)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  if (m.kind === 'inventory') {
    ctx.fillStyle = COLORS.text; ctx.font = `bold ${17 * u}px system-ui, sans-serif`;
    ctx.fillText('Satchel', W / 2, H * 0.22);
    const items = m.items; // [{id, name, count, usable}]
    if (!items.length) {
      ctx.fillStyle = COLORS.dim; ctx.font = `${13 * u}px system-ui, sans-serif`;
      ctx.fillText('Empty. The Reach has given you nothing yet.', W / 2, H * 0.22 + 40 * u);
    } else {
      items.forEach((it, i) => {
        const bw = 300 * u, bh = 34 * u, x = W / 2 - bw / 2, y = H * 0.22 + 24 * u + i * (bh + 8 * u);
        const on = i === m.sel;
        ctx.fillStyle = 'rgba(136,146,176,0.16)';
        ctx.strokeStyle = on ? COLORS.pickup : 'rgba(136,146,176,0.5)';
        ctx.lineWidth = on ? 2 : 1; ctx.fillRect(x, y, bw, bh); ctx.strokeRect(x, y, bw, bh); ctx.lineWidth = 1;
        ctx.fillStyle = COLORS.text; ctx.font = `${13 * u}px system-ui, sans-serif`; ctx.textAlign = 'left';
        ctx.fillText(`${it.name}${it.count > 1 ? ` ×${it.count}` : ''}`, x + 12 * u, y + bh / 2 + 4 * u);
        ctx.textAlign = 'right'; ctx.fillStyle = it.usable ? COLORS.good : COLORS.dim;
        ctx.fillText(it.usable ? 'use' : 'key item', x + bw - 12 * u, y + bh / 2 + 4 * u);
        ctx.textAlign = 'center';
        zones.push({ id: `item:${it.id}`, x, y, w: bw, h: bh });
      });
    }
    ctx.fillStyle = COLORS.dim; ctx.font = `${11 * u}px system-ui, sans-serif`;
    ctx.fillText(withHint(view.device, 'cancel', 'Close'), W / 2, H * 0.82);
    ctx.textAlign = 'left';
    return zones;
  }

  const lines = m.lines || [];
  ctx.fillStyle = COLORS.text; ctx.font = `bold ${17 * u}px system-ui, sans-serif`;
  const startY = Math.max(60 * u, H / 2 - (lines.length * 20 * u + 80 * u) / 2);
  ctx.fillText(m.title, W / 2, startY);
  let ly = startY + 30 * u;
  for (const line of lines) {
    if (line.length > 56) { ctx.font = `${11 * u}px ui-monospace, monospace`; ctx.fillStyle = COLORS.good; }
    else { ctx.font = `${14 * u}px system-ui, sans-serif`; ctx.fillStyle = COLORS.dim; }
    ctx.fillText(line, W / 2, ly, W - 48 * u);
    ly += 20 * u;
  }
  (m.buttons || []).forEach((b, i) => {
    const bw = 190 * u, bh = 34 * u, x = W / 2 - bw / 2, y = ly + 12 * u + i * 44 * u;
    const label = withHint(view.device, b.hintAction || b.id, b.label);
    zones.push(touchBtn(ctx, { id: b.id, label, x, y, w: bw, h: bh }, u));
  });
  ctx.textAlign = 'left';
  return zones;
}

// --- helpers ----------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampCam(v, worldSize, viewSize) {
  if (worldSize <= viewSize) return (worldSize - viewSize) / 2; // center if region smaller than view
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

// Luminance grayscale of a #rrggbb — the drained look before `color` returns.
function toGray(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  // Nudge toward a cold slate so "drained" reads as eerie, not just gray.
  const cr = Math.round(y * 0.9), cg = Math.round(y * 0.95), cb = Math.min(255, Math.round(y * 1.08));
  return `#${((cr << 16) | (cg << 8) | cb).toString(16).padStart(6, '0')}`;
}
