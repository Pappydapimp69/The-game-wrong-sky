// Boot shell. Everything here is presentation; the sim lives in src/sim and
// is only ever mutated through game.js's dispatch.

import { runTitle } from './app/title.js';
import { startGame } from './app/game.js';

const canvas = document.getElementById('game');

// ?seed=N for reproducible sessions (dev/testing only — the title screen
// owns the real new-game/continue flow players see).
const params = new URLSearchParams(location.search);
const seed = Number.parseInt(params.get('seed') ?? '', 10);
const bootSeed = Number.isInteger(seed) ? seed : 0xa17a5;

async function boot() {
  const choice = await runTitle(canvas);
  const game = choice.action === 'continue'
    ? startGame(canvas, bootSeed, {}, choice.world)
    : startGame(canvas, bootSeed, { archetype: choice.archetype, difficulty: choice.difficulty });

  // Test hook — lets a headless harness read state and drive the same
  // command vocabulary as any input device. Read-only proxy: writes throw.
  window.__game = game;
}
boot();
