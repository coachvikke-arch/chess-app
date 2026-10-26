// Single source of truth for how pieces move on every board. The presets, the
// stored choice and the resolved timing all live here so a game replay, a puzzle
// solve and the live classroom board animate identically.

import { useEffect, useState } from 'react';

export const BOARD_ANIMATION_PRESETS = {
  glide: {
    id: 'glide',
    name: 'Glide',
    description: 'Smooth, swift slide',
    duration: 450,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  spring: {
    id: 'spring',
    name: 'Spring',
    description: 'Lively, slight overshoot',
    duration: 620,
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  snap: {
    id: 'snap',
    name: 'Snap',
    description: 'Near-instant',
    duration: 120,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  off: {
    id: 'off',
    name: 'Off',
    description: 'No animation',
    duration: 0,
    easing: 'linear',
  },
};

export const DEFAULT_BOARD_ANIMATION = 'glide';

const STORAGE_PREFIX = 'knightpath-board-animation';

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

export function getBoardAnimationId() {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored && BOARD_ANIMATION_PRESETS[stored]) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_BOARD_ANIMATION;
}

const listeners = new Set();

export function setBoardAnimation(id) {
  const next = BOARD_ANIMATION_PRESETS[id] ? id : DEFAULT_BOARD_ANIMATION;
  try {
    localStorage.setItem(storageKey(), next);
  } catch {
    /* ignore */
  }
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      /* ignore */
    }
  }
  return next;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function prefersReducedMotion() {
  try {
    return (
      typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

export function resolveBoardAnimation(id = getBoardAnimationId()) {
  const preset = BOARD_ANIMATION_PRESETS[id] || BOARD_ANIMATION_PRESETS[DEFAULT_BOARD_ANIMATION];
  if (preset.id === 'off' || prefersReducedMotion()) {
    return { id: preset.id, duration: 0, easing: 'linear', animate: false };
  }
  return { duration: preset.duration, easing: preset.easing, animate: true, id: preset.id };
}

export function useBoardAnimationId() {
  const [id, setId] = useState(getBoardAnimationId);
  useEffect(() => subscribe(setId), []);
  return id;
}
