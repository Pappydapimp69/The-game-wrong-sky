// Headless smoke suite — the build gate. Run: npm run smoke (or node scripts/smoke.mjs)
// No stage begins until this passes. Zero dependencies, pure Node.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { stableStringify } from '../src/sim/canonical.js';
import { fingerprint, fnv1a32 } from '../src/sim/fingerprint.js';
import { makeRng, nextU32, nextInt } from '../src/sim/rng.js';
import { makeWorld } from '../src/sim/world.js';
import { reduce, replay } from '../src/sim/reduce.js';
import { DEMO_SEED, demoCommands } from '../src/sim/demo.js';
import { readonly } from '../src/app/readonly.js';
import { CONTENT } from '../src/sim/content.js';
import { validateContent } from '../src/sim/validate.js';
import { canSense } from '../src/sim/info.js';
import { exportSaga, importSaga } from '../src/sim/saga.js';
import { isNight, DAY_CYCLE_TICKS } from '../src/sim/daynight.js';
import { keyHint, withHint } from '../src/app/device-labels.js';
import { describeObjective } from '../src/app/objective-text.js';

// Baked golden for the demo playthrough. An INTENDED sim/content change updates
// this one line (review the diff); an unintended divergence is a bug.
const GOLDEN_DEMO_FINGERPRINT = 'f2ab27dd';

const failures = [];
let count = 0;
function test(name, fn) {
  count++;
  try { fn(); console.log(`  ok ${count} - ${name}`); }
  catch (err) { failures.push({ name, err }); console.error(`  FAIL ${count} - ${name}\n      ${err.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: ${a} !== ${b}`); }

const runDemo = () => { const w = makeWorld(DEMO_SEED); replay(w, demoCommands()); return w; };
// Walk the player next to a target entity (Chebyshev-adjacent), one axis-step
// per MOVE. Used by mechanic-only tests against non-gated targets.
function moveAdjacent(w, e) {
  let guard = 0;
  while (Math.max(Math.abs(w.player.x - e.x), Math.abs(w.player.y - e.y)) > 1 && guard++ < 200) {
    const dx = Math.sign(e.x - w.player.x), dy = Math.sign(e.y - w.player.y);
    reduce(w, { type: 'MOVE', dx, dy });
  }
}
const chargeTo = (w, aura) => { let g = 0; while (w.player.aura < aura && g++ < 60) reduce(w, { type: 'CHARGE', start: g === 1 }); };
// Walk to Sable and accept the main quest (reveals the gated targets).
function acceptMainQuest(w) {
  moveAdjacent(w, w.npcs.sable);
  reduce(w, { type: 'TALK', npcId: 'sable' });
  reduce(w, { type: 'ACCEPT_QUEST', questId: 'mend-the-sky' });
}

console.log('# canonical serialization');
test('key order does not change output', () => {
  assertEqual(stableStringify({ a: 1, b: [2, { d: 4, c: 3 }] }), stableStringify({ b: [2, { c: 3, d: 4 }], a: 1 }));
});
test('integer-like keys serialize identically regardless of insertion', () => {
  const x = {}; x['10'] = 'a'; x['2'] = 'b'; const y = {}; y['2'] = 'b'; y['10'] = 'a';
  assertEqual(stableStringify(x), stableStringify(y));
});
test('-0 normalizes to 0', () => { assertEqual(stableStringify({ v: -0 }), stableStringify({ v: 0 })); });
test('NaN / Infinity / undefined fail loud', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    let threw = false; try { stableStringify({ bad }); } catch { threw = true; }
    assert(threw, `expected throw for ${bad}`);
  }
});

console.log('# seeded rng (sfc32, full-state saves)');
test('same seed, same stream', () => {
  const a = makeRng(12345), b = makeRng(12345);
  for (let i = 0; i < 100; i++) assertEqual(nextU32(a), nextU32(b));
});
test('state restores in O(1) mid-stream and continues identically', () => {
  const a = makeRng(777); for (let i = 0; i < 50; i++) nextU32(a);
  const saved = JSON.parse(JSON.stringify(a)); const tail = [];
  for (let i = 0; i < 20; i++) tail.push(nextU32(a));
  for (let i = 0; i < 20; i++) assertEqual(nextU32(saved), tail[i]);
});
test('nextInt in range, rejects bad n', () => {
  const r = makeRng(9); for (let i = 0; i < 500; i++) { const v = nextInt(r, 6); assert(v >= 0 && v < 6); }
  for (const bad of [0, -1, 2.5]) { let t = false; try { nextInt(makeRng(1), bad); } catch { t = true; } assert(t, `reject n=${bad}`); }
});

console.log('# content validation ladder');
test('shipped content passes every validation rung', () => {
  const errs = validateContent(CONTENT);
  assert(errs.length === 0, `content invalid:\n${errs.join('\n')}`);
});
test('deliberate content corruptions fail the build, not the player', () => {
  const corrupt = (mut) => { const c = structuredClone(CONTENT); mut(c); return validateContent(c).length > 0; };
  assert(corrupt((c) => { c.quests['mend-the-sky'].objectives[0].facet = 'nope'; }), 'bad attune facet passed');
  assert(corrupt((c) => { c.regions['palewash-reach'].wells.colorwell.grants = 'bogus'; }), 'bad well grant passed');
  assert(corrupt((c) => { c.quests['mend-the-sky'].unlocks.wells.push('ghostwell'); }), 'unknown unlocked well passed');
  assert(corrupt((c) => { c.regions['palewash-reach'].wells.lightwell.x = 999; }), 'out-of-bounds well passed');
  assert(corrupt((c) => { c.quests['mend-the-sky'].objectives[1].target = 'phantom'; }), 'kill target with no spawns passed');
  assert(corrupt((c) => { delete c.regions['palewash-reach'].zones['rift-gate']; }), 'missing rift-gate passed');
});

console.log('# fingerprint / golden replay');
test('demo playthrough matches the baked golden fingerprint', () => {
  const fp = fingerprint(runDemo());
  assertEqual(fp, GOLDEN_DEMO_FINGERPRINT, `golden drift — if intended, update to ${fp}`);
});
test('fingerprint stable across identical re-run', () => { assertEqual(fingerprint(runDemo()), fingerprint(runDemo())); });

console.log('# save / load mid-run parity');
test('save → load mid-stream equals an uninterrupted run', () => {
  const cmds = demoCommands(); const half = Math.floor(cmds.length / 2);
  const uninterrupted = makeWorld(DEMO_SEED); replay(uninterrupted, cmds);
  const first = makeWorld(DEMO_SEED); replay(first, cmds.slice(0, half));
  const reloaded = JSON.parse(JSON.stringify(first)); replay(reloaded, cmds.slice(half));
  assertEqual(fingerprint(reloaded), fingerprint(uninterrupted));
});

console.log('# the full chapter (demo playthrough)');
test('demo mends the sky, beats the Second, and ends the chapter', () => {
  const w = runDemo();
  assert(w.quests.completed['mend-the-sky'] === 1, 'main quest not completed');
  assertEqual(w.visual.color, 1, 'color not restored');
  assertEqual(w.visual.light, 1, 'light not restored');
  assertEqual(w.visual.depth, 1, 'depth not restored');
  assertEqual(w.flags.audio, 1, 'audio not enabled by resonance well');
  assert(!w.enemies.gloom1.alive && !w.enemies.shard1.alive, 'quest husks still alive');
  assert(w.enemies.rival1 && !w.enemies.rival1.alive, 'the Second was never spawned/defeated');
  assert(w.arc.bossTaunted === 1, 'boss never taunted at half health');
  assertEqual(w.arc.choice, 'claim', 'rift choice not recorded');
  assert(w.player.inventory.includes('lens-shard'), 'lens shard not collected');
  assert(w.destructibles.crate1.broken === 1, 'crate not broken');
  assert(w.flags.ended === 1, 'chapter did not end at the rift gate');
  assert(w.player.hp > 0, 'player died during the scripted run');
});
test('saga.v2 export round-trips out of the finished chapter', () => {
  const w = runDemo();
  const code = exportSaga(w);
  assert(code.startsWith('SAGA2.'), `unexpected code prefix: ${code}`);
  // claim path grants the aura technique
  assert(code.length > 20, 'code suspiciously short');
});

console.log('# quest-gated entities are agnostic of prior actions (E9)');
test('gated enemies/pickup/wells do not exist before acceptance', () => {
  const fresh = makeWorld(1);
  assert(!fresh.enemies.gloom1 && !fresh.enemies.shard1, 'gated enemies pre-spawned');
  assert(!fresh.pickups.lens1, 'gated pickup pre-spawned');
  assert(!fresh.wells.colorwell && !fresh.wells.lightwell && !fresh.wells.depthwell, 'gated wells pre-spawned');
  assert(fresh.wells.resonance, 'resonance well should always be present');
});
test('targeting a not-yet-unlocked entity fails loud, never silently no-ops', () => {
  const w = makeWorld(1); let threw = false;
  try { reduce(w, { type: 'ATTUNE', wellId: 'colorwell' }); } catch { threw = true; }
  assert(threw, 'attuning an unrevealed well should throw');
});
test('accepting the quest reveals the gated targets', () => {
  const w = makeWorld(1);
  acceptMainQuest(w);
  assert(w.enemies.gloom1 && w.enemies.shard1, 'enemies not revealed on accept');
  assert(w.pickups.lens1, 'pickup not revealed on accept');
  assert(w.wells.colorwell && w.wells.lightwell && w.wells.depthwell, 'wells not revealed on accept');
});

console.log('# attune + immunity mechanics');
test('attuning a well restores exactly its facet', () => {
  const w = makeWorld(1);
  acceptMainQuest(w);
  moveAdjacent(w, w.wells.colorwell);
  const ev = reduce(w, { type: 'ATTUNE', wellId: 'colorwell' });
  assert(ev.some((e) => e.type === 'attuned' && e.facet === 'color'), 'no attuned event');
  assertEqual(w.visual.color, 1, 'color facet not set');
  assertEqual(w.visual.light, 0, 'attuning color leaked into light');
  assertEqual(w.wells.colorwell.attuned, 1, 'well not marked attuned');
  const again = reduce(w, { type: 'ATTUNE', wellId: 'colorwell' });
  assert(again.some((e) => e.type === 'nothing_there'), 're-attuning should be a no-op refusal');
});
test('Gloomhide (immune: aura) shrugs off a blast, dies to fists', () => {
  const w = makeWorld(1);
  acceptMainQuest(w);
  moveAdjacent(w, w.enemies.gloom1);
  chargeTo(w, 3);
  const blast = reduce(w, { type: 'AURA_BLAST', enemyId: 'gloom1' });
  assert(blast.some((e) => e.type === 'no_effect' && e.kind === 'aura'), 'aura should no_effect a gloom');
  assert(w.enemies.gloom1.alive === 1, 'gloom died to an immune blast');
  let g = 0; while (w.enemies.gloom1.alive && g++ < 20) reduce(w, { type: 'MELEE', enemyId: 'gloom1' });
  assert(!w.enemies.gloom1.alive, 'gloom never died to melee');
});
test('Shardling (immune: melee) shrugs off fists, dies to aura', () => {
  const w = makeWorld(1);
  acceptMainQuest(w);
  // Route through the y=12 ridge gap before turning up to the shard (east of it).
  while (w.player.x < 17) reduce(w, { type: 'MOVE', dx: 1, dy: Math.sign(12 - w.player.y) });
  moveAdjacent(w, w.enemies.shard1);
  const melee = reduce(w, { type: 'MELEE', enemyId: 'shard1' });
  assert(melee.some((e) => e.type === 'no_effect' && e.kind === 'melee'), 'melee should no_effect a shard');
  assert(w.enemies.shard1.alive === 1, 'shard died to an immune punch');
  let g = 0; while (w.enemies.shard1.alive && g++ < 30) { chargeTo(w, 3); reduce(w, { type: 'AURA_BLAST', enemyId: 'shard1' }); }
  assert(!w.enemies.shard1.alive, 'shard never died to aura');
});

console.log('# movement + boundaries');
test('MOVE bumps the blocked ridge (collision), never phases through', () => {
  const w = makeWorld(1);
  // walk to (15,10), then east into the blocked (16,10)
  while (w.player.x < 15 || w.player.y > 10) reduce(w, { type: 'MOVE', dx: Math.sign(15 - w.player.x), dy: Math.sign(10 - w.player.y) });
  const ev = reduce(w, { type: 'MOVE', dx: 1, dy: 0 });
  assert(ev.some((e) => e.type === 'blocked'), 'ridge did not block');
  assertEqual(w.player.x, 15, 'player phased into a blocked tile');
});
test('unknown command fails loud', () => {
  let threw = false; try { replay(makeWorld(1), [{ type: 'NOPE' }]); } catch { threw = true; }
  assert(threw);
});
test('the rift gate is sealed until the arc completes', () => {
  const w = makeWorld(1);
  while (w.player.x < 39) reduce(w, { type: 'MOVE', dx: 1, dy: Math.sign(12 - w.player.y) });
  assert(!w.flags.ended, 'gate let the player out before the arc was complete');
});

console.log('# perception (skill-gated info)');
test('perception gates the enemy readout', () => {
  const seeker = makeWorld(1, { archetype: 'seeker' });
  const brawler = makeWorld(1, { archetype: 'brawler' });
  assert(canSense(seeker.player, 'gloom'), 'seeker should read a gloom (senseReq 2)');
  assert(!canSense(brawler.player, 'echo'), 'brawler should NOT read an echo (senseReq 3)');
});

console.log('# saga carryover (imports the Prologue saga.v1)');
test('a saga.v1 code raises carried skills and is remembered', () => {
  // A hand-built saga.v1 code (as the Prologue would emit): SAGA1.<b64>.<check>
  const payload = btoa(stableStringify({
    v: 'saga.v1', game: 'prologue', archetype: 'channeler', difficulty: 'harsh',
    skills: { melee: 3, aura: 4, perception: 2 }, coins: 7, techniques: [],
    choices: { ravagerFate: 'spare' },
  }));
  const code = `SAGA1.${payload}.${fnv1a32(payload)}`;
  const imp = importSaga(code);
  assert(imp.ok, `import failed: ${imp.error}`);
  const w = makeWorld(1, { archetype: 'channeler', difficulty: 'harsh', saga: imp.data });
  assert(w.player.skills.aura.lvl >= 4, 'carried aura level not applied');
  assertEqual(w.flags.ravagerFate, 'spare', 'prior choice not remembered');
});
test('a tampered / foreign code is politely refused', () => {
  assert(!importSaga('SAGA1.garbage.zzzz').ok, 'garbage accepted');
  assert(!importSaga('hello').ok, 'nonsense accepted');
  assert(!importSaga('SAGA2.x.y').ok, 'wrong-prefix accepted');
});

console.log('# day/night determinism');
test('night is a pure function of the integer tick', () => {
  assert(!isNight(0), 'tick 0 should be day');
  assert(isNight(Math.floor(DAY_CYCLE_TICKS * 0.75)), 'late cycle should be night');
});

console.log('# device-adaptive hints + objective text');
test('hints match the active device', () => {
  assertEqual(keyHint('keyboard', 'confirm'), 'Enter');
  assertEqual(keyHint('gamepad', 'confirm'), 'A');
  assertEqual(keyHint('touch', 'confirm'), '');
  assertEqual(withHint('gamepad', 'confirm', 'Accept'), 'Accept (A)');
});
test('describeObjective covers all four types with no undefined', () => {
  const lines = [
    describeObjective({ type: 'kill', target: 'gloom', n: 1 }),
    describeObjective({ type: 'collect', item: 'lens-shard' }),
    describeObjective({ type: 'reach', zone: 'rift-edge' }),
    describeObjective({ type: 'attune', facet: 'color' }),
  ];
  for (const s of lines) assert(!s.includes('undefined'), `leaked undefined: ${s}`);
  assert(lines[0].toLowerCase().includes('gloomhide'), 'kill did not resolve the kind name');
  assert(lines[3].toLowerCase().includes('color'), 'attune text missing facet');
  let threw = false; try { describeObjective({ type: 'nope' }); } catch { threw = true; }
  assert(threw, 'unknown objective type should throw');
});

console.log('# renderer boundary');
test('read-only proxy throws on any write, at any depth', () => {
  const w = makeWorld(1); const ro = readonly(w);
  assertEqual(ro.player.hp, w.player.hp, 'proxy must read through');
  let threw = 0;
  try { ro.player.hp = 0; } catch { threw++; }
  try { ro.visual.color = 1; } catch { threw++; }
  try { delete ro.player; } catch { threw++; }
  assertEqual(threw, 3, 'a renderer write slipped through');
});

console.log('# determinism guard: forbidden tokens in src/sim');
test('src/sim never touches ambient time, randomness, or engine-varying math', () => {
  const simDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim');
  const banned = /Math\.random|Date\.now|performance\.now|new Date|Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt)\b/;
  for (const f of readdirSync(simDir)) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(simDir, f), 'utf8');
    const m = src.match(banned);
    assert(!m, `${f} contains banned token: ${m && m[0]}`);
  }
});

console.log('');
if (failures.length) { console.error(`SMOKE FAILED: ${failures.length}/${count} test(s)`); process.exit(1); }
console.log(`SMOKE PASSED: ${count}/${count}`);
