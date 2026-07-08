// Procedural sound, unlocked in-world by attuning the resonance well (never a
// settings toggle). Pure Web Audio — zero assets, a few oscillators with ADSR
// envelopes. Presentation only: it reads sim EVENTS, never state.
//
// Mute-button pattern: prime() creates the AudioContext muted (gain 0) on the
// player's very FIRST real input of the session — always a genuine user
// gesture, so the browser autoplay gate never blocks it, even on a resumed
// save where the resonance well was already attuned in a prior session.
// unmute() (called on the real in-world attune) just raises the gain — no
// context creation, so no gesture requirement to satisfy at that point.

export function makeAudio() {
  let ctx = null;
  let master = null;
  let primed = false;
  let unmuted = false;

  function prime() {
    if (primed) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0; // muted until the resonance well is attuned
      master.connect(ctx.destination);
      primed = true;
    } catch { primed = false; }
  }

  // Raises the gain so scheduled tones become audible. `quiet` skips the
  // confirmation chord — used when silently re-unmuting a resumed save
  // where audio was already unlocked in a prior session.
  function unmute({ quiet = false } = {}) {
    if (!primed) prime();
    if (!primed || unmuted) return;
    unmuted = true;
    master.gain.value = 0.22;
    if (!quiet) {
      // A soft rising "the world sounds again" chord as confirmation.
      blip(440, 0.0, 'sine', 0.18);
      blip(660, 0.06, 'sine', 0.18);
      blip(880, 0.12, 'triangle', 0.22);
    }
  }

  // One enveloped tone. t0 = delay (s) from now; dur = length (s). Scheduled
  // as soon as the context is primed, even while muted — silence is just
  // gain 0, not "nothing happening."
  function blip(freq, t0 = 0, type = 'square', dur = 0.12, slideTo = null) {
    if (!primed || !ctx) return;
    const start = ctx.currentTime + t0;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    // ADSR-ish: quick attack, exponential release (uneven, so it reads as a
    // hit rather than a beep).
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(1, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g); g.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  // Event-named cues. Unknown names are ignored, so game.js can call freely.
  function play(name) {
    if (!primed) return;
    switch (name) {
      case 'melee': blip(220, 0, 'square', 0.09, 140); break;
      case 'aura': blip(520, 0, 'sawtooth', 0.16, 180); break;
      case 'hit': blip(160, 0, 'triangle', 0.10); break;
      case 'no_effect': blip(120, 0, 'sine', 0.14, 90); break;
      case 'break': blip(90, 0, 'square', 0.14, 60); break;
      case 'pickup': blip(760, 0, 'triangle', 0.10, 990); break;
      case 'attune': blip(392, 0, 'sine', 0.22, 784); break;
      case 'quest': blip(523, 0, 'triangle', 0.14, 659); break;
      case 'defeat': blip(300, 0, 'sawtooth', 0.28, 70); break;
      case 'boss': blip(70, 0, 'sawtooth', 0.5, 50); blip(140, 0.05, 'square', 0.4); break;
      case 'heal': blip(500, 0, 'sine', 0.2, 720); break;
      case 'hurt': blip(180, 0, 'sawtooth', 0.14, 110); break;
      case 'chapter': blip(392, 0, 'sine', 0.3, 523); blip(587, 0.15, 'triangle', 0.4); break;
      default: break;
    }
  }

  return { prime, unmute, play, get enabled() { return unmuted; } };
}
