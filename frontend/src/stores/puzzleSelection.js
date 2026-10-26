import { useSyncExternalStore } from 'react';

export const MAX_SELECT = 100;

let selection = new Set();
const listeners = new Set();

function emit() {
  for (const l of listeners) l();
}

function getSnapshot() {
  return selection;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live, shared selection Set for the Puzzle Library. Survives route changes and remounts. */
export function usePuzzleSelection() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Toggle one puzzle in the shared selection. Respects MAX_SELECT when adding. */
export function togglePuzzle(id) {
  if (selection.has(id)) {
    const next = new Set(selection);
    next.delete(id);
    selection = next;
    emit();
    return 'removed';
  }
  if (selection.size >= MAX_SELECT) return 'limit';
  const next = new Set(selection);
  next.add(id);
  selection = next;
  emit();
  return 'added';
}

/**
 * Add as many of `ids` as the cap allows (already-selected ones are skipped).
 * Returns how many got added and how many were blocked by the 100 limit.
 */
export function addPuzzles(ids) {
  const next = new Set(selection);
  let added = 0;
  let blocked = 0;
  for (const id of ids) {
    if (next.has(id)) continue;
    if (next.size >= MAX_SELECT) {
      blocked++;
      continue;
    }
    next.add(id);
    added++;
  }
  selection = next;
  emit();
  return { added, blocked };
}

export function deselectAll() {
  if (selection.size === 0) return;
  selection = new Set();
  emit();
}

export function clearSelection() {
  deselectAll();
}