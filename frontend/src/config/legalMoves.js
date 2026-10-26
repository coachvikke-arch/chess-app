// Single source of truth for the app-wide "Show Legal Moves" preference.
//
// It controls the visual hint only: the dot on a quiet destination square and
// the ring on a capture. Turning it off hides every hint on every board (the
// click-selected targets AND the in-flight drag targets) without touching move
// validation or click/drag-to-move — ChessBoard ANDs this with each board's own
// `showLegalMoves` prop, so a board that opts out stays out.
//
// Storage and fan-out mirror config/boardAnimation.js: the choice is kept per
// user (device-local) and broadcast through a listener set so every mounted
// board reacts instantly, no reload.

import { useEffect, useState } from 'react';

export const DEFAULT_SHOW_LEGAL_MOVES = true;

const STORAGE_PREFIX = 'knightpath-show-legal-moves';

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

export function getShowLegalMoves() {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    /* ignore */
  }
  return DEFAULT_SHOW_LEGAL_MOVES;
}

const listeners = new Set();

export function setShowLegalMoves(next) {
  const value = next !== false; // explicit false turns it off; anything else is on
  try {
    localStorage.setItem(storageKey(), value ? '1' : '0');
  } catch {
    /* ignore */
  }
  for (const fn of listeners) {
    try {
      fn(value);
    } catch {
      /* ignore */
    }
  }
  return value;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useShowLegalMoves() {
  const [value, setValue] = useState(getShowLegalMoves);
  useEffect(() => subscribe(setValue), []);
  return value;
}
