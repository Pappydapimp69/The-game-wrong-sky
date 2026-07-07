# Build stages (agent-facing — never player-facing UI)

No stage begins until the previous stage's success criteria pass in
`npm run smoke`. Closure evidence lives here, not in the game. Wrong Sky
re-establishes the Prologue's determinism spine from scratch — this repo shares
no runtime code with the Prologue; the discipline is a pattern rebuilt, not an
import. (The three pure primitives — `rng.js`, `canonical.js`, `fingerprint.js`
— are byte-identical clones of the Prologue's, which is asset reuse, not a
dependency.)

## Stage 0 — Deterministic harness ✅ (closed 2026-07-07)

Scope: repo scaffold; seeded RNG (sfc32, full-state O(1) restore); canonical
sorted-key serializer that fails loud on NaN/Infinity/undefined/-0; FNV-1a
state fingerprint; a minimal walking-skeleton sim (TICK / MOVE with
blocked-tile refusal / DAMAGE via the seeded stream / UNLOCK_TIER) to exercise
the harness; golden replay test; forbidden-token determinism guard over
`src/sim`; a browser boot page that shares the exact sim modules and renders
the demo's resulting state + fingerprint.

The skeleton already seeds Wrong Sky's signature system in miniature:
`world.visualTier` is an authoritative integer progression flag (how many
visual tiers are unlocked), saved and part of the fingerprint — the *render*
of a tier will read it and never write it, keeping the sim/presentation seam
clean from the start.

Evidence:
- `npm run smoke`: 17/17 passing. Golden demo fingerprint `9f3e39c0` baked.
- Save/load mid-run resumes bit-exact (JSON round-trip mid-stream equals an
  uninterrupted run).
- Browser parity verified in headless Chromium: page fingerprint `9f3e39c0`
  matches the Node golden; zero page errors; screenshot captured.
- Determinism guard live: transcendental Math (sin/cos/…), `Math.random`,
  `Date.now`, `performance.now`, `new Date` all banned in `src/sim`; IEEE-exact
  ops (abs/max/min/floor/…) allowed.

## Next — Stage 1 (sim core, real verbs)

Replace the walking skeleton with Wrong Sky's real command vocabulary and the
data-driven content spine (regions, enemies, items, quests) plus the validation
ladder — same shape as the Prologue's Stage 1/3, rebuilt here. The visual-unlock
chain and its story gating layer on in later stages. See `docs/PROPOSAL.md`.
