import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { useLiveClass } from './LiveClassContext';
import { useToast } from '../components/Toast';
import { emit, on } from '../services/socket';
import { ROOT_ID, buildMainline, hydrateTree } from '../utils/variationTree';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const ClassroomVariationContext = createContext(null);

/* The class game's mainline, rebuilt from the PGN the server broadcasts. A
 * custom starting position travels as a [FEN] header, so the tree's root is the
 * position the line was actually played from — move numbers, and every branch's
 * legality, depend on it. */
function startFenOf(pgn, serverBaseFen, liveFen) {
  const text = String(pgn || '');
  const header = /\[FEN\s+"([^"]+)"\]/.exec(text);
  if (header) return header[1];
  if (serverBaseFen) return serverBaseFen;
  /* No PGN yet: the board's own FEN IS the starting position (a class that was
     set up on an empty board and has not moved). Once there are moves the PGN
     carries them, so this fallback must not track `liveFen` or the base would
     shift under the tree on every move. */
  return text.trim() ? START_FEN : (liveFen || START_FEN);
}

/* The classroom's tree is owned by the SERVER: every member sees the same
 * branches, and the coach's pointer is the room's pointer. This provider is the
 * bridge between that snapshot and the shared VariationMoveList / board:
 *
 *  - the mainline comes from the live PGN, so it grows with the class game;
 *  - branches and the room pointer come from `variation_updated` snapshots;
 *  - a viewer may step back privately (localViewId) without moving the class,
 *    but the coach's pointer always wins on the next update;
 *  - branching is routed through `variation_move`, never through a local tree,
 *    so two students cannot invent conflicting nodes.
 */
export function ClassroomVariationProvider({ children }) {
  const { classMeta, isInstructor, chessState, variation, baseFen } = useLiveClass();
  const { showToast } = useToast();
  const classId = classMeta?.id;

  const [live, setLive] = useState(() => ({
    pgn: chessState?.pgn || '',
    fen: chessState?.fen || START_FEN,
  }));

  /* The context snapshot is only replaced on (re)join; live moves arrive on
     `chess_state_updated`, the same event the board and the old move list read. */
  const chessPgn = chessState?.pgn || '';
  const chessFen = chessState?.fen || '';
  useEffect(() => {
    setLive((prev) => (prev.pgn === chessPgn && prev.fen === chessFen
      ? prev
      : { pgn: chessPgn, fen: chessFen }));
  }, [chessPgn, chessFen]);

  useEffect(() => {
    const off = on('chess_state_updated', (state) => {
      if (!state?.fen) return;
      setLive({ pgn: state.pgn || '', fen: state.fen });
    });
    return off;
  }, []);

  const mainline = useMemo(() => {
    const pgn = String(live.pgn || '').trim();
    const startFen = startFenOf(pgn, baseFen, live.fen);
    const san = [];
    if (pgn) {
      try {
        const g = new Chess();
        g.loadPgn(pgn, { strict: false });
        san.push(...g.history());
      } catch { /* a malformed PGN leaves the previous tree in place below */ }
    }
    return { startFen, san };
  }, [live.pgn, live.fen, baseFen]);

  const base = useMemo(
    () => buildMainline(mainline.startFen, mainline.san),
    [mainline],
  );

  /* Attach the server's saved branches to the freshly replayed mainline. A
     branch whose parent is gone (undo, a replaced game) is dropped there, never
     re-parented — hydrateTree is the same guard the local surfaces use. */
  const serverState = useMemo(() => hydrateTree(variation, base), [variation, base]);

  const liveId = base.ids[base.ids.length - 1] || ROOT_ID;
  const roomId = serverState.pointer;

  /* A private step-back. Cleared whenever the room pointer moves, so the class
     converges on the coach again and a branch created by someone else never
     leaves this viewer stranded on a position the room has left. */
  const [localViewId, setLocalViewId] = useState(null);
  const prevPointerRef = useRef(variation?.pointer ?? null);
  const prevSeqRef = useRef(Number(variation?.seq) || 0);
  useEffect(() => {
    const pointer = variation?.pointer ?? null;
    if (pointer !== prevPointerRef.current) {
      prevPointerRef.current = pointer;
      setLocalViewId(null);
    }
    const seq = Number(variation?.seq) || 0;
    if (seq < prevSeqRef.current) setLocalViewId(null); // the tree was reset
    prevSeqRef.current = seq;
  }, [variation?.pointer, variation?.seq]);

  const viewId = localViewId && serverState.nodes[localViewId] ? localViewId : roomId;
  const current = serverState.nodes[viewId] || serverState.nodes[ROOT_ID];
  const isLive = viewId === liveId;
  const mode = variation?.mode === 'free' ? 'free' : 'follow';
  const variationCount = useMemo(
    () => Object.values(serverState.nodes).filter((n) => n && !n.isMainline).length,
    [serverState.nodes],
  );
  const canBranch = isInstructor || (mode === 'free' && classMeta?.status === 'live');

  const roomPointer = variation?.pointer ?? null;

  const announce = useCallback((pointer) => {
    if (!isInstructor || !classId) return;
    emit('variation_pointer', { classId, pointer }, (res) => {
      if (res && res.ok === false) {
        setLocalViewId(null);
        showToast(res.error || 'Could not move the class line', { title: 'Variations' });
      }
    });
  }, [isInstructor, classId, showToast]);

  const goTo = useCallback((id) => {
    const wanted = id && serverState.nodes[id] ? id : null;
    if (!wanted) return;
    if (wanted === roomId) {
      setLocalViewId(null);
      return;
    }
    /* Optimistic for the split second before the server echo, and the only
       navigation a student gets — their look is private, the class stays put. */
    setLocalViewId(wanted);
    if (isInstructor) announce(wanted === liveId ? null : wanted);
  }, [serverState.nodes, roomId, isInstructor, announce, liveId]);

  const goLive = useCallback(() => {
    /* The coach returns the whole room. A student cannot move the room, so
       their way back is a PRIVATE jump to the live end of the original line —
       otherwise, with the pointer already on a variation, their click would
       resolve to that same variation and appear to do nothing. */
    if (isInstructor) {
      setLocalViewId(null);
      if (roomPointer != null) announce(null);
      return;
    }
    setLocalViewId(liveId === roomId ? null : liveId);
  }, [isInstructor, roomPointer, announce, liveId, roomId]);

  const step = useCallback((delta) => {
    const node = serverState.nodes[viewId] || serverState.nodes[ROOT_ID];
    if (delta < 0 && node.parentId) goTo(node.parentId);
    else if (delta > 0 && node.children.length) goTo(node.children[0]);
  }, [serverState.nodes, viewId, goTo]);

  /* Both sides of a branch point — the vertical arrows, as in the other
     surfaces. Navigating a sibling is still only a pointer move. */
  const sibling = useCallback((delta) => {
    const node = serverState.nodes[viewId] || serverState.nodes[ROOT_ID];
    const parent = node && serverState.nodes[node.parentId];
    if (!parent) return;
    const idx = parent.children.indexOf(node.id) + delta;
    if (idx < 0 || idx >= parent.children.length) return;
    goTo(parent.children[idx]);
  }, [serverState.nodes, viewId, goTo]);

  const goStart = useCallback(() => goTo(ROOT_ID), [goTo]);
  const goEnd = useCallback(() => goTo(liveId), [goTo, liveId]);

  const playMove = useCallback((move, atId) => {
    if (!classId || !move || !move.from || !move.to) return;
    emit('variation_move', {
      classId,
      from: move.from,
      to: move.to,
      promotion: move.promotion || undefined,
      atId: atId || undefined,
    }, (res) => {
      if (!res || res.ok === false) {
        showToast((res && res.error) || 'Could not play that move', { title: 'Variations' });
        return;
      }
      const target = res.navigateTo || (res.node && res.node.id);
      if (target) setLocalViewId(target);
    });
  }, [classId, showToast]);

  const setMode = useCallback((next) => {
    if (!isInstructor || !classId) return;
    if (next !== 'free' && next !== 'follow') return;
    emit('variation_mode', { classId, mode: next }, (res) => {
      if (res && res.ok === false) {
        showToast(res.error || 'Could not change analysis mode', { title: 'Variations' });
      }
    });
  }, [isInstructor, classId, showToast]);

  const toggleMode = useCallback(
    () => setMode(mode === 'free' ? 'follow' : 'free'),
    [mode, setMode],
  );

  const resetVariations = useCallback(() => {
    if (!isInstructor || !classId) return;
    if (!window.confirm('Return everyone to the original line? Every variation in this class will be removed.')) return;
    emit('variation_reset', { classId }, (res) => {
      if (res && res.ok === false) {
        showToast(res.error || 'Could not reset the line', { title: 'Variations' });
      } else {
        setLocalViewId(null);
      }
    });
  }, [isInstructor, classId, showToast]);

  const tree = useMemo(() => ({
    nodes: serverState.nodes,
    root: serverState.nodes[ROOT_ID],
    pointer: viewId,
    displayIds: serverState.ids,
    promotedId: null,
    isOnMainline: Boolean(current && current.isMainline),
    hasVariations: variationCount > 0,
    variationCount,
    current,
    goTo,
    returnToMainline: goLive,
    resetVariations,
    /* The classroom offers one undo for the whole room ("Return to original"),
       never per-branch delete or a display-only promote. */
    deleteVariation: () => {},
    promoteVariation: () => {},
  }), [serverState, viewId, current, variationCount, goTo, goLive, resetVariations]);

  const viewLastMove = current && current.uci
    ? { from: current.uci.slice(0, 2), to: current.uci.slice(2, 4) }
    : null;

  const value = useMemo(() => ({
    tree,
    /* The live class PGN (the context's own `chessState` only carries the boot
       snapshot, so Copy / PGN in the moves tab must read this instead). */
    pgn: live.pgn || '',
    mode,
    isLive,
    viewId,
    liveId,
    viewFen: current ? current.fen : null,
    viewLastMove,
    isVariation: Boolean(current && !current.isMainline),
    canBranch,
    canPrev: Boolean(current && current.parentId),
    canNext: Boolean(current && current.children.length),
    step,
    sibling,
    goStart,
    goEnd,
    goTo,
    goLive,
    setMode,
    toggleMode,
    resetVariations,
    playMove,
    hasVariations: variationCount > 0,
    variationCount,
  }), [tree, live.pgn, mode, isLive, viewId, liveId, current, viewLastMove, canBranch,
    step, sibling, goStart, goEnd, goTo, goLive, setMode, toggleMode, resetVariations,
    playMove, variationCount]);

  return (
    <ClassroomVariationContext.Provider value={value}>
      {children}
    </ClassroomVariationContext.Provider>
  );
}

export function useClassroomVariations() {
  const ctx = useContext(ClassroomVariationContext);
  if (!ctx) throw new Error('useClassroomVariations must be used within a ClassroomVariationProvider');
  return ctx;
}

export default ClassroomVariationContext;
