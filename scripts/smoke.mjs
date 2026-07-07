// Headless smoke suite — the Stage 0 gate. Run: npm run smoke (or node scripts/smoke.mjs)
// No stage begins until this passes. Zero dependencies, pure Node.
//
// Wrong Sky re-establishes the Prologue's deterministic harness from scratch;
// this suite is the mechanical proof that it holds (canonical serialization,
// seeded RNG, save/load parity, golden replay fingerprint, and a grep guard
// that keeps ambient nondeterminism out of src/sim).

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { stableStringify } from '../src/sim/canonical.js';
import { fingerprint, fnv1a32 } from '../src/sim/fingerprint.js';
import { makeRng, nextU32, nextInt } from '../src/sim/rng.js';
import { makeWorld, FIELD_W, FIELD_H } from '../src/sim/world.js';
import { reduce, replay } from '../src/sim/reduce.js';
import { DEMO_SEED, demoCommands } from '../src/sim/demo.js';

// Baked golden value for the demo playthrough. An INTENDED sim change updates
// this one line (review the diff); an unintended divergence is a bug.
const GOLDEN_DEMO_FINGERPRINT = '9f3e39c0';

const failures = [];
let count = 0;
function test(name, fn) {
  count++;
  try {
    fn();
    console.log(`  ok ${count} - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  FAIL ${count} - ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: ${a} !== ${b}`);
}

const runDemo = () => {
  const w = makeWorld(DEMO_SEED);
  replay(w, demoCommands());
  return w;
};

console.log('# canonical serialization');

test('key order does not change output', () => {
  assertEqual(stableStringify({ a: 1, b: [2, { d: 4, c: 3 }] }),
    stableStringify({ b: [2, { c: 3, d: 4 }], a: 1 }));
});

test('integer-like keys serialize identically regardless of insertion', () => {
  const x = {}; x['10'] = 'a'; x['2'] = 'b';
  const y = {}; y['2'] = 'b'; y['10'] = 'a';
  assertEqual(stableStringify(x), stableStringify(y));
});

test('-0 normalizes to 0', () => {
  assertEqual(stableStringify({ v: -0 }), stableStringify({ v: 0 }));
});

test('NaN / Infinity / undefined fail loud', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    let threw = false;
    try { stableStringify({ bad }); } catch { threw = true; }
    assert(threw, `expected throw for ${bad}`);
  }
});

console.log('# seeded rng (sfc32, full-state saves)');

test('same seed, same stream', () => {
  const a = makeRng(12345), b = makeRng(12345);
  for (let i = 0; i < 100; i++) assertEqual(nextU32(a), nextU32(b));
});

test('state restores in O(1) mid-stream and continues identically', () => {
  const a = makeRng(777);
  for (let i = 0; i < 50; i++) nextU32(a);
  const saved = JSON.parse(JSON.stringify(a));
  const tail = [];
  for (let i = 0; i < 20; i++) tail.push(nextU32(a));
  const b = saved; // restore
  for (let i = 0; i < 20; i++) assertEqual(nextU32(b), tail[i]);
});

test('nextInt is in range and rejects bad n', () => {
  const r = makeRng(9);
  for (let i = 0; i < 500; i++) { const v = nextInt(r, 6); assert(v >= 0 && v < 6); }
  for (const bad of [0, -1, 2.5, NaN]) {
    let threw = false;
    try { nextInt(makeRng(1), bad); } catch { threw = true; }
    assert(threw, `nextInt should reject n=${bad}`);
  }
});

console.log('# fingerprint / golden replay');

test('demo playthrough matches the baked golden fingerprint', () => {
  const fp = fingerprint(runDemo());
  assertEqual(fp, GOLDEN_DEMO_FINGERPRINT,
    `golden drift — if intended, update GOLDEN_DEMO_FINGERPRINT to ${fp}`);
});

test('fingerprint is stable across an identical re-run', () => {
  assertEqual(fingerprint(runDemo()), fingerprint(runDemo()));
});

test('fnv1a32 is deterministic and 8 hex chars', () => {
  const h = fnv1a32('the sky is wrong');
  assertEqual(h, fnv1a32('the sky is wrong'));
  assert(/^[0-9a-f]{8}$/.test(h), `bad hash shape: ${h}`);
});

console.log('# save / load mid-run parity');

test('save → load mid-stream equals an uninterrupted run', () => {
  const cmds = demoCommands();
  const half = Math.floor(cmds.length / 2);

  const uninterrupted = makeWorld(DEMO_SEED);
  replay(uninterrupted, cmds);

  const first = makeWorld(DEMO_SEED);
  replay(first, cmds.slice(0, half));
  const reloaded = JSON.parse(JSON.stringify(first)); // save → load
  replay(reloaded, cmds.slice(half));

  assertEqual(fingerprint(reloaded), fingerprint(uninterrupted));
});

console.log('# skeleton verbs');

test('demo exercises every skeleton verb (move, damage, tier, tick, blocked)', () => {
  const w = makeWorld(DEMO_SEED);
  let sawBlocked = false, sawDamaged = false, sawTier = false;
  for (const c of demoCommands()) {
    const ev = reduce(w, c);
    if (ev.some((e) => e.type === 'blocked')) sawBlocked = true;
    if (ev.some((e) => e.type === 'damaged')) sawDamaged = true;
    if (ev.some((e) => e.type === 'tier_unlocked')) sawTier = true;
  }
  assert(sawBlocked, 'blocked-move refusal path never exercised');
  assert(sawDamaged, 'DAMAGE never exercised');
  assert(sawTier, 'UNLOCK_TIER never exercised');
  assert(w.visualTier === 2, `expected 2 tiers unlocked, got ${w.visualTier}`);
  assert(w.player.hp < w.player.maxHp, 'player took no damage');
});

test('MOVE clamps to the field and refuses (never leaves bounds)', () => {
  const w = makeWorld(1);
  for (let i = 0; i < 50; i++) reduce(w, { type: 'MOVE', dx: -1, dy: -1 });
  assertEqual(w.player.x, 0, 'x escaped the west wall');
  assertEqual(w.player.y, 0, 'y escaped the north wall');
  for (let i = 0; i < 50; i++) reduce(w, { type: 'MOVE', dx: 1, dy: 1 });
  assertEqual(w.player.x, FIELD_W - 1, 'x escaped the east wall');
  assertEqual(w.player.y, FIELD_H - 1, 'y escaped the south wall');
});

test('MOVE rejects a step bigger than one tile', () => {
  let threw = false;
  try { reduce(makeWorld(1), { type: 'MOVE', dx: 2, dy: 0 }); } catch { threw = true; }
  assert(threw, 'a >1 tile step should fail loud');
});

test('unknown command fails loud', () => {
  let threw = false;
  try { replay(makeWorld(1), [{ type: 'NOPE' }]); } catch { threw = true; }
  assert(threw);
});

test('authoritative fields stay integers through a full demo', () => {
  const w = runDemo();
  for (const [k, v] of Object.entries({ tick: w.tick, x: w.player.x, y: w.player.y, hp: w.player.hp, tier: w.visualTier })) {
    assert(Number.isInteger(v), `${k} is not an integer: ${v}`);
  }
});

console.log('# determinism guard: forbidden tokens in src/sim');

test('src/sim never touches ambient time, randomness, or engine-varying math', () => {
  const simDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim');
  // Math.sqrt/abs/floor/ceil/round/min/max/trunc/sign/imul are IEEE-exact and allowed.
  const banned = /Math\.random|Date\.now|performance\.now|new Date|Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt)\b/;
  for (const f of readdirSync(simDir)) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(simDir, f), 'utf8');
    const m = src.match(banned);
    assert(!m, `${f} contains banned token: ${m && m[0]}`);
  }
});

console.log('');
if (failures.length) {
  console.error(`SMOKE FAILED: ${failures.length}/${count} test(s)`);
  process.exit(1);
}
console.log(`SMOKE PASSED: ${count}/${count}`);
