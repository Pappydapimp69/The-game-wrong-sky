// makeWorld is the ONLY constructor of authoritative state. New Game, tests,
// and save-schema defaults all go through here.
//
// The world is BUILT FROM CONTENT (src/sim/content.js) — definitions are
// copied into state at construction so a running save never shifts under a
// content edit. Authoritative fields are integers only.
//
// WRONG SKY additions over the Prologue engine:
//   - `visual` facets (color/light/depth) — authoritative progression the
//     renderer reads to decide how much of the world to draw; restored by
//     attuning wells.
//   - `wells` — the signature interactable; quest-gated ones follow the same
//     "don't exist until accepted" rule as gated enemies/pickups (E9).
//   - `options.saga` — an imported saga.v1 carryover (archetype/skills/choice)
//     applied on a fresh start, so a Prologue run continues here.

import { makeRng } from './rng.js';
import { CONTENT } from './content.js';

export const WORLD_VERSION = 'wrongsky1';

export function makeWorld(seed, options = {}) {
  if (!Number.isInteger(seed)) throw new Error('makeWorld: seed must be an integer');
  const archId = options.archetype || CONTENT.defaultArchetype;
  const arch = CONTENT.archetypes[archId];
  if (!arch) throw new Error(`makeWorld: unknown archetype ${archId}`);
  const difficulty = options.difficulty || 'gentle';
  if (!['gentle', 'harsh'].includes(difficulty)) throw new Error(`makeWorld: bad difficulty ${difficulty}`);

  const regionDef = CONTENT.regions[CONTENT.startRegion];

  // Skills start from the archetype template. A saga carryover raises any skill
  // to at least the level it reached in the Prologue (never lowers it) — growth
  // survives between games.
  const carrySkills = (options.saga && options.saga.skills) || {};
  const skills = {};
  for (const s of ['melee', 'aura', 'perception']) {
    const base = arch.skills[s] || 1;
    const carried = Number.isInteger(carrySkills[s]) ? carrySkills[s] : 0;
    skills[s] = { lvl: Math.max(base, carried), xp: 0 };
  }

  // Quest-gated entities/wells don't exist in the world until their quest is
  // accepted (ACCEPT_QUEST spawns them — see reduce.js), so objectives stay
  // agnostic of whatever the player did before accepting (Prologue lesson E9).
  const gatedEnemyIds = new Set(Object.values(CONTENT.quests).flatMap((q) => q.unlocks?.enemies || []));
  const gatedPickupIds = new Set(Object.values(CONTENT.quests).flatMap((q) => q.unlocks?.pickups || []));
  const gatedWellIds = new Set(Object.values(CONTENT.quests).flatMap((q) => q.unlocks?.wells || []));

  const enemies = {};
  for (const [id, e] of Object.entries(regionDef.enemies)) {
    if (gatedEnemyIds.has(id)) continue;
    const kind = CONTENT.enemyKinds[e.kind];
    enemies[id] = {
      x: e.x, y: e.y, kind: e.kind, hp: kind.hp, maxHp: kind.hp, power: kind.power, alive: 1,
      immune: kind.immune || '', // '' = no immunity, same "no value" convention as arc.choice
    };
  }
  const npcs = {};
  for (const [id, n] of Object.entries(regionDef.npcs)) {
    npcs[id] = { x: n.x, y: n.y, name: n.name };
    if (n.offers) npcs[id].offers = n.offers;
    if (n.shop) npcs[id].shop = [...n.shop];
  }
  const destructibles = {};
  for (const [id, d] of Object.entries(regionDef.destructibles)) {
    destructibles[id] = { x: d.x, y: d.y, broken: 0, coins: d.coins || 0 };
  }
  const pickups = {};
  for (const [id, p] of Object.entries(regionDef.pickups)) {
    if (gatedPickupIds.has(id)) continue;
    pickups[id] = { x: p.x, y: p.y, item: p.item, taken: 0 };
  }
  const wells = {};
  for (const [id, wl] of Object.entries(regionDef.wells || {})) {
    if (gatedWellIds.has(id)) continue;
    wells[id] = { x: wl.x, y: wl.y, grants: wl.grants, attuned: 0 };
  }
  const blocked = {};
  for (const b of regionDef.blocked) blocked[b] = 1;

  // Quest defs carry their own unlock TEMPLATES (copied from content at
  // construction, like everything else) so reduce.js can spawn them on accept
  // without importing CONTENT — state stays a self-contained copy.
  const questDefs = {};
  for (const [qid, q] of Object.entries(CONTENT.quests)) {
    const def = JSON.parse(JSON.stringify(q));
    if (q.unlocks) {
      def.unlocks = { enemies: {}, pickups: {}, wells: {} };
      for (const id of q.unlocks.enemies || []) {
        const e = regionDef.enemies[id];
        const kind = CONTENT.enemyKinds[e.kind];
        def.unlocks.enemies[id] = {
          x: e.x, y: e.y, kind: e.kind, hp: kind.hp, maxHp: kind.hp, power: kind.power, alive: 1,
          immune: kind.immune || '',
        };
      }
      for (const id of q.unlocks.pickups || []) {
        const p = regionDef.pickups[id];
        def.unlocks.pickups[id] = { x: p.x, y: p.y, item: p.item, taken: 0 };
      }
      for (const id of q.unlocks.wells || []) {
        const wl = regionDef.wells[id];
        def.unlocks.wells[id] = { x: wl.x, y: wl.y, grants: wl.grants, attuned: 0 };
      }
    }
    questDefs[qid] = def;
  }
  const items = JSON.parse(JSON.stringify(CONTENT.items));

  return {
    version: WORLD_VERSION,
    seed: seed >>> 0,
    tick: 0,
    rng: makeRng(seed >>> 0),
    settings: { difficulty, archetype: archId },
    player: {
      x: regionDef.spawn.x, y: regionDef.spawn.y,
      hp: arch.hp, maxHp: arch.hp,
      aura: 0, maxAura: arch.aura,
      chargeHold: 0, // consecutive CHARGE ticks in the current hold — see reduce.js
      coins: 0,
      skills,
      inventory: [],
    },
    region: {
      id: CONTENT.startRegion,
      w: regionDef.w, h: regionDef.h,
      blocked,
      zones: JSON.parse(JSON.stringify(regionDef.zones || {})),
    },
    npcs,
    enemies,
    destructibles,
    pickups,
    wells,
    items,
    quests: { defs: questDefs, offered: {}, active: {}, completed: {} },
    // The signature progression: three visual facets the world has lost and the
    // player restores by attuning wells. Authoritative integers (0/1), saved
    // and fingerprinted. HOW a restored facet looks is presentation — the
    // renderer reads these and never writes them.
    visual: { color: 0, light: 0, depth: 0 },
    // The finale arc: the rival ("the Second") crests the rift once the sky is
    // mended and the player reaches its edge. A state overlay that OBSERVES
    // gameplay events; the boss definition is copied in so the sim stays
    // self-contained. No teaching steps here — game 2 assumes the verbs.
    arc: {
      bossDef: {
        ...regionDef.boss,
        hp: CONTENT.enemyKinds[regionDef.boss.kind].hp,
        power: CONTENT.enemyKinds[regionDef.boss.kind].power,
        immune: CONTENT.enemyKinds[regionDef.boss.kind].immune || '',
      },
      bossSpawned: 0, bossTaunted: 0, bossDefeated: 0,
      choice: '', // '', 'spare', 'claim'
      complete: 0,
    },
    // flags: audio (resonance well attuned), ended (chapter over), and the
    // remembered Prologue choice (a dialog beat, and it re-exports in saga.v2).
    flags: {
      audio: 0,
      ended: 0,
      ravagerFate: (options.saga && options.saga.choices && options.saga.choices.ravagerFate) || '',
    },
  };
}
