// Single source of truth for the "Drag Pieces" preference.
//
// Game boards are click-to-move by default (drag off). This switch lets a user
// re-enable dragging over the whole app from Settings. The setting only affects
// the input gesture: move validation, lock rules, promotion, the setup board and
// click-to-move all keep working regardless. Storage and fan-out mirror
// config/legalMoves.js and config/boardAnimation.js: the choice is kept per user
// (device-local) and broadcast through a listener set so every mounted board
// reacts instantly, no reload.

import { useEffect, useState } from 'react';

export const DEFAULT_ALLOW_PIECE_DRAG = false;

const STORAGE_PREFIX = 'knightpath-allow-piece-drag';

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

export function getAllowPieceDrag() {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    /* ignore */
  }
  return DEFAULT_ALLOW_PIECE_DRAG;
}

const listeners = new Set();

export function setAllowPieceDrag(next) {
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

export function useAllowPieceDrag() {
  const [value, setValue] = useState(getAllowPieceDrag);
  useEffect(() => subscribe(setValue), []);
  return value;
}
