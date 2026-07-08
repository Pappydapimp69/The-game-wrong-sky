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
import { computeVisibility } from '../src/sim/visibility.js';

const GOLDEN_DEMO_FINGERPRINT = 'cb9ff10d';

const failures = [];
let count = 0;
function test(name, fn) {
  count++;
  try { fn(); console.log(`  ok ${count} - ${name}`); }
  catch (err) { failures.push({ name, err }); console.error(`  FAIL ${count} - ${name}\n      ${err.stack || err.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: ${a} !== ${b}`); }

const runDemo = () => { const w = makeWorld(DEMO_SEED); replay(w, demoCommands()); return w; };
// Walks toward `e` until Chebyshev-adjacent. Tries the direct diagonal step
// first; if that's blocked (e.g. a wall corner), slides along one axis at a
// time instead of getting stuck retrying the same blocked diagonal forever.
function moveAdjacent(w, e) {
  let guard = 0;
  while (Math.max(Math.abs(w.player.x - e.x), Math.abs(w.player.y - e.y)) > 1 && guard++ < 400) {
    const dx = Math.sign(e.x - w.player.x), dy = Math.sign(e.y - w.player.y);
    const tries = dx && dy ? [[dx, dy], [dx, 0], [0, dy]] : [[dx, dy]];
    let moved = false;
    for (const [tdx, tdy] of tries) {
      if (!tdx && !tdy) continue;
      const before = `${w.player.x},${w.player.y}`;
      reduce(w, { type: 'MOVE', dx: tdx, dy: tdy });
      if (`${w.player.x},${w.player.y}` !== before) { moved = true; break; }
    }
    if (!moved) throw new Error(`moveAdjacent: stuck at ${w.player.x},${w.player.y} heading toward ${e.x},${e.y}`);
  }
}
const chargeTo = (w, aura) => { let g = 0; while (w.player.aura < aura && g++ < 60) reduce(w, { type: 'CHARGE', start: g === 1 }); };
function talkAndAccept(w, questId) {
  moveAdjacent(w, w.npcs.sable);
  reduce(w, { type: 'TALK', npcId: 'sable' });
  reduce(w, { type: 'ACCEPT_QUEST', questId });
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
  assert(corrupt((c) => { c.quests['mend-the-sky-finale'].objectives[3].facet = 'nope'; }), 'bad attune facet passed');
  assert(corrupt((c) => { c.regions['palewash-reach'].wells.playerwell.grants = 'bogus'; }), 'bad well grant passed');
  assert(corrupt((c) => { delete c.regions['palewash-reach'].wells.playerwell.hint; }), 'well with no hint passed');
  assert(corrupt((c) => { c.regions['palewash-reach'].wells.worldwell.x = 999; }), 'out-of-bounds well passed');
  assert(corrupt((c) => { c.quests['reveal-player'].requires = ['nonexistent']; }), 'unknown quest prereq passed');
  assert(corrupt((c) => { delete c.branch.finale['player,world,enemies']; }), 'missing branch finale text passed');
  assert(corrupt((c) => { c.regions['palewash-reach'].blocked['16,9'] = 200; }), 'out-of-range opacity passed');
  assert(corrupt((c) => { delete c.regions['palewash-reach'].zones['rift-gate']; }), 'missing rift-gate passed');
  // A cycle reachable only through a quest's SECOND (or later) requires entry
  // — the cycle detector must walk every prereq edge, not just requires[0].
  assert(corrupt((c) => {
    c.quests['reveal-world'].requires = ['hear-the-world', 'mend-the-sky-finale'];
  }), 'a requires-chain cycle through a non-first prereq entry passed');
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
test('demo completes hear-the-world, all 3 reveals, and the finale', () => {
  const w = runDemo();
  assert(w.quests.completed['hear-the-world'] === 1, 'hear-the-world not completed');
  assert(w.quests.completed['reveal-player'] === 1, 'reveal-player not completed');
  assert(w.quests.completed['reveal-world'] === 1, 'reveal-world not completed');
  assert(w.quests.completed['reveal-enemies'] === 1, 'reveal-enemies not completed');
  assert(w.quests.completed['mend-the-sky-finale'] === 1, 'finale not completed');
  assertEqual(w.flags.audio, 1, 'audio not enabled');
  assertEqual(w.visual.player, 1, 'player sprite facet not restored');
  assertEqual(w.visual.world, 1, 'world sprite facet not restored');
  assertEqual(w.visual.enemies, 1, 'enemy sprite facet not restored');
  assertEqual(w.visual.light, 1, 'light facet not restored');
  assert(!w.enemies.gloom1.alive && !w.enemies.shard1.alive, 'quest enemies still alive');
  assert(w.enemies.rival1 && !w.enemies.rival1.alive, 'the Second was never spawned/defeated');
  assert(w.arc.bossTaunted === 1, 'boss never taunted at half health');
  assertEqual(w.arc.choice, 'claim', 'rift choice not recorded');
  assert(w.player.inventory.includes('lens-shard'), 'lens shard not collected');
  assert(w.destructibles.crate1.broken === 1, 'crate not broken');
  assert(w.flags.ended === 1, 'chapter did not end at the rift gate');
  assert(w.player.hp > 0, 'player died during the scripted run');
});
test('demo records the reveal order exactly as picked (player, world, enemies)', () => {
  const w = runDemo();
  assertEqual(w.flags.revealOrder.join(','), 'player,world,enemies', 'reveal order not recorded in pick order');
});
test('saga.v2 export round-trips out of the finished chapter', () => {
  const w = runDemo();
  const code = exportSaga(w);
  assert(code.startsWith('SAGA2.'), `unexpected code prefix: ${code}`);
  assert(code.length > 20, 'code suspiciously short');
});

console.log('# wells: always present, effect-gated not existence-gated (E9 successor)');
test('all 5 wells exist from world start, none quest-gated', () => {
  const fresh = makeWorld(1);
  for (const id of ['resonance', 'playerwell', 'worldwell', 'enemywell', 'lightwell']) {
    assert(fresh.wells[id], `well ${id} missing at world start`);
  }
});
test('attuning a well with no matching active quest gives a hint, never an effect or a throw', () => {
  const w = makeWorld(1);
  moveAdjacent(w, w.wells.playerwell);
  const ev = reduce(w, { type: 'ATTUNE', wellId: 'playerwell' });
  assert(ev.some((e) => e.type === 'well_hint' && e.facet === 'player'), 'expected a well_hint event');
  assertEqual(w.visual.player, 0, 'attuning with no active quest set the facet anyway');
  assertEqual(w.wells.playerwell.attuned, 0, 'well marked attuned despite no effect');
});
test('the matching well takes effect only while its quest is active', () => {
  const w = makeWorld(1);
  talkAndAccept(w, 'hear-the-world');
  moveAdjacent(w, w.wells.resonance);
  const ev = reduce(w, { type: 'ATTUNE', wellId: 'resonance' });
  assert(ev.some((e) => e.type === 'attuned' && e.facet === 'audio'), 'expected a real attuned event');
  assertEqual(w.flags.audio, 1, 'audio facet not set');
  assertEqual(w.wells.resonance.attuned, 1, 'well not marked attuned');
  const again = reduce(w, { type: 'ATTUNE', wellId: 'resonance' });
  assert(again.some((e) => e.type === 'nothing_there'), 're-attuning an already-attuned well should be a no-op');
});

console.log('# quest chain: prereqs + multi-offer choice');
test('reveal-* quests are not offered until hear-the-world completes', () => {
  const w = makeWorld(1);
  moveAdjacent(w, w.npcs.sable);
  const ev = reduce(w, { type: 'TALK', npcId: 'sable' });
  const offered = ev.find((e) => e.type === 'quests_offered');
  assertEqual(offered.quests.join(','), 'hear-the-world', 'reveal-* quests offered before their prereq completed');
});
test('completing hear-the-world offers all 3 reveal quests at once', () => {
  const w = makeWorld(1);
  talkAndAccept(w, 'hear-the-world');
  moveAdjacent(w, w.wells.resonance);
  reduce(w, { type: 'ATTUNE', wellId: 'resonance' });
  moveAdjacent(w, w.npcs.sable);
  const ev = reduce(w, { type: 'TALK', npcId: 'sable' });
  const offered = ev.find((e) => e.type === 'quests_offered');
  assertEqual(offered.quests.join(','), 'reveal-enemies,reveal-player,reveal-world', 'not all 3 reveal quests offered together');
});
test('accepting one reveal quest narrows the next offer to the 2 remaining', () => {
  const w = makeWorld(1);
  talkAndAccept(w, 'hear-the-world');
  moveAdjacent(w, w.wells.resonance);
  reduce(w, { type: 'ATTUNE', wellId: 'resonance' });
  talkAndAccept(w, 'reveal-world');
  moveAdjacent(w, w.wells.worldwell);
  reduce(w, { type: 'ATTUNE', wellId: 'worldwell' });
  moveAdjacent(w, w.npcs.sable);
  const ev = reduce(w, { type: 'TALK', npcId: 'sable' });
  const offered = ev.find((e) => e.type === 'quests_offered');
  assertEqual(offered.quests.join(','), 'reveal-enemies,reveal-player', 'offer did not narrow to the 2 remaining');
});
test('accepting one reveal quest withdraws the sibling offers (the pick is exclusive)', () => {
  const w = makeWorld(1);
  talkAndAccept(w, 'hear-the-world');
  moveAdjacent(w, w.wells.resonance);
  reduce(w, { type: 'ATTUNE', wellId: 'resonance' });
  moveAdjacent(w, w.npcs.sable);
  reduce(w, { type: 'TALK', npcId: 'sable' }); // offers all 3
  reduce(w, { type: 'ACCEPT_QUEST', questId: 'reveal-player' });
  // Without a fresh TALK, the other two must no longer be acceptable — a
  // stale `offered` flag from the same batch must not let the player accept
  // more than one of the exclusive 3-way pick.
  let threw = false;
  try { reduce(w, { type: 'ACCEPT_QUEST', questId: 'reveal-world' }); } catch { threw = true; }
  assert(threw, 'sibling offer (reveal-world) was still acceptable after picking reveal-player');
  assert(!w.quests.active['reveal-world'], 'reveal-world became active despite the exclusive pick');
});
test('a different pick order records a different reveal order (order-sensitive, not just set-sensitive)', () => {
  const w = makeWorld(1);
  talkAndAccept(w, 'hear-the-world');
  moveAdjacent(w, w.wells.resonance);
  reduce(w, { type: 'ATTUNE', wellId: 'resonance' });
  talkAndAccept(w, 'reveal-enemies');
  moveAdjacent(w, w.wells.enemywell);
  reduce(w, { type: 'ATTUNE', wellId: 'enemywell' });
  talkAndAccept(w, 'reveal-player');
  moveAdjacent(w, w.wells.playerwell);
  reduce(w, { type: 'ATTUNE', wellId: 'playerwell' });
  assertEqual(w.flags.revealOrder.join(','), 'enemies,player', 'reveal order did not match the actual pick order');
});
test('mend-the-sky-finale is not offered until all 3 reveal quests are done', () => {
  const w = makeWorld(1);
  talkAndAccept(w, 'hear-the-world');
  moveAdjacent(w, w.wells.resonance);
  reduce(w, { type: 'ATTUNE', wellId: 'resonance' });
  moveAdjacent(w, w.npcs.sable);
  const ev = reduce(w, { type: 'TALK', npcId: 'sable' });
  const offered = ev.find((e) => e.type === 'quests_offered');
  assert(!offered.quests.includes('mend-the-sky-finale'), 'finale offered before its prereqs were met');
});

console.log('# gated enemies/pickup still agnostic of prior actions (E9)');
test('gloom1/shard1/lens1 do not exist before the finale quest is accepted', () => {
  const fresh = makeWorld(1);
  assert(!fresh.enemies.gloom1 && !fresh.enemies.shard1, 'gated enemies pre-spawned');
  assert(!fresh.pickups.lens1, 'gated pickup pre-spawned');
});

console.log('# attune + immunity mechanics');
test('Gloomhide (immune: aura) shrugs off a blast, dies to fists', () => {
  const w = runToFinaleAccepted();
  moveAdjacent(w, w.enemies.gloom1);
  chargeTo(w, 3);
  const blast = reduce(w, { type: 'AURA_BLAST', enemyId: 'gloom1' });
  assert(blast.some((e) => e.type === 'no_effect' && e.kind === 'aura'), 'aura should no_effect a gloom');
  assert(w.enemies.gloom1.alive === 1, 'gloom died to an immune blast');
  let g = 0; while (w.enemies.gloom1.alive && g++ < 20) reduce(w, { type: 'MELEE', enemyId: 'gloom1' });
  assert(!w.enemies.gloom1.alive, 'gloom never died to melee');
});
test('Shardling (immune: melee) shrugs off fists, dies to aura', () => {
  const w = runToFinaleAccepted();
  // route around the ridge (shard1 is east of it)
  while (w.player.x < 17) reduce(w, { type: 'MOVE', dx: 1, dy: Math.sign(12 - w.player.y) });
  moveAdjacent(w, w.enemies.shard1);
  const melee = reduce(w, { type: 'MELEE', enemyId: 'shard1' });
  assert(melee.some((e) => e.type === 'no_effect' && e.kind === 'melee'), 'melee should no_effect a shard');
  assert(w.enemies.shard1.alive === 1, 'shard died to an immune punch');
  let g = 0; while (w.enemies.shard1.alive && g++ < 30) { chargeTo(w, 3); reduce(w, { type: 'AURA_BLAST', enemyId: 'shard1' }); }
  assert(!w.enemies.shard1.alive, 'shard never died to aura');
});
function runToFinaleAccepted() {
  const w = makeWorld(1);
  talkAndAccept(w, 'hear-the-world');
  moveAdjacent(w, w.wells.resonance);
  reduce(w, { type: 'ATTUNE', wellId: 'resonance' });
  for (const [qid, wellId] of [['reveal-player', 'playerwell'], ['reveal-world', 'worldwell'], ['reveal-enemies', 'enemywell']]) {
    talkAndAccept(w, qid);
    moveAdjacent(w, w.wells[wellId]);
    reduce(w, { type: 'ATTUNE', wellId });
  }
  talkAndAccept(w, 'mend-the-sky-finale');
  return w;
}

console.log('# visibility (integer-only, sim-authoritative opacity)');
test('a 100-opacity wall fully occludes a tile directly behind it from the player', () => {
  const w = makeWorld(1);
  // The ridge sits at x=16; stand just west of a blocked cell and look east through it.
  w.player.x = 15; w.player.y = 10;
  const vis = computeVisibility(w, w.player.x, w.player.y, 6);
  assertEqual(vis.get('17,10'), 0, 'tile directly behind a 100-opacity wall should be fully dark');
  assertEqual(vis.get('16,10'), 100, 'the wall tile itself is not self-occluded');
});
test('an unobstructed line of sight stays fully clear', () => {
  const w = makeWorld(1);
  w.player.x = 2; w.player.y = 2;
  const vis = computeVisibility(w, w.player.x, w.player.y, 5);
  assertEqual(vis.get('2,2'), 100, 'origin tile should be fully clear');
  assertEqual(vis.get('5,2'), 100, 'open line of sight should stay fully clear');
});
test('visibility never touches state (pure read, no mutation)', () => {
  const w = makeWorld(1);
  const before = stableStringify(w);
  computeVisibility(w, w.player.x, w.player.y, 8);
  assertEqual(stableStringify(w), before, 'computeVisibility mutated state');
});

console.log('# movement + boundaries');
test('MOVE bumps the blocked ridge (collision), never phases through', () => {
  const w = makeWorld(1);
  while (w.player.x < 15 || w.player.y > 10) reduce(w, { type: 'MOVE', dx: Math.sign(15 - w.player.x), dy: Math.sign(10 - w.player.y) });
  const ev = reduce(w, { type: 'MOVE', dx: 1, dy: 0 });
  assert(ev.some((e) => e.type === 'blocked'), 'ridge did not block');
  assertEqual(w.player.x, 15, 'player phased into a blocked tile');
});
test('a 0-opacity blocked tile still blocks (collision is existence-based, not magnitude-based)', () => {
  const w = makeWorld(1);
  w.player.x = 1; w.player.y = 1;
  w.region.blocked['2,1'] = 0; // a fully-transparent-but-solid tile
  const ev = reduce(w, { type: 'MOVE', dx: 1, dy: 0 });
  assert(ev.some((e) => e.type === 'blocked'), '0-opacity blocked tile did not block movement');
  assertEqual(w.player.x, 1, 'player phased through a 0-opacity blocked tile');
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
    describeObjective({ type: 'attune', facet: 'player' }),
  ];
  for (const s of lines) assert(!s.includes('undefined'), `leaked undefined: ${s}`);
  assert(lines[0].toLowerCase().includes('gloomhide'), 'kill did not resolve the kind name');
  assert(lines[3].toLowerCase().includes('player'), 'attune text missing facet');
  let threw = false; try { describeObjective({ type: 'nope' }); } catch { threw = true; }
  assert(threw, 'unknown objective type should throw');
});

console.log('# renderer boundary');
test('read-only proxy throws on any write, at any depth', () => {
  const w = makeWorld(1); const ro = readonly(w);
  assertEqual(ro.player.hp, w.player.hp, 'proxy must read through');
  let threw = 0;
  try { ro.player.hp = 0; } catch { threw++; }
  try { ro.visual.player = 1; } catch { threw++; }
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
