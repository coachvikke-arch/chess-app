// Single source of truth for the in-app VIBRATION preference (haptics).
//
// Mirrors config/autoQueen.js and config/legalMoves.js: per-user, device-local,
// broadcast through a listener set so any mounted board reacts instantly.
// When ON, boards may tick the device on the MoveEffect timeline (sound and
// visuals are unaffected). Devices/browsers without the Vibration API simply
// do nothing — the toggle stays harmless.

import { useEffect, useState } from 'react';

export const DEFAULT_HAPTICS = true;

export const DEFAULT_HAPTIC_STRENGTH = 'strong';

/* Duration multiplier — the Vibration API has no amplitude channel, so
   strength is expressed as how long each pulse stays on. */
export const HAPTIC_STRENGTHS = [
  { id: 'soft', label: 'Soft', scale: 0.5 },
  { id: 'normal', label: 'Normal', scale: 0.75 },
  { id: 'strong', label: 'Strong', scale: 1 },
];

const STORAGE_PREFIX = 'knightpath-haptics';

function currentUserId() {
  try {
    const raw = localStorage.getItem('user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u && (u.id || u.user_id)) return String(u.id || u.user_id);
    }
  } catch {
    /* ignore */
  }
  return 'guest';
}

function storageKey() {
  return `${STORAGE_PREFIX}:${currentUserId()}`;
}

function strengthStorageKey() {
  return `${STORAGE_PREFIX}:strength:${currentUserId()}`;
}

export function isHapticsSupported() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  } catch {
    return false;
  }
}

export function getHaptics() {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    /* ignore */
  }
  return DEFAULT_HAPTICS;
}

const listeners = new Set();

export function setHaptics(next) {
  const value = next === true;
  try {
    localStorage.setItem(storageKey(), value ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (!value) {
    try { navigator.vibrate?.(0); } catch { /* ignore */ }
  }
  for (const fn of listeners) {
    try { fn(value); } catch { /* ignore */ }
  }
  return value;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useHaptics() {
  const [value, setValue] = useState(getHaptics);
  useEffect(() => subscribe(setValue), []);
  return value;
}

export function getHapticStrength() {
  try {
    const stored = localStorage.getItem(strengthStorageKey());
    if (HAPTIC_STRENGTHS.some((s) => s.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_HAPTIC_STRENGTH;
}

export function setHapticStrength(next) {
  const value = HAPTIC_STRENGTHS.some((s) => s.id === next)
    ? next
    : DEFAULT_HAPTIC_STRENGTH;
  try {
    localStorage.setItem(strengthStorageKey(), value);
  } catch {
    /* ignore */
  }
  return value;
}

export function hapticStrengthScale(id = getHapticStrength()) {
  return HAPTIC_STRENGTHS.find((s) => s.id === id)?.scale ?? 1;
}

export function useHapticStrength() {
  const [value, setValue] = useState(getHapticStrength);
  const update = (next) => setValue(setHapticStrength(next));
  return [value, update];
}
