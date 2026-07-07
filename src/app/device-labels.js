// Device-adaptive control hints: never make the player translate — show the
// glyph of the device actually in their hands. A modal/title button's
// on-screen prompt must match whatever input device is currently active,
// re-derived every frame (so switching keyboard -> gamepad mid-modal updates
// the text live, not just at the moment the modal was created).

const KEYBOARD = { confirm: 'Enter', cancel: 'Esc', alt: 'K', up: 'W', down: 'S', left: 'A', right: 'D' };
const GAMEPAD = { confirm: 'A', cancel: 'B', alt: 'X', up: 'D-Pad', down: 'D-Pad', left: 'D-Pad', right: 'D-Pad' };

// action: 'confirm' | 'cancel' | 'alt' (the same ids modal/title buttons use,
// which is why they double as the input vocabulary's action names).
export function keyHint(device, action) {
  if (device === 'touch') return ''; // the button IS the input; no hint needed
  const map = device === 'gamepad' ? GAMEPAD : KEYBOARD;
  return map[action] || '';
}

// Appends " (Hint)" to a base label, or nothing on touch.
export function withHint(device, action, baseLabel) {
  const hint = keyHint(device, action);
  return hint ? `${baseLabel} (${hint})` : baseLabel;
}
