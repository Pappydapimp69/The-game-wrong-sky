// reduce(state, command) is the ONLY mutator of authoritative state. The
// renderer reads state and never writes it (enforced by a read-only proxy at
// Stage 2, same as the Prologue). Every command returns an event list so the
// presentation layer can react without inspecting state diffs.
//
// Determinism: integer arithmetic only, all randomness through state.rng
// (seeded sfc32). Math.abs/max/min are IEEE-exact and allowed; no ambient
// randomness, clock reads, or transcendental Math (the smoke suite greps for
// banned tokens across src/sim).

import { nextInt } from './rng.js';
import { FIELD_W, FIELD_H } from './world.js';

export function reduce(state, command) {
  const events = [];
  switch (command.type) {
    case 'TICK':
      state.tick = (state.tick + 1) | 0;
      break;

    case 'MOVE': {
      const dx = command.dx | 0, dy = command.dy | 0;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) throw new Error(`MOVE: step out of range (${dx},${dy})`);
      const nx = state.player.x + dx, ny = state.player.y + dy;
      if (nx >= 0 && nx < FIELD_W && ny >= 0 && ny < FIELD_H) {
        state.player.x = nx;
        state.player.y = ny;
      } else {
        events.push({ type: 'blocked', dx, dy });
      }
      break;
    }

    case 'DAMAGE': {
      // RNG-driven so the golden fingerprint proves the seeded stream flows
      // through authoritative state deterministically. Integer roll only.
      const roll = 1 + nextInt(state.rng, 6);
      state.player.hp = Math.max(0, state.player.hp - roll);
      events.push({ type: 'damaged', amount: roll, hp: state.player.hp });
      break;
    }

    case 'UNLOCK_TIER':
      state.visualTier = (state.visualTier + 1) | 0;
      events.push({ type: 'tier_unlocked', tier: state.visualTier });
      break;

    default:
      throw new Error(`reduce: unknown command ${command.type}`);
  }
  return events;
}

// Apply a sequence of commands in order; returns the LAST command's events
// (matches how single-command call sites read the result).
export function replay(state, commands) {
  let events = [];
  for (const c of commands) events = reduce(state, c);
  return events;
}
