import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ROOT_ID, VARIATION_STORAGE_PREFIX, applyRemoteNodeInTree, backInTree, branchPointOf,
  currentOf, deleteVariationInTree, displayIdsOf, endOfTree, forwardInTree, gradeNodeInTree,
  hydrateTree, initialPlyId, initialState, lineEndPly, lineOf, mergeMainline, movePointer,
  playMoveInTree, resetToMainline, serializeTree, siblingInTree, siblingsOf, startOfTree,
  toMainline, toMainlinePly, togglePromotionInTree, variationCountOf, buildMainline,
} from '../utils/variationTree';

export { ROOT_ID, VARIATION_STORAGE_PREFIX, serializeTree, hydrateTree, buildMainline };

/* React wrapper around the pure tree. It owns one committed state and rebuilds
 * the mainline when the game changes; branches, pointer and grades survive a
 * mainline that only GROWS (the live classroom). */
export default function useVariationTree(mainlineMoves, {
  initialFen = 'start',
  initialPly = 'end',
  storageKey = null,
  restorePointer = true,
  onLocalChange = null,
  /* A host that persists the tree itself (Game Review keeps it inside its
     per-user session) hands the saved snapshot in here instead of localStorage.
     Read once per mainline identity — the host clears it when it loads a new
     game. */
  loadSaved = null,
} = {}) {
  const moves = Array.isArray(mainlineMoves) ? mainlineMoves : [];
  const mainKey = `${initialFen}|${moves.join(' ')}`;
  const base = useMemo(
    () => buildMainline(initialFen, moves),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainKey],
  );
  const loadSavedRef = useRef(loadSaved);
  loadSavedRef.current = loadSaved;

  const [state, setState] = useState(() => {
    const fallback = initialPlyId(base, initialPly);
    let saved = loadSaved;
    if (!saved && storageKey) {
      try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* corrupt cache */ }
    }
    if (saved && Array.isArray(saved.nodes) && saved.nodes.length > 0) {
      /* A host that opens ON a specific move (a deep-linked ply) keeps that
         position; only the branches and grades are restored. */
      return hydrateTree(restorePointer ? saved : { ...saved, pointer: null }, base, fallback);
    }
    return initialState(base, fallback);
  });
  const stateRef = useRef(state);
  const onChangeRef = useRef(onLocalChange);
  onChangeRef.current = onLocalChange;
  /* Bumped by every commit, so a host that mirrors the tree into its own store
     (a saved session) can persist grades and branch edits too — neither changes
     any of its other state. */
  const [revision, setRevision] = useState(0);

  /* A commit is visible to the NEXT call in this tick, so a move followed by a
     navigation builds on it instead of both starting from the last render. */
  const commit = useCallback((next, meta) => {
    if (!next || next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    setRevision((n) => n + 1);
    if (onChangeRef.current) onChangeRef.current(next, meta || null);
  }, []);

  useEffect(() => {
    const prev = stateRef.current;
    const same = prev.ids.length === base.ids.length && prev.ids.every((id, i) => id === base.ids[i]);
    if (same) return;
    /* A tree that only ever had a root is an EMPTY game (the host mounted before
       its moves arrived), not a mainline to grow — merge would keep the pointer
       at the root and drop whatever the storage holds. */
    const merged = prev.ids.length > 1 ? mergeMainline(prev, base) : null;
    if (merged) { commit(merged, { type: 'mainline-grown' }); return; }
    let saved = loadSavedRef.current;
    if (!saved && storageKey) {
      try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* fall through */ }
    }
    if (saved && Array.isArray(saved.nodes) && saved.nodes.length > 0) {
      commit(hydrateTree(restorePointer ? saved : { ...saved, pointer: null }, base, initialPlyId(base, initialPly)), { type: 'game-loaded' });
      return;
    }
    commit(initialState(base, initialPlyId(base, initialPly)), { type: 'game-loaded' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainKey]);

  useEffect(() => {
    if (!storageKey) return undefined;
    /* A card opened before its game parsed has an empty mainline; saving then
       would overwrite the stored tree for this game with nothing. */
    if (!state.ids || state.ids.length < 2) return undefined;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(serializeTree(stateRef.current))); } catch { /* quota */ }
    }, 250);
    return () => window.clearTimeout(t);
  }, [state, storageKey]);

  const current = currentOf(state);
  const currentId = current.id;
  const line = useMemo(() => lineOf(state), [state]);
  const siblings = useMemo(() => siblingsOf(state), [state]);
  const branchPoint = useMemo(() => branchPointOf(state), [state]);
  const displayIds = useMemo(() => displayIdsOf(state), [state]);
  const variationCount = useMemo(() => variationCountOf(state), [state]);
  const endPly = useMemo(() => lineEndPly(state), [state]);

  /* `source` is how the surface that navigated names itself (keyboard, score
     sheet, board…), so the caller can play the matching move effect without
     re-deriving where the press came from. */
  const act = (fn) => (arg, source) => {
    const next = fn(stateRef.current, arg);
    if (next && next !== stateRef.current) {
      commit(next, { type: 'navigate', node: next.nodes[next.pointer], source: source || null });
      return true;
    }
    return false;
  };

  const playMove = useCallback((move, source = 'variation-board') => {
    const result = playMoveInTree(stateRef.current, move);
    if (result.illegal) return result;
    if (result.state !== stateRef.current) {
      commit(result.state, result.created
        ? { type: 'branch', node: result.node, parent: result.parent, source }
        : { type: 'navigate', node: result.node, source });
    }
    return result;
  }, [commit]);

  const setNodeGrade = useCallback((id, row) => {
    commit(gradeNodeInTree(stateRef.current, id, row), { type: 'grade', id });
  }, [commit]);

  const deleteVariation = useCallback((id) => {
    const next = deleteVariationInTree(stateRef.current, id);
    if (!next) return false;
    commit(next, { type: 'delete', id });
    return true;
  }, [commit]);

  const promoteVariation = useCallback((id) => {
    commit(togglePromotionInTree(stateRef.current, id), { type: 'promote', id });
  }, [commit]);

  const resetVariations = useCallback(() => {
    commit(resetToMainline(stateRef.current, base), { type: 'reset' });
  }, [base, commit]);

  const applySnapshot = useCallback((saved, pointer) => {
    if (!saved) return;
    const hydrated = hydrateTree(saved, base, pointer || null);
    commit(hydrated, { type: 'remote' });
  }, [base, commit]);

  const applyRemoteNode = useCallback((node, pointer) => {
    commit(applyRemoteNodeInTree(stateRef.current, node, pointer), { type: 'remote-node', node });
  }, [commit]);

  const goTo = useCallback((id, source) => {
    const next = movePointer(stateRef.current, id);
    if (next === stateRef.current) return false;
    commit(next, { type: 'navigate', node: next.nodes[next.pointer], source: source || null });
    return true;
  }, [commit]);

  return {
    nodes: state.nodes,
    root: state.nodes[ROOT_ID],
    mainlineIds: state.ids,
    displayIds,
    mainline: state.ids.map((id) => state.nodes[id]).filter(Boolean),
    current,
    currentId,
    currentFen: current.fen,
    currentPly: current.ply,
    currentLastMove: current.uci ? { from: current.from, to: current.to } : null,
    currentLine: line.map((id) => state.nodes[id]).filter(Boolean),
    nodeById: (id) => state.nodes[id] || null,
    lineEndPly: endPly,
    branchPoint,
    branchPly: branchPoint.ply,
    isOnMainline: current.isMainline,
    isAtStart: currentId === ROOT_ID,
    hasForward: current.children.length > 0,
    siblings,
    variationCount,
    hasVariations: variationCount > 0,
    promotedId: state.promotedId,
    seq: state.seq,
    pointer: state.pointer,
    revision,
    playMove,
    goTo,
    goBack: act(backInTree),
    goForward: act(forwardInTree),
    goToStart: act(startOfTree),
    goToEnd: act(endOfTree),
    goToMainlinePly: act(toMainlinePly),
    goSibling: act(siblingInTree),
    returnToMainline: act(toMainline),
    setPointer: goTo,
    setNodeGrade,
    deleteVariation,
    promoteVariation,
    resetVariations,
    applySnapshot,
    applyRemoteNode,
    serialize: () => serializeTree(stateRef.current),
  };
}
