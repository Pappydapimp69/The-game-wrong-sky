// Boot shell (Stage 0). Everything here is presentation; the sim lives in
// src/sim and is only ever mutated through reduce(). The walking skeleton has
// no live input yet, so the boot page's job is the browser-parity check: run
// the exact same deterministic demo the Node smoke suite runs and render the
// resulting state + fingerprint. If the on-canvas fingerprint matches the Node
// golden, the browser and Node agree bit-for-bit on the sim.

import { makeWorld, FIELD_W, FIELD_H } from './sim/world.js';
import { replay } from './sim/reduce.js';
import { demoCommands, DEMO_SEED } from './sim/demo.js';
import { fingerprint } from './sim/fingerprint.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const world = makeWorld(DEMO_SEED);
replay(world, demoCommands());
const fp = fingerprint(world);

// Deliberately muted, near-colorless palette — the Prologue's look. Wrong
// Sky's whole arc is about restoring color/light from here (later stages).
ctx.fillStyle = '#0a0d16';
ctx.fillRect(0, 0, canvas.width, canvas.height);

const tile = Math.floor(Math.min(canvas.width, canvas.height) / (FIELD_H + 4));
const ox = Math.floor((canvas.width - FIELD_W * tile) / 2);
const oy = Math.floor((canvas.height - FIELD_H * tile) / 2) - 8;

ctx.strokeStyle = '#1b2233';
for (let y = 0; y < FIELD_H; y++) {
  for (let x = 0; x < FIELD_W; x++) {
    ctx.strokeRect(ox + x * tile, oy + y * tile, tile, tile);
  }
}
ctx.fillStyle = '#8a93a6';
ctx.fillRect(ox + world.player.x * tile + 2, oy + world.player.y * tile + 2, tile - 4, tile - 4);

ctx.fillStyle = '#aeb7c9';
ctx.font = '12px system-ui, sans-serif';
ctx.textBaseline = 'top';
ctx.fillText(`Wrong Sky — Stage 0 skeleton`, ox, 8);
ctx.fillText(`tier ${world.visualTier}   hp ${world.player.hp}/${world.player.maxHp}   tick ${world.tick}`, ox, oy + FIELD_H * tile + 10);
ctx.fillText(`fingerprint ${fp}`, ox, oy + FIELD_H * tile + 28);

// Headless hooks: a Playwright check reads these and compares __fp to the
// Node golden to confirm cross-environment determinism.
window.__fp = fp;
window.__world = world;
