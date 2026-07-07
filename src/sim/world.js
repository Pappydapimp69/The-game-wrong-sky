// makeWorld is the ONLY constructor of authoritative state (New Game, tests,
// and save-schema defaults all go through here). Wrong Sky re-establishes the
// Prologue's determinism spine from scratch — this repo shares no runtime code
// with the Prologue; the discipline is a pattern rebuilt, not an import.
//
// Stage 0 is a WALKING SKELETON: just enough state and verbs to exercise the
// deterministic harness (seeded RNG, canonical fingerprint, save/load). Real
// content, regions, and the visual-unlock chain arrive in later stages.
// Authoritative fields are integers only.

import { makeRng } from './rng.js';

export const WORLD_VERSION = 'ws-stage0';

// Skeleton play-field bounds (a real region model replaces this at Stage 1).
export const FIELD_W = 12;
export const FIELD_H = 12;

export function makeWorld(seed) {
  if (!Number.isInteger(seed)) throw new Error('makeWorld: seed must be an integer');
  return {
    version: WORLD_VERSION,
    seed: seed >>> 0,
    tick: 0,
    rng: makeRng(seed >>> 0),
    player: {
      x: FIELD_W >> 1, y: FIELD_H >> 1,
      hp: 20, maxHp: 20,
    },
    // Wrong Sky's signature system, in skeleton form: how many visual tiers the
    // player has unlocked so far. This is AUTHORITATIVE gameplay progression —
    // an integer flag in sim state, saved and part of the fingerprint. How a
    // tier LOOKS (palette, light, depth) is presentation and reads this flag;
    // it never writes here. At Stage 0 the field just proves additive integer
    // progression flows deterministically through the fingerprint.
    visualTier: 0,
  };
}
