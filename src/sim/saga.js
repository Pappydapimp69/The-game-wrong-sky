// The carryover contract between games of the saga. Versioned forever:
// SAGA<N>.<base64 canonical JSON>.<fnv1a32 checksum>. Every sequel accepts the
// PRIOR game's code OR a fresh start — the code is a courtesy, never a wall.
//
// Wrong Sky (game 2): IMPORTS the Prologue's saga.v1 (SAGA1) code to carry a
// run forward, and EXPORTS a saga.v2 (SAGA2) code for Part III. The imported
// choice (the Ravager's fate) is remembered and re-exported alongside this
// game's own choice, so the chain accumulates.

import { stableStringify } from './canonical.js';
import { fnv1a32 } from './fingerprint.js';

// What game 2 reads (the Prologue's output).
const IMPORT_PREFIX = 'SAGA1';
const IMPORT_VERSION = 'saga.v1';
// What game 2 writes (Part III's input).
export const SAGA_VERSION = 'saga.v2';
const EXPORT_PREFIX = 'SAGA2';

export function exportSaga(state) {
  if (!state.flags.ended) throw new Error('exportSaga: the chapter is not finished');
  const data = {
    v: SAGA_VERSION,
    game: 'wrong-sky',
    archetype: state.settings.archetype,
    difficulty: state.settings.difficulty,
    skills: {
      melee: state.player.skills.melee.lvl,
      aura: state.player.skills.aura.lvl,
      perception: state.player.skills.perception.lvl,
    },
    coins: state.player.coins,
    // Claiming the Second's power is the one technique game 2 grants by name.
    techniques: state.arc.choice === 'claim' ? ['second-aura'] : [],
    choices: {
      ravagerFate: state.flags.ravagerFate || '', // carried from the Prologue
      riftChoice: state.arc.choice,                // 'spare' | 'claim'
    },
  };
  const json = stableStringify(data);
  const payload = btoa(json);
  return `${EXPORT_PREFIX}.${payload}.${fnv1a32(payload)}`;
}

// Returns { ok: true, data } or { ok: false, error }. Never throws on user
// input — a mistyped code is a player mistake, not a crash. Accepts the
// Prologue's saga.v1 code (a fresh Part III would similarly accept THIS game's
// saga.v2 code; that's the sequel's job, not ours).
export function importSaga(code) {
  if (typeof code !== 'string') return { ok: false, error: 'not a string' };
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== IMPORT_PREFIX) return { ok: false, error: 'not a Prologue (saga.v1) code' };
  const [, payload, check] = parts;
  if (fnv1a32(payload) !== check) return { ok: false, error: 'checksum mismatch — mistyped or altered' };
  let data;
  try { data = JSON.parse(atob(payload)); } catch { return { ok: false, error: 'corrupt payload' }; }
  if (data.v !== IMPORT_VERSION) return { ok: false, error: `unsupported version ${data.v}` };
  for (const field of ['archetype', 'skills', 'choices']) {
    if (!data[field]) return { ok: false, error: `missing field ${field}` };
  }
  return { ok: true, data };
}
