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
// - Quests are offered, never pushed: TALK emits an offer; only ACCEPT_QUEST
//   activates it. Declining costs nothing and the offer stays available.

import { nextInt } from './rng.js';
import { isNight } from './daynight.js';

const MELEE_RANGE = 1;   // Chebyshev tiles
const BLAST_RANGE = 3;
const BLAST_COST = 3;
const XP_PER_LEVEL = 5;  // lvl N -> N+1 costs N*XP_PER_LEVEL

// Charge is press-and-hold, not tap-spam: the presentation dispatches one
// CHARGE per fixed real-time tick while the button stays down (start:true on
// the frame the hold begins, resetting the ramp). Rate = a mild ramp with hold
// duration, reshaped by CURRENT aura fill: fast from empty, throttled hard
// above the 80% mark regardless of how long the hold has run.
const CHARGE_RAMP_STEP = 4;  // every N consecutive ticks held...
const CHARGE_RAMP_CAP = 8;   // ...up to this many ticks of bonus
const CHARGE_TOP_PCT = 80;   // aura % at/above which charging is throttled

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
      if (state.region.blocked[`${nx},${ny}`]) return [{ type: 'blocked', x: nx, y: ny }];
      state.player.x = nx;
      state.player.y = ny;
      const events = [{ type: 'moved', x: nx, y: ny }];
      questProgress(state, events, 'reach', null);
      // The rift gate is the region's authoritative exit: sealed until the
      // finale arc is complete; stepping through when it is ends the chapter.
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
      const q = npc.offers;
      if (q && !state.quests.active[q] && !state.quests.completed[q]) {
        state.quests.offered[q] = 1;
        events.push({ type: 'quest_offered', quest: q });
      }
      return events;
    }

    case 'ACCEPT_QUEST': {
      const q = command.questId;
      if (!state.quests.offered[q]) throw new Error(`ACCEPT_QUEST: ${q} not offered`);
      const def = state.quests.defs[q];
      delete state.quests.offered[q];
      state.quests.active[q] = { progress: def.objectives.map(() => 0) };
      const events = [{ type: 'quest_accepted', quest: q }];
      // Unlock entities on accept — never before. Nothing this quest needs
      // existed until now, so completion never depends on prior actions.
      if (def.unlocks) {
        for (const [id, tmpl] of Object.entries(def.unlocks.enemies || {})) {
          state.enemies[id] = { ...tmpl };
          events.push({ type: 'enemy_appeared', target: id, kind: tmpl.kind });
        }
        for (const [id, tmpl] of Object.entries(def.unlocks.pickups || {})) {
          state.pickups[id] = { ...tmpl };
          events.push({ type: 'pickup_appeared', target: id, item: tmpl.item });
        }
        for (const [id, tmpl] of Object.entries(def.unlocks.wells || {})) {
          state.wells[id] = { ...tmpl };
          events.push({ type: 'well_appeared', target: id, facet: tmpl.grants });
        }
      }
      return events;
    }

    case 'INTERACT': {
      const p = state.pickups[command.pickupId];
      if (!p) throw new Error(`INTERACT: no pickup ${command.pickupId}`);
      if (p.taken) return [{ type: 'nothing_there', target: command.pickupId }];
      if (dist(state.player, p) > 1) return [{ type: 'too_far', target: command.pickupId }];
      p.taken = 1; // deactivate the one-shot the instant it's taken
      state.player.inventory.push(p.item);
      const events = [{ type: 'picked_up', item: p.item }];
      questProgress(state, events, 'collect', p.item);
      return events;
    }

    case 'ATTUNE': {
      // The signature verb: attune a well to restore a facet of the drained
      // world. Idempotent per well (a well answers once). 'audio' flips a
      // presentation flag; the three visual facets set authoritative flags the
      // renderer reads.
      const wl = state.wells[command.wellId];
      if (!wl) throw new Error(`ATTUNE: no well ${command.wellId}`);
      if (wl.attuned) return [{ type: 'nothing_there', target: command.wellId }];
      if (dist(state.player, wl) > 1) return [{ type: 'too_far', target: command.wellId }];
      wl.attuned = 1;
      const facet = wl.grants;
      const events = [{ type: 'attuned', well: command.wellId, facet }];
      if (facet === 'audio') state.flags.audio = 1;
      else state.visual[facet] = 1; // 'color' | 'light' | 'depth'
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
      // Immunity is a distinct, visible refusal (like too_far/no_aura) — never
      // a silent no-op. No XP either: nothing was accomplished.
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
        // Throttled near the cap — half the base rate, ignoring the ramp
        // entirely: "slower after 80%, regardless of how long held."
        gain = hold % 2 === 0 ? 1 : 0;
      } else {
        gain = 1 + Math.floor(Math.min(hold, CHARGE_RAMP_CAP) / CHARGE_RAMP_STEP);
        if (pct <= 0) gain += 1; // fills fastest from empty
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
      // The blast still fires and still costs aura — it just does nothing
      // against a crystalline hide. A clear, distinct event either way (never a
      // silent no-op), matching the MELEE case above.
      if (e.immune === 'aura') return [{ type: 'no_effect', target: command.enemyId, kind: 'aura' }];
      const dmg = state.player.skills.aura.lvl + 2 + nextInt(state.rng, 6);
      const events = hitEnemy(state, command.enemyId, e, dmg, 'aura');
      gainXp(state, events, 'aura');
      return events;
    }

    case 'CHOOSE_FATE': {
      // Game 2's one real choice — it travels into the saga export and colours
      // how the rival returns in Part III. 'spare' leaves you as you are;
      // 'claim' takes the Second's power (a permanent aura-skill gain).
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
      // Difficulty is a SETTING, not a decision — both tones ship (gentle is
      // the default; harsh raises every enemy hit by 1). Night stacks its own
      // +1: the clock is pressure, not paint.
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

// Runs a command stream. Test/replay helper.
export function replay(state, commands) {
  const events = [];
  for (const c of commands) events.push(...reduce(state, c));
  return events;
}

// --- internals -------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

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

// Use-based growth: the skill you exercise is the skill that levels.
function gainXp(state, events, skillName) {
  const s = state.player.skills[skillName];
  s.xp += 1;
  if (s.xp >= s.lvl * XP_PER_LEVEL) {
    s.xp = 0;
    s.lvl += 1;
    events.push({ type: 'skill_up', skill: skillName, lvl: s.lvl });
  }
}

// The finale arc OBSERVES the events of every command — it never intercepts
// them. The rival crests the rift once the sky is mended (the "Mend the Sky"
// quest is complete) and the player stands at the rift's edge.
function arcObserve(state, events) {
  const arc = state.arc;
  if (!arc || state.flags.ended) return;

  for (const e of events) {
    if (e.type === 'enemy_defeated' && e.target === arc.bossDef.id) arc.bossDefeated = 1;
  }

  // Spawn the rival: sky mended + standing at the rift's edge. Never respawns.
  if (!arc.bossSpawned && state.quests.completed['mend-the-sky']) {
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

  // At half health the Second stops holding back: a taunt, and +1 power.
  if (arc.bossSpawned && !arc.bossTaunted) {
    const boss = state.enemies[arc.bossDef.id];
    if (boss && boss.alive && boss.hp <= Math.floor(boss.maxHp / 2)) {
      arc.bossTaunted = 1;
      boss.power += 1;
      events.push({ type: 'boss_taunted' });
    }
  }
}

// Objective progress for all active quests. Objective types are the
// code/content seam: adding a quest is data; adding a TYPE is a case here.
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
      events.push({ type: 'quest_completed', quest: qId, reward: def.reward });
    }
  }
}
