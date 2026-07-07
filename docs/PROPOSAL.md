# Wrong Sky — Proposal (drafted 2026-07-07)

Game 2 of the single-player offline saga; direct sequel to the Prologue. Same
genre and engine — an open-world 2D top-down action RPG in vanilla JS + HTML5
canvas, zero dependencies, static hosting. Original IP with Dragon Ball Z's
tonal DNA; no copied names, characters, or assets.

**Independence contract.** Wrong Sky is its own repo. It may clone the
Prologue and reuse its assets and architecture, but it *never edits the
Prologue* and does not import code from it — the two share nothing at runtime.
Story continuity travels one way, through the `saga.v1` export code
(name/archetype/skill levels/techniques/choice flags). Wrong Sky accepts a
Prologue code or a fresh-start default.

## Where the story picks up

The Prologue ends on its closing line — the sky is *wrong*. Wrong Sky opens
there: the world the player saved looks subtly, then unmistakably, altered.
This is a full gameplay chapter that continues the arc (home → **rival** →
tyrant → artificial threat → apocalyptic scale). It advances the story,
introduces new enemies and new goals, and adds systems the Prologue didn't
have — it is not a graphics demo.

## The pitch: seeing as progression

The Prologue was deliberately near-colorless. Wrong Sky is about *seeing*.
Its signature system is a **progressive visual unlock** chain (GRIS's
color-as-narrative device, adapted): the world begins muted and legible-but-
flat, and each story milestone restores a visual tier — color, light, depth,
motion weight — tied to a beat in the fiction, never a settings toggle.

**Crucial framing (do not lose this):** the visual unlocks are a *progression
system that runs parallel to real gameplay*. They decorate advancement; they
are not the advancement. A build that shipped only visual tiers with no new
enemies, goals, or inventory would be under-scoped. The visual chain is to
Wrong Sky what use-based skill growth was to the Prologue: a reward layer on
top of a real game.

## Scope

Full gameplay phase, comparable in length/shape to the Prologue (one region,
guided open first act into free roam, a two-beat finale that ends on the next
cliffhanger and prints the next `saga.vN` code).

**Gameplay content (the game itself):**
- **New enemies** — escalation past the Prologue's Ravager; their own
  `enemyKinds`, encounters, and at least one that reads differently once a
  later visual tier is unlocked (seeing more = fighting smarter).
- **New goals / objectives** — new quest content on the existing
  kill/collect/reach spine, plus any new objective type the story needs. The
  offer-not-push rule is kept (see Brain notes).
- **Inventory system** — the Prologue had a flat `player.inventory` array with
  no UI beyond auto-use. Wrong Sky needs a real inventory the player can view
  and manage; the visual-unlock gear is a natural thing to surface through it.
- **The rival thread** — the saga's rival is seeded/introduced here, setting
  up Phase 3's AI focus. Characterization now, deep AI later.

**Graphics & feel (the parallel unlock chain), each gated to a story beat:**
- **Resolution / DPI + text scaling** — the game fills the monitor's field of
  view without letterboxing or cut-off; text scales to stay readable. (See the
  scaling tension in Brain notes — the world canvas and the HUD text do NOT
  scale the same way.)
- **Color palette + progressive tiers** — limited palette + shading-ramp +
  hue-shift; muted → full color across the arc.
- **Sprite animation** — frame timing with uneven holds for perceived weight.
- **Camera** — deadzone, smoothing, clamp-to-region-bounds.
- **Y-sorting** — draw-order-by-depth for verticality.
- **Ambient occlusion / local lighting** — some solids block sight; some
  objects emit light where light is otherwise absent. Scoped to one region's
  geometry, not a general engine.
- **Basic viewport culling** — keep one region's frame budget stable as
  lighting/Y-sort add per-entity draw cost.
- **One audio-unlock interactable** — a single object that turns audio on
  (audio itself is mostly a solved problem from prior saga work; it doesn't
  need a phase). Everything else in the unlock chain is visual.

**Explicitly out of scope** (deferred — see the Prologue repo's
`docs/SAGA-ROADMAP.md`): minimap/world map, an external tilemap pipeline
(Tiled), multi-region streaming, deeper multi-tile collision, and
spatial-partitioning at world scale — all Phase 4, because they only pay off
once the world is bigger than one region. Accessibility work is dropped from
this phase's scope (deferred, not discarded).

## Technical spine (re-established, not imported)

Wrong Sky repeats the Prologue's architecture rules from its own Stage 0 —
these are patterns to rebuild, not shared code, because the repos don't depend
on each other:

- `reduce(state, command)` is the only mutator; the renderer reads and never
  writes (enforced mechanically — see Brain #E5 below).
- Seeded RNG (sfc32), full state saved; no ambient randomness, clock reads, or
  engine-varying transcendental math in `src/sim`.
- Authoritative fields are integers; floats live in presentation only.
- `makeWorld()` is the single constructor.
- Data-driven content with the validation ladder: schema → referential
  integrity → completability → headless smoke playthrough.
- Golden replay-fingerprint test (canonical sorted-key serialization, FNV-1a).

**The visual-unlock seam:** *which* tiers are unlocked is authoritative
gameplay progression — integer flags in sim state, saved and part of the
fingerprint. *How* a tier looks (palette, hue-shift, light) is pure
presentation — it reads those flags and never writes sim state. Keep the seam
clean or the determinism guard and the read-only-renderer boundary both catch
it.

## Brain notes (read fan-out, 2026-07-07)

Attributed per protocol — prior *pitfalls* (memory) and prior *ideas*. Where
they disagree, both are kept and the tension is flagged for the human.

**From memory (prior pitfalls) — apply directly:**
- `pappydapimp69/test#E11` `[animation][sync]` — data-sized text and authored
  motion *drift under any scale factor*; pin them at semantic anchors and
  piecewise-warp between pins. → The single most load-bearing note for the
  resolution/text-scaling work.
- `pappydapimp69/test#E5` `[gamedev][state][camera]` — a "read-only" renderer
  is one stray `=` from corrupting the save (`p.y = …` in camera code throws
  nothing). Enforce the boundary mechanically. → Camera, lighting, and
  Y-sorting all live in the renderer; this is exactly their terrain.
- `pappydapimp69/the-game-prologue#E3` `[input][ui]` — device key-hints must be
  computed at RENDER time from the active device, not baked in at construction.
  → The new inventory UI must honor this.
- `pappydapimp69/the-game-prologue#E9` `[gamedev][quest][state]` — make quest
  objectives agnostic of pre-acceptance history by not spawning target
  entities until ACCEPT_QUEST. → Applies to every new Wrong Sky quest.
- `local/dbh#E3` `[gamedev][backlog]` — internal roadmap items shouldn't leak
  as player-facing UI unless the player reads them as fiction. → The visual
  unlocks must present as story, not a graphics-options menu (this is already
  the design intent — the note keeps us honest).
- `local/dbh#E2` `[gamedev][ui][loop]` — modal overlays that pause the loop
  also pause canvas animation unless the modal path keeps a tick alive. → The
  inventory modal and any animated unlock-preview.
- `pappydapimp69/dog#E3` `[state][gamedev]` — one NaN silently poisons all
  downstream shared state; `isFinite`-guard boundaries. → Lighting/camera math
  is float-heavy; keep it in presentation and guard the seams.
- `pappydapimp69/the-game-prologue#E8` + `pappydapimp69/dog#E5`
  `[browser][tooling]` — a static-ESM entry-only `?v=` cache-bust does NOT
  refresh nested imports. → Bust every specifier at deploy, or document the
  gap, when Wrong Sky ships to Pages.
- `pappydapimp69/the-game-prologue#E1` `[determinism]` — canonicalize
  serialization before hashing; save raw PRNG state; grep-guard transcendental
  Math in the sim. → Re-established at Stage 0.

**From ideas (prior ideas) — reuse / adapt:**
- `[SYSTEM / data-model / overrides-not-mutation / resettable-defaults]` —
  model each visual tier as a *layer of overrides* on a base palette, never a
  mutation of the base; overrides stay resettable and could travel in a code.
  Cross-domain fit (it was mined for editable audio presets).
- `[RPG / progression / quests / offered-not-assigned]` — keep quests offered,
  never pushed, in the new content.
- `[RPG / progression / archetype-plus-use-skills / hybrid-identity]` — the
  Prologue's progression model carries over; the imported archetype seeds
  identity, use-based growth continues.
- `[SYSTEM / interaction / attention-then-guide / one-button-composition]` —
  a clean pattern for the audio-unlock interactable (attention burst → guide).
- `[SYSTEM / architecture / authoritative-reducer / command-event-seam]`,
  `[SYSTEM / determinism / seeded-rng / …]`,
  `[SYSTEM / content / objective-types / content-meets-code-seam]`,
  `[SYSTEM / input / unified-command-vocabulary]`,
  `[SYSTEM / input / device-adaptive-ui]` — the reusable engine spine.
- `[SYSTEM / sync / share-codes-not-accounts / backendless-portability]` — the
  `saga.v1` carryover contract, already proven in the Prologue.

**Tension kept open for the human (do not silently resolve):**
- The researched resolution technique is a single *uniform reference-resolution
  scale factor* (fill-not-letterbox), which is right for the world canvas. But
  memory `test#E11` warns that data-sized text and HUD elements *drift* under a
  uniform scale factor and should instead be pinned at semantic anchors and
  piecewise-warped. These disagree about text specifically. Likely resolution:
  scale the world canvas uniformly, but lay out HUD/text against anchored
  positions with their own sizing rule — decide the exact seam at build time,
  don't assume one factor covers both.

## Build stages

To be logged in `docs/STAGES.md` as each closes, gated by `npm run smoke`
(same discipline as the Prologue). Stage 0 re-establishes the deterministic
harness; content, arc, and the visual-unlock chain follow.
