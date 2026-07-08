// The validation ladder for CONTENT. Data-driven content opts out of
// compile-time safety — a typo'd id ships an uncompletable quest with no
// error — so validation must fail the BUILD, not the player.
//
// Rungs (JSON-Schema-style shape checks alone can't see across collections,
// which is exactly where content bugs live):
//   1. schema        — required fields, types, value ranges
//   2. references    — every id points at something that exists
//   3. completability — every quest objective is achievable in its world
// Rung 4 is the headless demo playthrough in the smoke suite.

const FACETS = ['player', 'world', 'enemies', 'light', 'audio'];

export function validateContent(c) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  // --- rung 1: schema -------------------------------------------------------
  const isInt = Number.isInteger;
  if (!isInt(c.version)) err('content.version must be an integer');
  if (!c.archetypes || !Object.keys(c.archetypes).length) err('no archetypes');
  for (const [id, a] of Object.entries(c.archetypes || {})) {
    if (!a.name) err(`archetype ${id}: missing name`);
    if (!isInt(a.hp) || a.hp <= 0) err(`archetype ${id}: bad hp`);
    if (!isInt(a.aura) || a.aura <= 0) err(`archetype ${id}: bad aura`);
    for (const [s, lvl] of Object.entries(a.skills || {})) {
      if (!['melee', 'aura', 'perception'].includes(s)) err(`archetype ${id}: unknown skill ${s}`);
      if (!isInt(lvl) || lvl < 1) err(`archetype ${id}: bad ${s} level`);
    }
  }
  for (const [id, k] of Object.entries(c.enemyKinds || {})) {
    if (!isInt(k.hp) || k.hp <= 0) err(`enemyKind ${id}: bad hp`);
    if (!isInt(k.power) || k.power < 1) err(`enemyKind ${id}: bad power`);
    if (!isInt(k.senseReq) || k.senseReq < 1) err(`enemyKind ${id}: bad senseReq`);
    if (k.immune !== undefined && k.immune !== 'melee' && k.immune !== 'aura') {
      err(`enemyKind ${id}: bad immune ${k.immune} (must be 'melee' or 'aura' if present)`);
    }
  }
  for (const [id, it] of Object.entries(c.items || {})) {
    if (it.price !== undefined && (!isInt(it.price) || it.price < 0)) err(`item ${id}: bad price`);
    if (it.heal !== undefined && (!isInt(it.heal) || it.heal <= 0)) err(`item ${id}: bad heal`);
  }
  for (const [rid, r] of Object.entries(c.regions || {})) {
    if (!isInt(r.w) || !isInt(r.h) || r.w < 4 || r.h < 4) err(`region ${rid}: bad size`);
    const inBounds = (x, y) => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < r.w && y < r.h;
    if (!r.spawn || !inBounds(r.spawn.x, r.spawn.y)) err(`region ${rid}: spawn out of bounds`);
    for (const [b, op] of Object.entries(r.blocked || {})) {
      const [x, y] = String(b).split(',').map(Number);
      if (!inBounds(x, y)) err(`region ${rid}: blocked tile ${b} out of bounds`);
      if (!isInt(op) || op < 0 || op > 100) err(`region ${rid}: blocked tile ${b} bad opacity ${op} (must be 0-100)`);
    }
    const blockedSet = new Set(Object.keys(r.blocked || {}));
    const placed = (kind, id, e) => {
      if (!inBounds(e.x, e.y)) err(`region ${rid}: ${kind} ${id} out of bounds`);
      else if (blockedSet.has(`${e.x},${e.y}`)) err(`region ${rid}: ${kind} ${id} on a blocked tile`);
    };
    for (const [id, e] of Object.entries(r.npcs || {})) placed('npc', id, e);
    for (const [id, e] of Object.entries(r.enemies || {})) placed('enemy', id, e);
    for (const [id, e] of Object.entries(r.destructibles || {})) placed('destructible', id, e);
    for (const [id, e] of Object.entries(r.pickups || {})) placed('pickup', id, e);
    for (const [id, wl] of Object.entries(r.wells || {})) {
      placed('well', id, wl);
      if (!FACETS.includes(wl.grants)) err(`region ${rid}: well ${id} grants unknown facet ${wl.grants}`);
      if (!wl.hint || typeof wl.hint !== 'string') err(`region ${rid}: well ${id} missing a hint string`);
    }
    for (const [id, z] of Object.entries(r.zones || {})) {
      if (!inBounds(z.x, z.y)) err(`region ${rid}: zone ${id} out of bounds`);
      if (!isInt(z.r) || z.r < 0) err(`region ${rid}: zone ${id} bad radius`);
    }
    if (blockedSet.has(`${r.spawn?.x},${r.spawn?.y}`)) err(`region ${rid}: spawn on blocked tile`);
  }
  for (const [qid, q] of Object.entries(c.quests || {})) {
    if (!Array.isArray(q.objectives) || !q.objectives.length) err(`quest ${qid}: no objectives`);
    for (const [i, o] of (q.objectives || []).entries()) {
      if (!['kill', 'collect', 'reach', 'attune'].includes(o.type)) err(`quest ${qid}#${i}: unknown objective type ${o.type}`);
      if (o.type === 'attune' && !FACETS.includes(o.facet)) err(`quest ${qid}#${i}: attune bad facet ${o.facet}`);
      if (o.n !== undefined && (!isInt(o.n) || o.n < 1)) err(`quest ${qid}#${i}: bad n`);
    }
    if (!q.reward || !isInt(q.reward.coins) || q.reward.coins < 0) err(`quest ${qid}: bad reward`);
    for (const req of q.requires || []) {
      if (!c.quests?.[req]) err(`quest ${qid}: requires unknown quest ${req}`);
    }
  }

  for (const [rid, r] of Object.entries(c.regions || {})) {
    if (rid !== c.startRegion) continue;
    if (!r.boss) { err(`region ${rid}: no boss for the finale`); continue; }
    if (!c.enemyKinds?.[r.boss.kind]) err(`region ${rid}: boss kind ${r.boss.kind} unknown`);
    if (r.enemies?.[r.boss.id]) err(`region ${rid}: boss id ${r.boss.id} collides with a normal enemy`);
    const inB = (x, y) => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < r.w && y < r.h;
    if (!inB(r.boss.x, r.boss.y)) err(`region ${rid}: boss out of bounds`);
    if (r.blocked && Object.prototype.hasOwnProperty.call(r.blocked, `${r.boss.x},${r.boss.y}`)) err(`region ${rid}: boss on blocked tile`);
    if (!r.zones?.['rift-edge']) err(`region ${rid}: missing rift-edge zone`);
    if (!r.zones?.['rift-gate']) err(`region ${rid}: missing rift-gate exit zone`);
  }
  const ARC_STEPS = ['talk', 'hear', 'choose1', 'choose2', 'choose3', 'attune', 'finale', 'light', 'rift', 'boss', 'choice', 'gate'];
  for (const step of ARC_STEPS) {
    if (!c.arc?.guide?.[step]) err(`arc: missing guide text for step ${step}`);
  }
  for (const block of ['intro', 'bossAppeared', 'bossTaunted', 'finale']) {
    if (!Array.isArray(c.arc?.[block]) || !c.arc[block].length) err(`arc: missing ${block} text`);
  }
  // Branching narrative: all 6 permutations of the 3 sprite facets must have
  // text at each keyed stage, or a real playthrough hits a blank/undefined.
  const PERMS = permutations(['player', 'world', 'enemies']);
  if (!c.branch) err('missing arc.branch content');
  else {
    for (const p of ['player', 'world', 'enemies']) {
      if (!c.branch.afterFirst?.[p]?.length) err(`branch.afterFirst missing text for ${p}`);
      if (!c.branch.options?.[p]) err(`branch.options missing entry for ${p}`);
    }
    for (const perm of PERMS) {
      const pair = perm.slice(0, 2).join(',');
      if (!c.branch.afterSecond?.[pair]?.length) err(`branch.afterSecond missing text for ${pair}`);
      const full = perm.join(',');
      if (!c.branch.finale?.[full]?.length) err(`branch.finale missing text for ${full}`);
    }
  }

  // --- rung 2: referential integrity ---------------------------------------
  if (c.archetypes && !c.archetypes[c.defaultArchetype]) err(`defaultArchetype ${c.defaultArchetype} does not exist`);
  if (c.regions && !c.regions[c.startRegion]) err(`startRegion ${c.startRegion} does not exist`);
  const allNpcs = {};
  for (const [rid, r] of Object.entries(c.regions || {})) {
    for (const [id, n] of Object.entries(r.npcs || {})) {
      allNpcs[id] = { ...n, region: rid };
      for (const it of n.shop || []) {
        if (!c.items?.[it]) err(`npc ${id}: shop sells unknown item ${it}`);
        else if (c.items[it].price === undefined) err(`npc ${id}: shop item ${it} has no price`);
      }
    }
    for (const [id, e] of Object.entries(r.enemies || {})) {
      if (!c.enemyKinds?.[e.kind]) err(`enemy ${id}: unknown kind ${e.kind}`);
    }
    for (const [id, p] of Object.entries(r.pickups || {})) {
      if (!c.items?.[p.item]) err(`pickup ${id}: unknown item ${p.item}`);
    }
  }
  const allEnemyIds = new Set(), allPickupIds = new Set();
  for (const r of Object.values(c.regions || {})) {
    for (const id of Object.keys(r.enemies || {})) allEnemyIds.add(id);
    for (const id of Object.keys(r.pickups || {})) allPickupIds.add(id);
  }
  for (const [qid, q] of Object.entries(c.quests || {})) {
    if (!allNpcs[q.giver]) err(`quest ${qid}: giver ${q.giver} does not exist`);
    for (const id of q.unlocks?.enemies || []) {
      if (!allEnemyIds.has(id)) err(`quest ${qid}: unlocks unknown enemy ${id}`);
    }
    for (const id of q.unlocks?.pickups || []) {
      if (!allPickupIds.has(id)) err(`quest ${qid}: unlocks unknown pickup ${id}`);
    }
  }

  // --- rung 3: completability ----------------------------------------------
  for (const [qid, q] of Object.entries(c.quests || {})) {
    for (const [i, o] of (q.objectives || []).entries()) {
      if (o.type === 'kill') {
        let count = 0;
        for (const r of Object.values(c.regions || {})) {
          for (const e of Object.values(r.enemies || {})) if (e.kind === o.target) count++;
        }
        if (count < (o.n || 1)) err(`quest ${qid}#${i}: needs ${o.n || 1} ${o.target} kills but only ${count} spawn`);
      }
      if (o.type === 'collect') {
        let obtainable = false;
        for (const r of Object.values(c.regions || {})) {
          for (const p of Object.values(r.pickups || {})) if (p.item === o.item) obtainable = true;
          for (const n of Object.values(r.npcs || {})) if ((n.shop || []).includes(o.item)) obtainable = true;
        }
        if (!obtainable) err(`quest ${qid}#${i}: item ${o.item} is unobtainable`);
      }
      if (o.type === 'attune') {
        let exists = false;
        for (const r of Object.values(c.regions || {})) {
          for (const wl of Object.values(r.wells || {})) if (wl.grants === o.facet) exists = true;
        }
        if (!exists) err(`quest ${qid}#${i}: no well grants facet ${o.facet}`);
      }
      if (o.type === 'reach') {
        let exists = false;
        for (const r of Object.values(c.regions || {})) {
          if (r.zones?.[o.zone]) exists = true;
        }
        if (!exists) err(`quest ${qid}#${i}: zone ${o.zone} does not exist`);
      }
    }
  }
  // A quest chain must actually be reachable: every `requires` edge (ALL of
  // them, not just the first) must bottom out at quests with no prereqs — no
  // cycles, nothing permanently locked. DFS the full requires graph from each
  // quest, not just its first prerequisite, or a cycle through a LATER
  // requires entry ships undetected.
  for (const qid of Object.keys(c.quests || {})) {
    const path = new Set();
    let cycle = false;
    const visit = (cur, depth) => {
      if (cycle || depth > 50) return;
      if (path.has(cur)) { err(`quest ${qid}: requires-chain cycle detected at ${cur}`); cycle = true; return; }
      path.add(cur);
      for (const req of c.quests[cur]?.requires || []) visit(req, depth + 1);
      path.delete(cur);
    };
    visit(qid, 0);
  }

  return errors;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}
