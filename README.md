# Wrong Sky

Game 2 of a single-player offline saga — a direct sequel to
[The Prologue](https://github.com/Pappydapimp69/The-game-prologue). Open-world
2D top-down action RPG in vanilla JS + HTML5 canvas, zero dependencies, static
hosting. Original IP with Dragon Ball Z's tonal DNA.

The Prologue was near-colorless on purpose. Wrong Sky is about **seeing**: a
full gameplay chapter whose signature system is a progressive *visual unlock*
chain — color, light, depth, and motion restored one story beat at a time —
layered on top of real progression (new enemies, new goals, an inventory
system), not in place of it.

**Independent by design.** This repo may reuse the Prologue's assets and
architecture but never edits it and shares no runtime code. Story continuity
travels only through the `saga.v1` export code.

See [`docs/PROPOSAL.md`](docs/PROPOSAL.md) for the full design and the Brain
knowledge query behind it. Build stages will be logged in `docs/STAGES.md`.

## Develop

```
npm run smoke   # deterministic headless test suite (added at Stage 0)
```
