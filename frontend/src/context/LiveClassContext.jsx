import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { dedupeParticipants } from '../utils/liveRoster';

const LiveClassContext = createContext(null);

export function LiveClassProvider({ children, boot }) {
  const [classMeta, setClassMeta] = useState(boot?.classMeta ?? null);
  const [isInstructor, setIsInstructor] = useState(!!boot?.isInstructor);
  const [permissions, setPermissions] = useState(boot?.permissions ?? {
    canControlBoard: false,
    canDrawAnnotations: false,
    canSendChat: true,
    canShareScreen: false,
    canModerate: false,
  });
  const [chessState, setChessState] = useState(boot?.chessState ?? {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '',
    currentTurn: 'w',
    lastMove: null,
    annotations: { arrows: [], highlights: [] },
    moves: [],
  });
  const [participants, setParticipants] = useState(boot?.participants ?? []);
  const [chat, setChat] = useState(boot?.chatMessages ?? []);
  const [privateChat, setPrivateChat] = useState(boot?.privateChat ?? []);
  const [connection, setConnection] = useState('connected');
  /* "Students may watch their classmates" — seeded from the join token (so a
     refresh keeps the coach's setting) and updated live by `spectate_toggled`. */
  const [spectateEnabled, setSpectateEnabled] = useState(boot?.classMeta?.spectateEnabled !== false);
  /* What THIS student's own game in the class is doing: null (none), 'playing'
     (still on the board) or 'finished'. Seeded from the join token for a
     refresh, then driven by the socket (`pvp-started` / `game-finished-in-class`
     / `spectate_closed`). The "Watch classmates" button appears only on
     'finished' and while `spectateEnabled` is true. */
  const [selfGameStatus, setSelfGameStatus] = useState(boot?.selfGameStatus ?? null);
  const [quizAsk, setQuizAsk] = useState(null); // { title, fen, solution } — puzzle to ask as a quiz
  /* Which move the board is LOOKING AT, for every viewer independently.
     `null` = the live position (after the last move); a number is the index of
     the move whose position is shown. It lives in the provider — not on the
     board — because the move list and the board are separate panes of the room
     and a click in one has to reach the other. It is deliberately NOT part of
     `chessState`: stepping through the game is a private review, it must never
     be broadcast, and a new live move must not pull a viewer off the ply they
     are studying. */
  const [viewIndex, setViewIndex] = useState(
    boot?.isInstructor && boot?.review && boot.review.to != null ? boot.review.to : null
  );

  /* A review the INSTRUCTOR is leading the room through, pushed by the server.
     Unlike `viewIndex` (private, this viewer only), this is the class board's
     position while the coach steps back: students and spectators follow it, and
     it is cleared by the next live move. `null` = no room-wide review. */
  const [remoteReview, setRemoteReview] = useState(boot?.review ?? null);

  const openQuizAsk = useCallback((puzzle) => setQuizAsk(puzzle), []);
  const closeQuizAsk = useCallback(() => setQuizAsk(null), []);
  const patchPermissions = useCallback((next) => {
    setPermissions((prev) => ({ ...prev, ...next }));
  }, []);

  const upsertParticipant = useCallback((p) => {
    setParticipants((prev) => {
      const idx = prev.findIndex((x) => x.userId === p.userId);
      if (idx === -1) return [...prev, p];
      const copy = prev.slice();
      copy[idx] = { ...copy[idx], ...p, status: 'active' };
      return copy;
    });
  }, []);

  const removeParticipant = useCallback((userId) => {
    setParticipants((prev) => prev.map((x) => (x.userId === userId ? { ...x, status: 'left' } : x)));
  }, []);

  /* ── Student activity (what each student is doing right now) ────────────
     Driven by `pvp-pairing` / `pvp-finished` from the online controller, which
     fire when the instructor pairs students or starts computer games. The
     Participants tab reads this to show "In game · #123" / "Finished • White
     wins" instead of a stale list. */
  const [activityByStudent, setActivityByStudent] = useState({});

  const setStudentActivity = useCallback((userId, info) => {
    setActivityByStudent((prev) => {
      const next = { ...prev };
      if (info == null) delete next[userId];
      else next[userId] = { ...(next[userId] || {}), ...info, at: Date.now() };
      return next;
    });
  }, []);

  const bulkSetActivity = useCallback((updater) => {
    setActivityByStudent((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);

  const clearStudentActivity = useCallback((userId) => {
    setActivityByStudent((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  /* The authoritative roster, straight from the server's `class:init`. Unlike
     the join/leave deltas, this REPLACES the list rather than patching it - so
     a client that missed an event, or that booted before a socket joined, still
     converges on the true room. Deduped by userId because a refresh can briefly
     land the HTTP snapshot and the socket roster together. */
  const replaceParticipants = useCallback((list) => {
    setParticipants(dedupeParticipants(list));
  }, []);

  const appendChat = useCallback((msg) => {
    setChat((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);
  const appendPrivateChat = useCallback((msg) => {
    if (!msg) return;
    setPrivateChat((prev) => {
      /* A server echo that carries the client id of an optimistic message
         REPLACES it in place (pending → confirmed) so the sender never sees the
         same message twice, in either direction of the conversation. */
      if (msg.clientId) {
        const i = prev.findIndex((m) => m.clientId === msg.clientId && (m.pending || m.failed));
        if (i !== -1) {
          const next = prev.slice();
          next[i] = { ...msg, pending: false, failed: false };
          return next;
        }
      }
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const value = useMemo(
    () => ({
      classMeta,
      isInstructor,
      permissions,
      chessState,
      participants,
      chat,
      privateChat,
      connection,
      quizAsk,
      openQuizAsk,
      closeQuizAsk,
      viewIndex,
      remoteReview,
      setClassMeta,
      setIsInstructor,
      patchPermissions,
      setChessState,
      setParticipants,
      setChat,
      setPrivateChat,
      setViewIndex,
      setRemoteReview,
      upsertParticipant,
      removeParticipant,
      replaceParticipants,
      activityByStudent,
      setStudentActivity,
      bulkSetActivity,
      clearStudentActivity,
      appendChat,
      appendPrivateChat,
      setConnection,
      spectateEnabled,
      setSpectateEnabled,
      selfGameStatus,
      setSelfGameStatus,
    }),
    [classMeta, isInstructor, permissions, chessState, participants, chat, privateChat, connection,
     quizAsk, openQuizAsk, closeQuizAsk, viewIndex, remoteReview,
     patchPermissions, upsertParticipant, removeParticipant, replaceParticipants, appendChat, appendPrivateChat,
     activityByStudent, bulkSetActivity, spectateEnabled, selfGameStatus]
  );

  return <LiveClassContext.Provider value={value}>{children}</LiveClassContext.Provider>;
}

export function useLiveClass() {
  const ctx = useContext(LiveClassContext);
  if (!ctx) throw new Error('useLiveClass must be used within a LiveClassProvider');
  return ctx;
}

export default LiveClassContext;
