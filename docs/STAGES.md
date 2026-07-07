# Build stages (agent-facing — never player-facing UI)

No stage begins until the previous stage's success criteria pass in
`npm run smoke`. Closure evidence lives here, not in the game. Wrong Sky is
built on the Prologue's engine (asset reuse — byte-identical clones of the pure
primitives, the reducer/renderer/input/save architecture rebuilt and extended)
with NO runtime dependency on the Prologue; continuity travels only through the
`saga.v1` → `saga.v2` export code.

## Stage 0 — Deterministic harness ✅ (closed 2026-07-07)

Walking-skeleton sim proving the determinism spine in the fresh repo. Seeded
sfc32 RNG (full-state restore), canonical sorted-key serializer, FNV-1a
fingerprint, golden replay, forbidden-token guard, browser parity. Superseded
by the full engine below but recorded here as the harness's first green.

## Stage 1 — Full game-2 build ✅ (closed 2026-07-07)

Rather than re-deriving the Prologue's stages one at a time, Wrong Sky adopted
the Prologue's proven engine wholesale and built its unique layer on top in one
pass, gated the whole way by the smoke suite.

Scope delivered:
- **Sim** — new region *Palewash Reach* (40×24, a camera-scale world); the
  Hollow bestiary (Palewisp; Gloomhide `immune:aura`; Shardling `immune:melee`;
  Hollow Echo; and the finale rival *The Second*); Sable + shop NPCs; the *Mend
  the Sky* quest exercising every objective type (kill/collect/reach + the new
  `attune`); use-based skill growth; perception-gated readouts; Gentle/Harsh.
- **Signature system** — `state.visual {color,light,depth}` authoritative facets
  restored by the new `ATTUNE` verb on **wells**; a standalone resonance well
  sets `state.flags.audio`. All quest-gated wells/enemies/pickup obey the E9
  "don't exist until accepted" rule, so completion is agnostic of prior actions.
- **Finale arc** — the rival crests the rift once the sky is mended and the
  player reaches the edge; taunts and hardens at half HP; `CHOOSE_FATE`
  spare|claim travels into `saga.v2`. No mentor/ally — the player is alone.
- **Carryover** — `saga.js` imports the Prologue's `saga.v1` (archetype/skills/
  choice), applied by `makeWorld(options.saga)`; exports `saga.v2` for Part III.
- **Presentation** — facet-driven rendering (grayscale→color; an offscreen
  darkness+light-pool layer with opaque-wall occluders once light returns;
  Y-sort + ground shadows once depth returns); a camera that follows the player
  and clamps to the region so the world fills the viewport at any resolution
  (fill-not-letterbox), with viewport culling and HUD/text anchored in its own
  screen-space scale (Brain test#E11); procedural Web Audio unlocked in-world;
  a real inventory modal; the title screen's saga-code carryover flow; a
  DPR-aware responsive canvas.

Evidence:
- `npm run smoke`: **31/31** passing. Golden demo fingerprint `f2ab27dd` baked.
  Determinism guard, read-only renderer boundary, content validation ladder
  (extended for wells/attune), quest-gated-entity (E9), immunity refusals, and
  saga import/export round-trip all covered.
- Save/load mid-run resumes bit-exact.
- Browser e2e (headless Chromium, 1280×720): boots clean (zero page errors);
  **in-browser sim fingerprint matches the Node golden `f2ab27dd`**; a full live
  playthrough through the real dispatch seam mends the sky (all three visual
  facets + audio restored), beats the Second, records the choice, and ends the
  chapter. Drained→restored visual progression captured in screenshots;
  inventory modal verified.
- Adversarial bug-check pass across sim / presentation / playability
  dimensions (see git history for fixes applied).

## Deploy

`.github/workflows/deploy-pages.yml` builds to GitHub Pages, gated on the smoke
suite. Requires Pages to be enabled once on the repo (Settings → Pages → Source:
GitHub Actions) before the first deploy can publish.
