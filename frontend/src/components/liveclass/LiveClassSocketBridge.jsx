import { useEffect } from 'react';
import { useLiveClass } from '../../context/LiveClassContext';
import { getSocket, joinLiveClass, on } from '../../services/socket';
import { normalizeRoster } from '../../utils/liveRoster';

/**
 * Owns the live-class socket join, and the roster that the server sends back
 * with it.
 *
 * Previously the join was fired from LiveClassroom's boot effect and the
 * `class:init` snapshot it triggers was never read - the participant list was
 * seeded only from the HTTP boot and then patched by join/leave deltas. On a
 * refresh the HTTP snapshot is taken before the new socket has joined, so the
 * room looked empty ("0 in class") until people moved. This bridge fixes that
 * order of operations:
 *
 *  1. the `class:init` listener is attached BEFORE the join is emitted, so the
 *     reply cannot race past it;
 *  2. `class:init` REPLACES the participant list from the server's roster;
 *  3. the join is (re)sent on every socket `connect`, so a reconnect re-syncs
 *     the room instead of leaving a stale list on screen.
 *
 * Renders nothing.
 */
export default function LiveClassSocketBridge({ classId, onSocketError }) {
  const { replaceParticipants, setConnection, setRemoteReview, setViewIndex, isInstructor, setSpectateEnabled, setSelfGameStatus } = useLiveClass();

  useEffect(() => {
    if (!classId) return undefined;
    const s = getSocket();
    if (!s) return undefined;

    const handleInit = (payload) => {
      if (payload?.classId != null && Number(payload.classId) !== Number(classId)) return;
      replaceParticipants(normalizeRoster(payload?.roster));
      /* Rejoining mid-review: put the room-wide review (and, for the instructor
         who leads it, their own step-back) back on screen. */
      const review = payload?.review && payload.review.fen && payload.review.to != null
        ? payload.review
        : null;
      setRemoteReview(review);
      if (isInstructor) setViewIndex(review ? review.to : null);
    };

    const handleConnect = () => {
      setConnection('connected');
      joinLiveClass(classId, (ack) => {
        if (ack && ack.ok === false && onSocketError) {
          onSocketError(ack.error || 'Could not join the live room over socket.');
        }
      });
    };
    const handleDisconnect = () => setConnection('reconnecting');
    const handleReconnectAttempt = () => setConnection('reconnecting');

    /* Order matters: the reply to the join below is delivered only to this
       socket, so every listener it depends on is attached first. */
    const offInit = on('class:init', handleInit);
    s.on('connect', handleConnect);
    s.on('disconnect', handleDisconnect);
    s.io.on('reconnect_attempt', handleReconnectAttempt);

    /* Join now, not only on `connect`: getSocket() often hands back a socket
       that is ALREADY connected (it is a shared singleton), in which case no
       fresh `connect` event will fire for this mount. If it is still dialing,
       socket.io buffers the emit until the connection is up. */
    joinLiveClass(classId, (ack) => {
      if (ack && ack.ok === false && onSocketError) {
        onSocketError(ack.error || 'Could not join the live room over socket.');
      }
    });

    return () => {
      offInit();
      s.off('connect', handleConnect);
      s.off('disconnect', handleDisconnect);
      s.io.off('reconnect_attempt', handleReconnectAttempt);
    };
    /* onSocketError is a state setter from the parent and stable in practice;
       classId/replaceParticipants/setConnection are stable from context. */
  }, [classId, replaceParticipants, setConnection, setRemoteReview, setViewIndex, isInstructor, onSocketError]);

  /* "Watch classmates" state, fed straight from the classroom's own game
     lifecycle events. Kept in a separate effect so the join/roster effect above
     keeps its tight dependency list. */
  useEffect(() => {
    if (!classId) return undefined;
    /* A pairing (student-vs-student or student-vs-bot) puts this student back on
       a board, so they may no longer watch others. */
    const offStarted = on('pvp-started', (payload) => {
      if (Number(payload?.classId) !== Number(classId)) return;
      setSelfGameStatus('playing');
    });
    /* The server pings the finishing student's own board so the button appears
       the moment their game ends, without polling. */
    const offFinished = on('game-finished-in-class', (payload) => {
      if (Number(payload?.classId) !== Number(classId)) return;
      setSelfGameStatus('finished');
    });
    /* A new round was started for this student → never keep watching. */
    const offClosed = on('spectate_closed', (payload) => {
      if (Number(payload?.classId) !== Number(classId)) return;
      setSelfGameStatus('playing');
    });
    /* Instructor toggled the class switch; mirror it for everyone. */
    const offToggled = on('spectate_toggled', (payload) => {
      if (Number(payload?.classId) !== Number(classId)) return;
      setSpectateEnabled(payload?.enabled !== false);
    });
    return () => {
      offStarted();
      offFinished();
      offClosed();
      offToggled();
    };
  }, [classId, setSpectateEnabled, setSelfGameStatus]);

  return null;
}
