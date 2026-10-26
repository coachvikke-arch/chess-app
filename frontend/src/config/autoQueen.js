// Single source of truth for the "Auto-queen" promotion preference.
//
// When ON, a pawn reaching the last rank is promoted to a Queen immediately and
// the board popup picker never opens. When OFF (the default) the player chooses
// the piece. This only affects the INPUT side of a promotion: move validation,
// capture-promotions, the promotion FX and the underlying game state are all
// unchanged — an auto-queened move is applied through the exact same path as a
// picked one, just with 'q' supplied instead of waiting for a click.
//
// Storage and fan-out mirror config/pieceDrag.js and config/legalMoves.js: the
// choice is kept per user (device-local) and broadcast through a listener set so
// every mounted board reacts instantly, no reload.

import { useEffect, useState } from 'react';

export const DEFAULT_AUTO_QUEEN = false;

const STORAGE_PREFIX = 'knightpath-auto-queen';

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

export function getAutoQueen() {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    /* ignore */
  }
  return DEFAULT_AUTO_QUEEN;
}

const listeners = new Set();

export function setAutoQueen(next) {
  const value = next === true; // explicit true turns it on; anything else is off
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

export function useAutoQueen() {
  const [value, setValue] = useState(getAutoQueen);
  useEffect(() => subscribe(setValue), []);
  return value;
}
