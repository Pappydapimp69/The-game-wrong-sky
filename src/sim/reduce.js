// reduce(state, command) is the ONLY thing that mutates authoritative state.
// It returns an array of events for the presentation layer to consume; the
// renderer reads state and never writes it.
//
// Contract notes (permanent):
// - Commands target entities by stable id, never by position or index.
// - Dodge i-frames are the RENDERER withholding ENEMY_STRIKE for the window —
//   there is no "invulnerable" flag in authoritative state.
// - Enemy aggression is its own command (ENEMY_STRIKE), issued by the
//   presentation layer's AI driver, so the sim stays a pure reducer.
// - Quests are offered, never pushed: TALK emits offers for every quest whose
//   giver/prereqs match; only ACCEPT_QUEST activates one. Declining costs
//   nothing and the offer(s) stay available.
// - Wells are ALWAYS present (never existence-gated) — ATTUNE only has a real
//   effect on the well matching the CURRENT active quest's attune facet; any
//   other well returns its always-present flavor hint, never an error.

import { nextInt } from './rng.js';
import { isNight } from './daynight.js';

const MELEE_RANGE = 1;
const BLAST_RANGE = 3;
const BLAST_COST = 3;
const XP_PER_LEVEL = 5;

const CHARGE_RAMP_STEP = 4;
const CHARGE_RAMP_CAP = 8;
const CHARGE_TOP_PCT = 80;

// The three sprite-reveal quests, in the order their completion is tracked
// for the branching narrative (order picked, not this list's order).
const REVEAL_QUESTS = { 'reveal-player': 'player', 'reveal-world': 'world', 'reveal-enemies': 'enemies' };

export function reduce(state, command) {
  const events = reduceCore(state, command);
  arcObserve(state, events);
  return events;
}

function reduceCore(state, command) {
  switch (command.type) {
    case 'TICK': {
      state.tick += 1;
      return [];
    }

    case 'MOVE': {
      const { dx, dy } = command;
      if (!Number.isInteger(dx) || !Number.isInteger(dy)) throw new Error('MOVE: dx/dy must be integers');
      const nx = clamp(state.player.x + clamp(dx, -1, 1), 0, state.region.w - 1);
      const ny = clamp(state.player.y + clamp(dy, -1, 1), 0, state.region.h - 1);
      // Collision is existence-based, not magnitude-based: a 0-opacity blocked
      // tile (a legitimate future case — an invisible solid) must still block
      // movement. `blocked[key]` stores the OPACITY value, which would be
      // falsy at exactly 0, so check key presence, not truthiness.
      if (Object.prototype.hasOwnProperty.call(state.region.blocked, `${nx},${ny}`)) {
        return [{ type: 'blocked', x: nx, y: ny }];
      }
      state.player.x = nx;
      state.player.y = ny;
      const events = [{ type: 'moved', x: nx, y: ny }];
      questProgress(state, events, 'reach', null);
      const gate = state.region.zones['rift-gate'];
      if (gate && Math.max(Math.abs(nx - gate.x), Math.abs(ny - gate.y)) <= gate.r) {
        if (state.arc.complete && !state.flags.ended) {
          state.flags.ended = 1;
          events.push({ type: 'chapter_complete' });
        } else if (!state.arc.complete) {
          events.push({ type: 'exit_locked' });
        }
      }
      return events;
    }

    case 'TALK': {
      const npc = state.npcs[command.npcId];
      if (!npc) throw new Error(`TALK: no npc ${command.npcId}`);
      if (dist(state.player, npc) > 1) return [{ type: 'too_far', target: command.npcId }];
      const events = [{ type: 'talked', npc: command.npcId }];
      // Offer EVERY quest this npc gives whose prereqs are met and that isn't
      // already active/completed — this is what makes a 3-way (then 2-way,
      // then 1-way) choice possible: all currently-eligible quests surface
      // together as one combined offer, not one at a time.
      const offerable = Object.entries(state.quests.defs)
        .filter(([qid, def]) => def.giver === command.npcId)
        .filter(([qid]) => !state.quests.active[qid] && !state.quests.completed[qid])
        .filter(([qid, def]) => (def.requires || []).every((r) => state.quests.completed[r]))
        .map(([qid]) => qid)
        .sort();
      if (offerable.length) {
        for (const qid of offerable) state.quests.offered[qid] = 1;
        events.push({ type: 'quests_offered', quests: offerable });
      }
      return events;
    }

    case 'ACCEPT_QUEST': {
      const q = command.questId;
      if (!state.quests.offered[q]) throw new Error(`ACCEPT_QUEST: ${q} not offered`);
      const def = state.quests.defs[q];
      // Accepting one offer withdraws EVERY other still-pending offer from the
      // same giver — the philosophical pick is exclusive; picking one of the
      // 3-way (then 2-way) choice must not leave the others silently
      // acceptable too. The next TALK recomputes the correct remaining
      // offerable set from scratch (active/completed/requires), so nothing
      // legitimately eligible is lost — only the stale batch is cleared.
      for (const oid of Object.keys(state.quests.offered)) {
        if (state.quests.defs[oid].giver === def.giver) delete state.quests.offered[oid];
      }
      state.quests.active[q] = { progress: def.objectives.map(() => 0) };
      const events = [{ type: 'quest_accepted', quest: q }];
      if (def.unlocks) {
        for (const [id, tmpl] of Object.entries(def.unlocks.enemies || {})) {
          state.enemies[id] = { ...tmpl };
          events.push({ type: 'enemy_appeared', target: id, kind: tmpl.kind });
        }
        for (const [id, tmpl] of Object.entries(def.unlocks.pickups || {})) {
          state.pickups[id] = { ...tmpl };
          events.push({ type: 'pickup_appeared', target: id, item: tmpl.item });
        }
      }
      return events;
    }

    case 'INTERACT': {
      const p = state.pickups[command.pickupId];
      if (!p) throw new Error(`INTERACT: no pickup ${command.pickupId}`);
      if (p.taken) return [{ type: 'nothing_there', target: command.pickupId }];
      if (dist(state.player, p) > 1) return [{ type: 'too_far', target: command.pickupId }];
      p.taken = 1;
      state.player.inventory.push(p.item);
      const events = [{ type: 'picked_up', item: p.item }];
      questProgress(state, events, 'collect', p.item);
      return events;
    }

    case 'ATTUNE': {
      const wl = state.wells[command.wellId];
      if (!wl) throw new Error(`ATTUNE: no well ${command.wellId}`);
      if (dist(state.player, wl) > 1) return [{ type: 'too_far', target: command.wellId }];
      if (wl.attuned) return [{ type: 'nothing_there', target: command.wellId }];
      // Effect-gated, not existence-gated: this well only does something if
      // its facet matches an objective on a currently ACTIVE quest. Anything
      // else is a soft non-effect with the well's always-present flavor hint
      // — never a throw, never a hard refusal (the well simply hasn't been
      // "asked the right question" yet).
      if (!activeAttuneFacets(state).has(wl.grants)) {
        return [{ type: 'well_hint', well: command.wellId, facet: wl.grants }];
      }
      wl.attuned = 1;
      const facet = wl.grants;
      const events = [{ type: 'attuned', well: command.wellId, facet }];
      if (facet === 'audio') state.flags.audio = 1;
      else state.visual[facet] = 1; // 'player' | 'world' | 'enemies' | 'light'
      questProgress(state, events, 'attune', facet);
      return events;
    }

    case 'BREAK': {
      const d = state.destructibles[command.destructibleId];
      if (!d) throw new Error(`BREAK: no destructible ${command.destructibleId}`);
      if (d.broken) return [{ type: 'nothing_there', target: command.destructibleId }];
      if (dist(state.player, d) > 1) return [{ type: 'too_far', target: command.destructibleId }];
      d.broken = 1;
      state.player.coins += d.coins;
      return [{ type: 'broke', target: command.destructibleId, coins: d.coins }];
    }

    case 'MELEE': {
      const e = livingEnemy(state, command.enemyId, 'MELEE');
      if (typeof e === 'object' && e.type) return [e];
      if (dist(state.player, e) > MELEE_RANGE) return [{ type: 'too_far', target: command.enemyId }];
      if (e.immune === 'melee') return [{ type: 'no_effect', target: command.enemyId, kind: 'melee' }];
      const dmg = state.player.skills.melee.lvl + 1 + nextInt(state.rng, 4);
      const events = hitEnemy(state, command.enemyId, e, dmg, 'melee');
      gainXp(state, events, 'melee');
      return events;
    }

    case 'CHARGE': {
      const p = state.player;
      if (command.start) p.chargeHold = 0;
      const hold = p.chargeHold;
      const pct = p.maxAura > 0 ? Math.floor((p.aura * 100) / p.maxAura) : 100;

      let gain;
      if (pct >= CHARGE_TOP_PCT) {
        gain = hold % 2 === 0 ? 1 : 0;
      } else {
        gain = 1 + Math.floor(Math.min(hold, CHARGE_RAMP_CAP) / CHARGE_RAMP_STEP);
        if (pct <= 0) gain += 1;
      }

      p.aura = Math.min(p.maxAura, p.aura + gain);
      p.chargeHold = hold + 1;
      return [{ type: 'charged', aura: p.aura, gain }];
    }

    case 'AURA_BLAST': {
      const e = livingEnemy(state, command.enemyId, 'AURA_BLAST');
      if (typeof e === 'object' && e.type) return [e];
      if (dist(state.player, e) > BLAST_RANGE) return [{ type: 'too_far', target: command.enemyId }];
      if (state.player.aura < BLAST_COST) return [{ type: 'no_aura', need: BLAST_COST }];
      state.player.aura -= BLAST_COST;
      if (e.immune === 'aura') return [{ type: 'no_effect', target: command.enemyId, kind: 'aura' }];
      const dmg = state.player.skills.aura.lvl + 2 + nextInt(state.rng, 6);
      const events = hitEnemy(state, command.enemyId, e, dmg, 'aura');
      gainXp(state, events, 'aura');
      return events;
    }

    case 'CHOOSE_FATE': {
      if (!state.arc.bossDefeated || state.arc.complete) return [{ type: 'not_now' }];
      if (command.fate !== 'spare' && command.fate !== 'claim') {
        throw new Error(`CHOOSE_FATE: bad fate ${command.fate}`);
      }
      state.arc.choice = command.fate;
      state.arc.complete = 1;
      const events = [{ type: 'arc_complete', choice: command.fate }];
      if (command.fate === 'claim') {
        state.player.skills.aura.lvl += 1;
        events.push({ type: 'power_claimed', skill: 'aura', lvl: state.player.skills.aura.lvl });
      }
      return events;
    }

    case 'ENEMY_STRIKE': {
      const e = livingEnemy(state, command.enemyId, 'ENEMY_STRIKE');
      if (typeof e === 'object' && e.type) return [e];
      if (dist(state.player, e) > MELEE_RANGE) return [{ type: 'too_far', target: command.enemyId }];
      const dmg = e.power + nextInt(state.rng, 3)
        + (state.settings.difficulty === 'harsh' ? 1 : 0)
        + (isNight(state.tick) ? 1 : 0);
      state.player.hp = Math.max(0, state.player.hp - dmg);
      const events = [{ type: 'player_hit', by: command.enemyId, dmg, hp: state.player.hp }];
      if (state.player.hp === 0) events.push({ type: 'player_defeated' });
      return events;
    }

    case 'BUY': {
      const item = state.items[command.itemId];
      if (!item) throw new Error(`BUY: no item ${command.itemId}`);
      if (item.price === undefined) return [{ type: 'not_for_sale', item: command.itemId }];
      if (state.player.coins < item.price) return [{ type: 'cant_afford', item: command.itemId }];
      state.player.coins -= item.price;
      state.player.inventory.push(command.itemId);
      return [{ type: 'bought', item: command.itemId, coins: state.player.coins }];
    }

    case 'USE_ITEM': {
      const idx = state.player.inventory.indexOf(command.itemId);
      if (idx === -1) return [{ type: 'no_item', item: command.itemId }];
      const item = state.items[command.itemId];
      if (!item || !item.heal) return [{ type: 'cant_use', item: command.itemId }];
      state.player.inventory.splice(idx, 1);
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + item.heal);
      return [{ type: 'healed', hp: state.player.hp }];
    }

    default:
      throw new Error(`reduce: unknown command ${command.type}`);
  }
}

export function replay(state, commands) {
  const events = [];
  for (const c of commands) events.push(...reduce(state, c));
  return events;
}

// --- internals -------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

// The set of facets a well-attune would currently take real effect for — at
// most one active quest's `attune` objective at a time in this content, but
// this scans generally so future content can layer more without a rewrite.
function activeAttuneFacets(state) {
  const facets = new Set();
  for (const qId of Object.keys(state.quests.active)) {
    const def = state.quests.defs[qId];
    for (const obj of def.objectives) if (obj.type === 'attune') facets.add(obj.facet);
  }
  return facets;
}

function livingEnemy(state, id, cmd) {
  const e = state.enemies[id];
  if (!e) throw new Error(`${cmd}: no enemy ${id}`);
  if (!e.alive) return { type: 'already_down', target: id };
  return e;
}

function hitEnemy(state, id, e, dmg, kind) {
  e.hp = Math.max(0, e.hp - dmg);
  const events = [{ type: 'enemy_hit', target: id, kind, dmg, hp: e.hp }];
  if (e.hp === 0) {
    e.alive = 0;
    state.player.coins += 2;
    events.push({ type: 'enemy_defeated', target: id, kind: e.kind });
    questProgress(state, events, 'kill', e.kind);
  }
  return events;
}

function gainXp(state, events, skillName) {
  const s = state.player.skills[skillName];
  s.xp += 1;
  if (s.xp >= s.lvl * XP_PER_LEVEL) {
    s.xp = 0;
    s.lvl += 1;
    events.push({ type: 'skill_up', skill: skillName, lvl: s.lvl });
  }
}

function arcObserve(state, events) {
  const arc = state.arc;
  if (!arc || state.flags.ended) return;

  for (const e of events) {
    if (e.type === 'enemy_defeated' && e.target === arc.bossDef.id) arc.bossDefeated = 1;
  }

  if (!arc.bossSpawned && state.quests.completed['mend-the-sky-finale']) {
    const edge = state.region.zones['rift-edge'];
    const atEdge = edge && Math.max(Math.abs(state.player.x - edge.x), Math.abs(state.player.y - edge.y)) <= edge.r;
    if (atEdge && !state.enemies[arc.bossDef.id]) {
      const b = arc.bossDef;
      state.enemies[b.id] = {
        x: b.x, y: b.y, kind: b.kind,
        hp: b.hp, maxHp: b.hp, power: b.power, alive: 1,
        immune: b.immune || '',
      };
      arc.bossSpawned = 1;
      events.push({ type: 'boss_appeared', boss: b.id });
    }
  }

  if (arc.bossSpawned && !arc.bossTaunted) {
    const boss = state.enemies[arc.bossDef.id];
    if (boss && boss.alive && boss.hp <= Math.floor(boss.maxHp / 2)) {
      arc.bossTaunted = 1;
      boss.power += 1;
      events.push({ type: 'boss_taunted' });
    }
  }
}

function questProgress(state, events, type, target) {
  for (const qId of Object.keys(state.quests.active).sort()) {
    const def = state.quests.defs[qId];
    const st = state.quests.active[qId];
    let done = true;
    def.objectives.forEach((obj, i) => {
      if (obj.type === type) {
        const need = obj.n || 1;
        let match = false;
        if (obj.type === 'kill') match = obj.target === target;
        else if (obj.type === 'collect') match = obj.item === target;
        else if (obj.type === 'attune') match = obj.facet === target;
        else if (obj.type === 'reach') {
          const z = state.region.zones[obj.zone];
          match = !!z && Math.max(Math.abs(state.player.x - z.x), Math.abs(state.player.y - z.y)) <= z.r;
        }
        if (match && st.progress[i] < need) {
          st.progress[i] += 1;
          events.push({ type: 'objective_progress', quest: qId, objective: i, at: st.progress[i], of: need });
        }
      }
      if (st.progress[i] < (obj.n || 1)) done = false;
    });
    if (done) {
      delete state.quests.active[qId];
      state.quests.completed[qId] = 1;
      state.player.coins += def.reward.coins || 0;
      // Track the ORDER the three sprite-reveal quests complete in — this is
      // what makes the branching narrative order-sensitive (ABC vs BCA),
      // not just set-sensitive.
      if (REVEAL_QUESTS[qId]) state.flags.revealOrder.push(REVEAL_QUESTS[qId]);
      events.push({ type: 'quest_completed', quest: qId, reward: def.reward });
    }
  }
}
