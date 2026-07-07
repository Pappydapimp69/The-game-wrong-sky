// A fixed scripted playthrough shared by the smoke suite (Node) and the boot
// page (browser). Both environments must produce the identical fingerprint —
// that IS the browser-parity check at Stage 0. The script exercises every
// skeleton verb at least once, including the blocked-move refusal path.

export const DEMO_SEED = 0x5c1e5; // "skies"

const M = (dx, dy) => ({ type: 'MOVE', dx, dy });

export function demoCommands() {
  return [
    { type: 'TICK' },
    // Wander the field.
    M(1, 0), M(1, 0), M(0, 1), M(1, 1),
    // Take a couple of RNG-driven hits — proves the seeded stream is threaded.
    { type: 'DAMAGE' }, { type: 'DAMAGE' },
    // Unlock the first visual tier (additive integer progression).
    { type: 'UNLOCK_TIER' },
    M(-1, 0), M(0, 1), M(-1, -1),
    { type: 'UNLOCK_TIER' },
    { type: 'TICK' }, { type: 'TICK' },
    // Walk hard into the west then north wall — more steps than the field is
    // wide/tall, so the last few MOVEs land on the wall and emit `blocked`.
    M(-1, 0), M(-1, 0), M(-1, 0), M(-1, 0), M(-1, 0), M(-1, 0), M(-1, 0),
    M(-1, 0), M(-1, 0), M(-1, 0), M(-1, 0), M(-1, 0), M(-1, 0),
    M(0, -1), M(0, -1), M(0, -1), M(0, -1), M(0, -1), M(0, -1), M(0, -1),
    M(0, -1), M(0, -1), M(0, -1), M(0, -1), M(0, -1), M(0, -1),
    { type: 'DAMAGE' },
    { type: 'TICK' },
  ];
}
