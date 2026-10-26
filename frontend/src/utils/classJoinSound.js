/* Per-user preference for the soft "someone joined" cue in the live classroom.
 *
 * Deliberately separate from the app-wide move-sound preference in
 * `utils/sound.js`: move sounds default ON, but a classroom join chime must be
 * OFF until the user opts in (it plays over a lesson someone else may be
 * teaching). The cue itself still routes through `playSound`, so the global
 * Sound effects toggle and volume apply on top of this.
 */

const KEY = 'kpa_class_join_sound';

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return v !== '0' && v !== 'false';
  } catch {
    return false;
  }
}

let enabled = read();
const listeners = new Set();

export function isClassJoinSoundEnabled() {
  return enabled;
}

export function setClassJoinSoundEnabled(v) {
  const next = Boolean(v);
  if (next === enabled) return;
  enabled = next;
  try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* private mode */ }
  listeners.forEach((fn) => {
    try { fn(enabled); } catch { /* a bad listener must not break the preference */ }
  });
}

/** Subscribe to changes so a toggle and the listener stay in sync. */
export function subscribeClassJoinSound(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
