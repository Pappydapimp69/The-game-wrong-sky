// makeWorld is the ONLY constructor of authoritative state. New Game, tests,
// and save-schema defaults all go through here.
//
// The world is BUILT FROM CONTENT (src/sim/content.js) — definitions are
// copied into state at construction so a running save never shifts under a
// content edit. Authoritative fields are integers only.

import { makeRng } from './rng.js';
import { CONTENT } from './content.js';

export const WORLD_VERSION = 'wrongsky2';

export function makeWorld(seed, options = {}) {
  if (!Number.isInteger(seed)) throw new Error('makeWorld: seed must be an integer');
  const archId = options.archetype || CONTENT.defaultArchetype;
  const arch = CONTENT.archetypes[archId];
  if (!arch) throw new Error(`makeWorld: unknown archetype ${archId}`);
  const difficulty = options.difficulty || 'gentle';
  if (!['gentle', 'harsh'].includes(difficulty)) throw new Error(`makeWorld: bad difficulty ${difficulty}`);

  const regionDef = CONTENT.regions[CONTENT.startRegion];

  const carrySkills = (options.saga && options.saga.skills) || {};
  const skills = {};
  for (const s of ['melee', 'aura', 'perception']) {
    const base = arch.skills[s] || 1;
    const carried = Number.isInteger(carrySkills[s]) ? carrySkills[s] : 0;
    skills[s] = { lvl: Math.max(base, carried), xp: 0 };
  }

  // Quest-gated ENEMIES/PICKUPS don't exist until their quest is accepted
  // (E9) — objectives stay agnostic of prior actions. WELLS are different:
  // they are always present (see reduce.js ATTUNE) — only their EFFECT is
  // gated on the active quest, so a player can wander to any well early and
  // get a vague hint instead of a hard "doesn't exist" wall.
  const gatedEnemyIds = new Set(Object.values(CONTENT.quests).flatMap((q) => q.unlocks?.enemies || []));
  const gatedPickupIds = new Set(Object.values(CONTENT.quests).flatMap((q) => q.unlocks?.pickups || []));

  const enemies = {};
  for (const [id, e] of Object.entries(regionDef.enemies)) {
    if (gatedEnemyIds.has(id)) continue;
    const kind = CONTENT.enemyKinds[e.kind];
    enemies[id] = {
      x: e.x, y: e.y, kind: e.kind, hp: kind.hp, maxHp: kind.hp, power: kind.power, alive: 1,
      immune: kind.immune || '',
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
    wells[id] = { x: wl.x, y: wl.y, grants: wl.grants, attuned: 0 };
  }
  // Opacity per blocked tile (0-100): how strongly it occludes light/sight.
  // Collision is a separate concern (any entry blocks MOVE regardless of
  // magnitude) — this is the visibility system's input (src/sim/visibility.js).
  const blocked = { ...regionDef.blocked };

  const questDefs = {};
  for (const [qid, q] of Object.entries(CONTENT.quests)) {
    const def = JSON.parse(JSON.stringify(q));
    if (q.unlocks) {
      def.unlocks = { enemies: {}, pickups: {} };
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
      chargeHold: 0,
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
    // The signature progression: which rendering LAYERS have been restored.
    // Authoritative integers (0/1), saved and fingerprinted. HOW a restored
    // layer looks (sprites, shadows, hue-cycle reveal) is presentation — the
    // renderer reads these and never writes them.
    visual: { player: 0, world: 0, enemies: 0, light: 0 },
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
    flags: {
      audio: 0,
      ended: 0,
      ravagerFate: (options.saga && options.saga.choices && options.saga.choices.ravagerFate) || '',
      // Ordered list of {player,world,enemies} facets as their reveal quests
      // complete — drives the branching narrative (order-sensitive, not just
      // which were picked). Never mutated except by appending.
      revealOrder: [],
    },
  };
}
