// Pure, deterministic visibility computation from the player's position over
// `state.region.blocked` opacity (0-100 per tile). Lives in src/sim because
// opacity is authoritative content and this may be reused later by enemy
// AI/stealth — but it is a READ, not a reducer: it never mutates state, so it
// is not part of saved state any more than dist()/canSense() are (same
// pattern as src/sim/info.js).
//
// Integer-only by construction: a Bresenham line from the player to each
// candidate tile is walked in pure integer steps; each occluder crossed along
// that line multiplies a "clarity" percentage (0-100, integer, floor-divided)
// by (100-opacity)/100. This supports PARTIAL occluders (a future 40-opacity
// bush only dims, doesn't blank), unlike classic binary shadowcasting, while
// staying exact — no floats, no trig, safe for the determinism guard.

// Integer Bresenham line from (x0,y0) to (x1,y1), inclusive of both ends.
function bresenhamLine(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return pts;
}

// Returns a Map of "x,y" -> clarity (0-100 integer; 100 = fully lit/visible,
// 0 = fully shadowed) for every tile within `radius` Chebyshev tiles of
// (originX, originY). The origin tile itself is always fully clear.
export function computeVisibility(state, originX, originY, radius) {
  const clarity = new Map();
  const blocked = state.region.blocked;
  const w = state.region.w, h = state.region.h;
  const minX = Math.max(0, originX - radius), maxX = Math.min(w - 1, originX + radius);
  const minY = Math.max(0, originY - radius), maxY = Math.min(h - 1, originY + radius);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (Math.max(Math.abs(tx - originX), Math.abs(ty - originY)) > radius) continue;
      const key = `${tx},${ty}`;
      if (tx === originX && ty === originY) { clarity.set(key, 100); continue; }
      const line = bresenhamLine(originX, originY, tx, ty);
      let c = 100;
      // Occluders strictly BETWEEN origin and target attenuate; the target
      // tile's own opacity (if it's a wall) does not hide the wall itself —
      // a wall is drawn as an occluder, not hidden from its own tile.
      for (let i = 1; i < line.length - 1; i++) {
        const [lx, ly] = line[i];
        const op = blocked[`${lx},${ly}`];
        if (op) c = Math.floor((c * (100 - op)) / 100);
        if (c <= 0) break;
      }
      clarity.set(key, Math.max(0, c));
    }
  }
  return clarity;
}
