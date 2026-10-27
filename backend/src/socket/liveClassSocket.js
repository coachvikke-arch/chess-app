const db = require('../config/database');
const { Chess } = require('chess.js');
const { userIsMemberOfClass } = require('../services/liveClassAccess');
const { canSpectateGame } = require('../services/spectateAccess');
const { notifyStudentUserIds } = require('../controllers/classController');
const notificationService = require('../services/notificationService');
const rt = require('../services/tournamentRealtime');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* Did this user already finish their own game in the class? Mirrors the HTTP
   helper in onlineController so the "join a classmate's board" socket gate and
   the REST spectator gate agree. Any still-active own game means unfinished. */
async function ownClassGameFinished(classId, userId) {
  try {
    const r = await db.query(
      `SELECT status FROM online_games
       WHERE class_id = $1 AND (admin_id = $2 OR student_id = $2)
         AND status IN ('active', 'finished')`,
      [classId, userId]
    );
    return r.rows.length > 0 && r.rows.every((row) => row.status === 'finished');
  } catch (e) {
    return false;
  }
}

const classCache = new Map();

const CLASS_CACHE_TTL_MS = 2 * 60 * 1000;

/* One canonical key per class. Socket payloads are not consistent about the
   type: `join-live-class` receives the id from the route (a STRING), while
   `chess_move` / `chess_control` send `classMeta.id` (a NUMBER). Keying the map
   by the raw value therefore produced TWO entries — and two independent
   `Chess` instances — for the same class. Moves were applied to one while a
   joiner was handed the other (empty) game, so a refresh, a reconnect or a late
   join rewound the room to the starting position. Everything that keys per
   class must go through here. */
function classCacheKey(classId) {
  return String(classId);
}

/* Serializes annotation read-modify-write cycles per class so concurrent
   board_annotation events (rapid or burst arrow draws) never lose updates. */
const annotationQueues = new Map();
function runAnnotationMutation(classId, fn) {
  const key = classCacheKey(classId);
  const prev = annotationQueues.get(key) || Promise.resolve();
  const run = Promise.resolve().then(fn);
  annotationQueues.set(key, run.then(() => {}, () => {}));
  return run;
}

function getClassCacheEntry(classId) {
  const key = classCacheKey(classId);
  let entry = classCache.get(key);
  if (!entry) {
    entry = {
      chess: null,
      chessInit: null,
      classRow: null,
      classRowFetchedAt: 0,
      redoStack: [],
      /* Board revision: bumped by EVERY mutation (move, undo, redo, reset,
         load, clear) so clients can order snapshots and echoes even when they
         arrive out of order, and can drop a replayed/stale one. `epoch`
         changes whenever this process re-creates the class entry, so a server
         restart cannot make a fresh state look older than the old one. */
      rev: 0,
      epoch: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    };
    classCache.set(key, entry);
  }
  return entry;
}

/** Marks a new authoritative board state; returns the new revision. */
function nextBoardRevision(entry) {
  entry.rev = (entry.rev || 0) + 1;
  return entry.rev;
}

async function getClassRowCached(classId) {
  const entry = getClassCacheEntry(classId);
  const now = Date.now();
  if (!entry.classRow || now - entry.classRowFetchedAt > CLASS_CACHE_TTL_MS) {
    const res = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    entry.classRow = res.rows[0] || null;
    entry.classRowFetchedAt = now;
  }
  return entry.classRow;
}

async function getOrInitChess(classId) {
  const entry = getClassCacheEntry(classId);
  if (entry.chess) return entry.chess;
  /* Concurrent first touches (two people joining at once, or a join racing a
     move) must share ONE instance. Without this both callers see `chess: null`,
     each builds its own game from the same DB row, and the loser's future
     snapshots/broadcasts describe a board nobody else is playing on. */
  if (!entry.chessInit) {
    entry.chessInit = (async () => {
      const chess = new Chess();
      const stateRes = await db.query(
        'SELECT fen, pgn FROM chess_game_states WHERE live_class_id = $1',
        [classId]
      );

      if (stateRes.rows.length > 0) {
        const row = stateRes.rows[0];
        try {
          if (row.pgn && row.pgn.trim().length > 0) {
            chess.loadPgn(row.pgn);
          } else if (row.fen) {
            chess.load(row.fen);
          }
        } catch (e) {
          chess.load(START_FEN);
        }
      } else {
        chess.load(START_FEN);
      }

      entry.chess = chess;
      return chess;
    })().finally(() => {
      entry.chessInit = null;
    });
  }
  return entry.chessInit;
}

async function persistChessState(classId, chess, lastMove) {
  const fen = chess.fen();
  const pgn = chess.pgn();
  const turn = chess.turn() === 'w' ? 'w' : 'b';
  const lastMoveJson = lastMove ? JSON.stringify(lastMove) : null;

  await db.query(
    `INSERT INTO chess_game_states (live_class_id, fen, pgn, current_turn, last_move, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (live_class_id) DO UPDATE SET
       fen = EXCLUDED.fen,
       pgn = EXCLUDED.pgn,
       current_turn = EXCLUDED.current_turn,
       last_move = EXCLUDED.last_move,
       updated_at = NOW()`,
    [classId, fen, pgn, turn, lastMoveJson]
  );

  return { fen, pgn, turn, lastMove };
}

async function fetchMemberUserIds(classRow) {
  return await notifyStudentUserIds(classRow.id, classRow.group_id);
}

/* `moves`/`ply` describe the position; `rev`/`epoch` order it. A snapshot taken
 * at join can reach the client after a newer live move (React commits them
 * independently), and an older snapshot must never rewind the board. Receiving
 * `entry` stamps the broadcast with the class's current revision — a snapshot
 * does NOT bump it, only a mutation does. */
function buildChessStateBroadcast(chess, lastMove, moveNumber, entry) {
  const moves = chess.history();
  return {
    fen: chess.fen(),
    pgn: chess.pgn(),
    turn: chess.turn() === 'w' ? 'w' : 'b',
    lastMove: lastMove || null,
    moveNumber: moveNumber || Math.ceil(moves.length / 2),
    moves,
    ply: moves.length,
    ...(entry ? { rev: entry.rev || 0, epoch: entry.epoch } : {}),
  };
}

/* A move-history rewind the instructor is leading the room through. It is
 * derived from a CLONE of the live game, so the authoritative `chess` — which
 * every later move, undo and broadcast reads — is never rewound. `to` is the
 * index of the move whose position the room should be shown; `null` means the
 * live position (after the last move), and `-1` means BEFORE the first move —
 * the starting position. */
function buildReviewBroadcast(chess, to) {
  const fullPgn = chess.pgn();
  if (to == null) return { to: null, fen: chess.fen(), lastMove: null };
  const view = new Chess();
  try {
    if (fullPgn && fullPgn.trim()) view.loadPgn(fullPgn, { strict: false });
    else view.load(chess.fen());
  } catch (_) {
    return { to: null, fen: chess.fen(), lastMove: null };
  }
  const total = view.history().length;
  /* `-1` is the starting position (before the first move) and is always
     showable; any other out-of-range value falls back to the live position. */
  if (!Number.isFinite(to) || to < -1 || to >= total) {
    return { to: null, fen: chess.fen(), lastMove: null };
  }
  while (view.history().length > to + 1) view.undo();
  const history = view.history({ verbose: true });
  const last = history[history.length - 1];
  return {
    to,
    fen: view.fen(),
    lastMove: last ? { from: last.from, to: last.to, san: last.san } : null,
  };
}

/* Presence announcements are broadcast to everyone else in the room, so they
 * are de-duplicated here rather than in each client.
 *
 * `join-live-class` is not a one-shot event. It is re-emitted by a page refresh,
 * by socket.io reconnecting after a blip, by a double-click, and by React 18's
 * StrictMode, which mounts -> unmounts -> remounts every component in dev. That
 * last one produces join -> leave -> join in a few milliseconds, which looks
 * exactly like a student walking out and straight back in.
 *
 * Announcing on each of those told the coach "X joined" two or three times for
 * one arrival, and the paired `participant_left` made the roster flicker. Both
 * events therefore share one short window per person: inside it we treat the
 * person as still settling in, so the flap is absorbed silently. A genuine
 * departure or return seconds later is unaffected.
 *
 * This is deliberately time-based rather than "was the row already active":
 * leave-live-class sets the row to 'left', so a status check alone cannot tell
 * a rejoin from a real arrival. */
const PRESENCE_ANNOUNCE_WINDOW_MS = 2000;
const lastPresenceBroadcast = new Map();

function presenceKey(classId, userId) {
  return `${classId}:${userId}`;
}

/** True when the caller may broadcast, and records that it did. */
function claimPresenceBroadcast(classId, userId) {
  const key = presenceKey(classId, userId);
  const now = Date.now();
  const last = lastPresenceBroadcast.get(key);
  if (last != null && now - last < PRESENCE_ANNOUNCE_WINDOW_MS) return false;
  lastPresenceBroadcast.set(key, now);
  return true;
}

/* Keeps the dedupe map from growing for the lifetime of the process. */
setInterval(() => {
  const cutoff = Date.now() - PRESENCE_ANNOUNCE_WINDOW_MS * 10;
  for (const [key, at] of lastPresenceBroadcast) {
    if (at < cutoff) lastPresenceBroadcast.delete(key);
  }
}, PRESENCE_ANNOUNCE_WINDOW_MS * 10).unref();

/* The `participant:joined` toast opt-in fires once per genuine arrival. It is a
 * longer window than the roster flap above because the two answer different
 * questions: the roster only needs the millisecond remount to stay silent,
 * whereas a toast is a user-visible interruption that must not resurface when a
 * student refreshes the page or drops Wi-Fi and reconnects a few seconds later.
 * Reconnects and refreshes inside this window are the SAME arrival to the human
 * watching the room, so they are absorbed. A student who really leaves and comes
 * back after the window is announced again. */
const JOIN_NOTIFY_WINDOW_MS = 30000;
const lastJoinNotify = new Map();

/** True when the caller may announce the arrival as a toast, and records it. */
function claimJoinNotify(classId, userId) {
  const key = presenceKey(classId, userId);
  const now = Date.now();
  const last = lastJoinNotify.get(key);
  if (last != null && now - last < JOIN_NOTIFY_WINDOW_MS) return false;
  lastJoinNotify.set(key, now);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - JOIN_NOTIFY_WINDOW_MS * 2;
  for (const [key, at] of lastJoinNotify) {
    if (at < cutoff) lastJoinNotify.delete(key);
  }
}, JOIN_NOTIFY_WINDOW_MS).unref();

/* ── Presence: connection-counted, grace-delayed removal ────────────────────
 * A refresh tears the old socket down and brings a new one up a moment later,
 * and a reconnect does the same. Treating either as a departure made the room
 * flicker "left" then "joined", and — worse — the HTTP join-token snapshot,
 * taken before the new socket had joined, came back empty so the refresher saw
 * "0 in class". Presence is therefore keyed per user per class and counted by
 * live socket id: a user is present while at least one of their sockets is in
 * the room. The roster is only declared empty, and `participant_left` only
 * emitted, once the count has been zero for the whole grace window. A socket
 * that comes back inside that window cancels the pending removal. */
const PRESENCE_GRACE_MS = 5000;
const presenceByClass = new Map(); // classId(string) -> Map(userId -> { sockets:Set, timer })

function presenceMapFor(classId) {
  const key = String(classId);
  let m = presenceByClass.get(key);
  if (!m) {
    m = new Map();
    presenceByClass.set(key, m);
  }
  return m;
}

/** Record a socket as present. Returns true when this is the user's first one. */
function trackPresence(classId, userId, socketId) {
  const m = presenceMapFor(classId);
  let entry = m.get(userId);
  if (!entry) {
    entry = { sockets: new Set(), timer: null };
    m.set(userId, entry);
  }
  const firstConnection = entry.sockets.size === 0;
  entry.sockets.add(socketId);
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  return firstConnection;
}

/**
 * Drop a socket from presence. When the user's last socket goes, arm the grace
 * timer; `onVacated` runs only if nobody reconnected before it fires.
 */
function untrackPresence(classId, userId, socketId, onVacated) {
  const key = String(classId);
  const m = presenceByClass.get(key);
  const entry = m && m.get(userId);
  if (!entry) return;
  entry.sockets.delete(socketId);
  if (entry.sockets.size > 0) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    const current = presenceByClass.get(key);
    const still = current && current.get(userId);
    if (!still || still.sockets.size > 0) return; // someone came back
    current.delete(userId);
    if (current.size === 0) presenceByClass.delete(key);
    try {
      const pending = onVacated();
      if (pending && typeof pending.catch === 'function') {
        pending.catch((err) => console.error('[presence] vacate handler rejected', err));
      }
    } catch (err) {
      console.error('[presence] vacate handler failed', err);
    }
  }, PRESENCE_GRACE_MS);
  if (entry.timer.unref) entry.timer.unref();
}

/** Immediate removal, for a genuine kick — no grace, the coach asked for it. */
function forceVacate(classId, userId) {
  const key = String(classId);
  const m = presenceByClass.get(key);
  const entry = m && m.get(userId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  m.delete(userId);
  if (m.size === 0) presenceByClass.delete(key);
}

module.exports = function (io) {
  /* Tournament boards + scheduler (own events, own rooms). */
  require('./tournamentSocket')(io);

  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    const userRole = socket.user?.role;
    const userName = socket.user?.name;

    socket.on('join-live-class', async (classId, ack) => {
      try {
        if (classId == null) {
          if (ack) ack({ ok: false, error: 'classId required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized) {
          if (ack) ack({ ok: false, error: 'Not authorized' });
          return;
        }

        socket.join(`live-class:${classId}`);
        socket.data.liveClasses = socket.data.liveClasses || new Set();
        socket.data.liveClasses.add(String(classId));
        /* First socket for this user in this room = a real arrival; a second
           tab or a re-emit on the same socket is presence, not news. */
        const firstConnection = trackPresence(classId, userId, socket.id);

        await db.query(
          `INSERT INTO live_class_participants (live_class_id, user_id, role_in_class, status, joined_at, left_at)
           VALUES ($1, $2, $3, 'active', NOW(), NULL)
           ON CONFLICT (live_class_id, user_id) DO UPDATE SET
             status = 'active',
             joined_at = NOW(),
             left_at = NULL,
             role_in_class = EXCLUDED.role_in_class`,
          [classId, userId, access.roleInClass]
        );

        let chessStateSnapshot = null;
        let reviewSnapshot = null;
        try {
          const chess = await getOrInitChess(classId);
          const initEntry = getClassCacheEntry(classId);
          chessStateSnapshot = buildChessStateBroadcast(chess, null, undefined, initEntry);
          reviewSnapshot = initEntry.reviewTo != null
            ? buildReviewBroadcast(chess, initEntry.reviewTo)
            : null;
          const annotationsRes = await db.query(
            'SELECT annotations FROM chess_game_states WHERE live_class_id = $1',
            [classId]
          );
          if (annotationsRes.rows.length > 0) {
            chessStateSnapshot.annotations = annotationsRes.rows[0].annotations;
          } else {
            chessStateSnapshot.annotations = { arrows: [], highlights: [] };
          }
        } catch (e) {
          chessStateSnapshot = {
            fen: START_FEN,
            pgn: '',
            currentTurn: 'w',
            lastMove: null,
            moveNumber: 1,
            annotations: { arrows: [], highlights: [] },
          };
        }

        let roster = [];
        try {
          const rosterRes = await db.query(
            `SELECT lp.user_id, u.name, lp.role_in_class, lp.status, lp.joined_at
             FROM live_class_participants lp JOIN users u ON u.id = lp.user_id
             WHERE lp.live_class_id = $1 AND lp.status = 'active'
             ORDER BY lp.joined_at ASC`,
            [classId]
          );
          roster = rosterRes.rows;
        } catch (e) {}

        let moveGrantsSnapshot = [];
        try {
          const grantsRes = await db.query(
            'SELECT user_id, move_side FROM live_class_move_grants WHERE live_class_id = $1',
            [classId]
          );
          moveGrantsSnapshot = grantsRes.rows.map((r) => ({ userId: r.user_id, moveSide: r.move_side }));
        } catch (e) {}

        socket.emit('class:init', {
          classId,
          chessState: chessStateSnapshot,
          review: reviewSnapshot,
          roster,
          chatMode: classRow.chat_mode,
          studentInteractionEnabled: !!classRow.student_interaction_enabled,
          studentMoveSide: classRow.student_move_side || 'both',
          moveGrants: moveGrantsSnapshot,
          classStatus: classRow.status,
        });

        /* class:init always goes out - this socket needs the state snapshot even
           when it is re-joining a room it is already in. Only the room-wide
           arrival notice is de-duplicated. A second connection for a user whose
           first socket is still present (another tab, or a reconnect where the
           old socket has not died yet) is not an arrival at all. */
        if (firstConnection && claimPresenceBroadcast(classId, userId)) {
          io.to(`live-class:${classId}`).emit('participant_joined', {
            userId,
            name: userName,
            role: access.roleInClass,
            joinedAt: new Date().toISOString(),
          });
        }

        /* One arrival notice, broadcast to the WHOLE room - teacher, the other
           students, and the joiner themselves (already in the room above). Each
           client renders it from its own perspective: everyone else reads
           "X joined the class", while the joiner reads "You joined <class>".
           Gated by the 30s per-person window so a refresh/reconnect is silent.
           This is separate from `participant_joined`, which only drives the
           roster and must stay on its short 2s flap window. */
        if (firstConnection && claimJoinNotify(classId, userId)) {
          io.to(`live-class:${classId}`).emit('participant:joined', {
            userId,
            name: userName,
            role: access.roleInClass,
            classId,
            joinedAt: new Date().toISOString(),
          });
        }

        if (ack) ack({ ok: true, roleInClass: access.roleInClass });
      } catch (err) {
        console.error('[join-live-class] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('leave-live-class', async (classId, ack) => {
      try {
        if (classId == null) return;
        socket.leave(`live-class:${classId}`);
        if (socket.data.liveClasses) socket.data.liveClasses.delete(String(classId));

        /* Grace, not immediate. A refresh leaves then rejoins within
           milliseconds, and a StrictMode remount does the same; announcing the
           departure straight away made the roster blink out and back (and, when
           the HTTP snapshot landed in the gap, read "0 in class"). The leave is
           only real once the user's connection count has stayed at zero for the
           whole window - a socket that returns first cancels it. */
        const room = `live-class:${classId}`;
        untrackPresence(classId, userId, socket.id, async () => {
          await db.query(
            `UPDATE live_class_participants
             SET status = 'left', left_at = NOW()
             WHERE live_class_id = $1 AND user_id = $2`,
            [classId, userId]
          );
          /* Shares the leave announcement with the rest of the room. */
          io.to(room).emit('participant_left', { userId });
        });
        if (ack) ack({ ok: true });
      } catch (err) {
        console.error('[leave-live-class] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('chess_move', async ({ classId, from, to, promotion }, ack) => {
      try {
        if (!classId || !from || !to) {
          if (ack) ack({ ok: false, error: 'classId, from, to required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized) {
          if (ack) ack({ ok: false, error: 'Not authorized' });
          return;
        }

        const chess = await getOrInitChess(classId);

        if (!access.isInstructor) {
          if (classRow.status !== 'live') {
            socket.emit('action_rejected', { action: 'chess_move', reason: 'Board is locked' });
            if (ack) ack({ ok: false, error: 'Board is locked' });
            return;
          }
          const turnSide = chess.turn() === 'w' ? 'white' : 'black';
          /* A live class is an interactive room: with no explicit grant a
             student may move either colour on the shared board. A per-student
             grant still restricts them to that colour; the class-wide setting
             is honoured when it names a side. The server validates every move
             and broadcasts the resulting state, so it stays the one source of
             truth. */
          let moveSide = 'both';
          const grantRes = await db.query(
            'SELECT move_side FROM live_class_move_grants WHERE live_class_id = $1 AND user_id = $2',
            [classId, userId]
          );
          if (grantRes.rows.length > 0 && grantRes.rows[0].move_side) {
            moveSide = grantRes.rows[0].move_side;
          } else if (classRow.student_interaction_enabled) {
            moveSide = classRow.student_move_side || 'both';
          }
          if (moveSide !== 'both' && moveSide !== turnSide) {
            const reason = `You can move ${moveSide} pieces only`;
            socket.emit('action_rejected', { action: 'chess_move', reason });
            if (ack) ack({ ok: false, error: reason });
            return;
          }
        }

        const moveOpts = { from, to };
        if (promotion) moveOpts.promotion = promotion;

        let move;
        try {
          move = chess.move(moveOpts);
        } catch (e) {
          if (ack) ack({ ok: false, error: 'Illegal move' });
          return;
        }

        if (!move) {
          if (ack) ack({ ok: false, error: 'Illegal move' });
          return;
        }

        const lastMove = { from: move.from, to: move.to, san: move.san };
        const entry = getClassCacheEntry(classId);
        entry.redoStack.length = 0;
        /* A played move ends any review the room was being walked through. */
        entry.reviewTo = null;
        await persistChessState(classId, chess, lastMove);

        nextBoardRevision(entry);
        const broadcast = buildChessStateBroadcast(chess, lastMove, undefined, entry);
        io.to(`live-class:${classId}`).emit('chess_state_updated', broadcast);
        if (ack) ack({ ok: true, broadcast });
      } catch (err) {
        console.error('[chess_move] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('chess_control', async ({ classId, action, payload }, ack) => {
      try {
        if (!classId || !action) {
          if (ack) ack({ ok: false, error: 'classId and action required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          socket.emit('action_rejected', { action, reason: 'Instructor only' });
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        const entry = getClassCacheEntry(classId);
        /* Every instructor action except the review itself ends the review. */
        if (action !== 'navigate') entry.reviewTo = null;
        const chess = entry.chess || (await getOrInitChess(classId));

        switch (action) {
          case 'undo': {
            const undone = chess.undo();
            if (!undone) {
              if (ack) ack({ ok: false, error: 'No moves to undo' });
              return;
            }
            entry.redoStack.push({ from: undone.from, to: undone.to, promotion: undone.promotion });
            if (entry.redoStack.length > 200) entry.redoStack.shift();
            const history = chess.history({ verbose: true });
            const lastHist = history[history.length - 1];
            const lastMove = lastHist ? { from: lastHist.from, to: lastHist.to, san: lastHist.san } : null;
            await persistChessState(classId, chess, lastMove);
            nextBoardRevision(entry);
            const broadcast = buildChessStateBroadcast(chess, lastMove, undefined, entry);
            io.to(`live-class:${classId}`).emit('chess_state_updated', broadcast);
            if (ack) ack({ ok: true, broadcast });
            return;
          }

          case 'redo': {
            const redoMove = entry.redoStack.pop();
            if (!redoMove) {
              if (ack) ack({ ok: false, error: 'Nothing to redo' });
              return;
            }
            const moveOpts = { from: redoMove.from, to: redoMove.to };
            if (redoMove.promotion) moveOpts.promotion = redoMove.promotion;
            try {
              chess.move(moveOpts);
            } catch (e) {
              if (ack) ack({ ok: false, error: 'Illegal move' });
              return;
            }
            const history = chess.history({ verbose: true });
            const lastHist = history[history.length - 1];
            const lastMove = lastHist ? { from: lastHist.from, to: lastHist.to, san: lastHist.san } : null;
            await persistChessState(classId, chess, lastMove);
            nextBoardRevision(entry);
            const broadcast = buildChessStateBroadcast(chess, lastMove, undefined, entry);
            io.to(`live-class:${classId}`).emit('chess_state_updated', broadcast);
            if (ack) ack({ ok: true, broadcast });
            return;
          }

          case 'reset':
          case 'new_game': {
            entry.redoStack.length = 0;
            chess.reset();
            await persistChessState(classId, chess, null);
            nextBoardRevision(entry);
            const broadcast = buildChessStateBroadcast(chess, null, undefined, entry);
            io.to(`live-class:${classId}`).emit('chess_state_updated', broadcast);
            if (ack) ack({ ok: true, broadcast });
            return;
          }

          case 'load_fen': {
            if (!payload || !payload.fen) {
              if (ack) ack({ ok: false, error: 'fen required' });
              return;
            }
            try {
              chess.load(payload.fen);
            } catch (e) {
              if (ack) ack({ ok: false, error: 'Invalid FEN' });
              return;
            }
            entry.redoStack.length = 0;
            await persistChessState(classId, chess, null);
            nextBoardRevision(entry);
            const broadcast = buildChessStateBroadcast(chess, null, undefined, entry);
            io.to(`live-class:${classId}`).emit('chess_state_updated', broadcast);
            if (ack) ack({ ok: true, broadcast });
            return;
          }

          case 'load_pgn': {
            const pgn = payload && payload.pgn ? String(payload.pgn) : '';
            if (!pgn.trim()) {
              if (ack) ack({ ok: false, error: 'pgn required' });
              return;
            }
            try {
              chess.loadPgn(pgn, { strict: false });
            } catch (e) {
              if (ack) ack({ ok: false, error: 'Invalid PGN' });
              return;
            }
            entry.redoStack.length = 0;
            const pgnHistory = chess.history({ verbose: true });
            const pgnLast = pgnHistory[pgnHistory.length - 1];
            const pgnLastMove = pgnLast
              ? { from: pgnLast.from, to: pgnLast.to, san: pgnLast.san }
              : null;
            await persistChessState(classId, chess, pgnLastMove);
            nextBoardRevision(entry);
            const pgnBroadcast = buildChessStateBroadcast(chess, pgnLastMove, undefined, entry);
            io.to(`live-class:${classId}`).emit('chess_state_updated', pgnBroadcast);
            if (ack) ack({ ok: true, broadcast: pgnBroadcast });
            return;
          }

          case 'navigate': {
            const to = payload && payload.to != null ? Number(payload.to) : null;
            const review = buildReviewBroadcast(chess, to);
            entry.reviewTo = review.to;
            io.to(`live-class:${classId}`).emit('chess_review_updated', review);
            if (ack) ack({ ok: true, review });
            return;
          }

          case 'set_orientation': {
            if (ack) ack({ ok: true, note: 'set_orientation is MVP in-memory only' });
            return;
          }

          case 'toggle_interaction': {
            const enabled = payload && typeof payload.enabled === 'boolean'
              ? payload.enabled
              : !classRow.student_interaction_enabled;
            const updated = await db.query(
              'UPDATE classes SET student_interaction_enabled = $1 WHERE id = $2 RETURNING *',
              [enabled, classId]
            );
            if (updated.rows.length > 0) {
              const entry = getClassCacheEntry(classId);
              entry.classRow = updated.rows[0];
              entry.classRowFetchedAt = Date.now();
            }
            io.to(`live-class:${classId}`).emit('interaction_changed', { enabled });
            if (ack) ack({ ok: true, enabled });
            return;
          }

          case 'set_move_side': {
            const side = payload && payload.side;
            if (side !== 'both' && side !== 'white' && side !== 'black') {
              if (ack) ack({ ok: false, error: "side must be 'both', 'white' or 'black'" });
              return;
            }
            const updated = await db.query(
              'UPDATE classes SET student_move_side = $1 WHERE id = $2 RETURNING *',
              [side, classId]
            );
            if (updated.rows.length > 0) {
              const entry = getClassCacheEntry(classId);
              entry.classRow = updated.rows[0];
              entry.classRowFetchedAt = Date.now();
            }
            io.to(`live-class:${classId}`).emit('move_side_changed', { side });
            if (ack) ack({ ok: true, side });
            return;
          }

          case 'clear_board': {
            chess.clear();
            await persistChessState(classId, chess, null);
            nextBoardRevision(entry);
            const broadcast = buildChessStateBroadcast(chess, null, undefined, entry);
            io.to(`live-class:${classId}`).emit('chess_state_updated', broadcast);
            if (ack) ack({ ok: true, broadcast });
            return;
          }

          default:
            if (ack) ack({ ok: false, error: `Unknown action: ${action}` });
        }
      } catch (err) {
        console.error('[chess_control] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('board_annotation', async ({ classId, type, data }, ack) => {
      try {
        if (!classId || !type) {
          if (ack) ack({ ok: false, error: 'classId and type required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          socket.emit('action_rejected', { action: 'board_annotation', reason: 'Instructor only' });
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        const { annotations } = await runAnnotationMutation(classId, async () => {
          const upsertRes = await db.query(
            `INSERT INTO chess_game_states (live_class_id, fen, pgn, current_turn, annotations, updated_at)
             VALUES ($1, $2, '', 'w', '{"arrows":[],"highlights":[]}'::jsonb, NOW())
             ON CONFLICT (live_class_id) DO UPDATE SET updated_at = NOW()
             RETURNING annotations`,
            [classId, START_FEN]
          );

          let annotations = upsertRes.rows[0]?.annotations || { arrows: [], highlights: [] };
          if (typeof annotations === 'string') annotations = JSON.parse(annotations);

          switch (type) {
            case 'add_arrow':
              if (data && data.from && data.to) {
                annotations.arrows = annotations.arrows || [];
                annotations.arrows.push({ from: data.from, to: data.to, color: data.color || '#f1c26b' });
              }
              break;
            case 'add_highlight':
              if (data && data.square) {
                /* One fill per square: recolouring replaces the existing entry
                   instead of stacking a second highlight on the same square. */
                annotations.highlights = (annotations.highlights || []).filter(
                  (h) => h.square !== data.square
                );
                annotations.highlights.push({
                  square: data.square,
                  color: data.color || 'rgba(235, 64, 52, 0.55)',
                });
              }
              break;
            case 'remove_highlight':
              if (data && data.square) {
                annotations.highlights = (annotations.highlights || []).filter(
                  (h) => h.square !== data.square
                );
              }
              break;
            case 'clear_annotations':
              annotations = { arrows: [], highlights: [] };
              break;
            case 'clear_arrows':
              annotations.arrows = [];
              break;
            case 'remove_arrow':
              if (data && data.from && data.to) {
                annotations.arrows = (annotations.arrows || []).filter(
                  (a) => !(a.from === data.from && a.to === data.to)
                );
              }
              break;
            case 'set_arrows':
              annotations.arrows = Array.isArray(data?.arrows)
                ? data.arrows.map((a) => ({ from: a.from, to: a.to, color: a.color || '#f1c26b' }))
                : [];
              break;
            default:
              if (ack) ack({ ok: false, error: `Unknown annotation type: ${type}` });
              return { annotations: null, unknown: true };
          }

          await db.query(
            'UPDATE chess_game_states SET annotations = $1::jsonb WHERE live_class_id = $2',
            [JSON.stringify(annotations), classId]
          );
          return { annotations };
        });

        if (annotations === null) return;

        io.to(`live-class:${classId}`).emit('annotations_updated', { annotations });
        if (ack) ack({ ok: true, annotations });
      } catch (err) {
        console.error('[board_annotation] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('student_move_grant', async ({ classId, userId: targetUserId, side }, ack) => {
      try {
        if (!classId || !targetUserId) {
          if (ack) ack({ ok: false, error: 'classId and userId required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          socket.emit('action_rejected', { action: 'student_move_grant', reason: 'Instructor only' });
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        if (side !== 'white' && side !== 'black' && side !== 'both' && side !== 'none') {
          if (ack) ack({ ok: false, error: "side must be 'white' | 'black' | 'both' | 'none'" });
          return;
        }

        if (side === 'none') {
          await db.query(
            'DELETE FROM live_class_move_grants WHERE live_class_id = $1 AND user_id = $2',
            [classId, targetUserId]
          );
          io.to(`live-class:${classId}`).emit('move_grant_changed', { userId: targetUserId, side: null });
          if (ack) ack({ ok: true, side: null });
          return;
        }

        await db.query(
          `INSERT INTO live_class_move_grants (live_class_id, user_id, move_side, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (live_class_id, user_id)
           DO UPDATE SET move_side = EXCLUDED.move_side, updated_at = NOW()`,
          [classId, targetUserId, side]
        );

        io.to(`live-class:${classId}`).emit('move_grant_changed', { userId: targetUserId, side });
        if (ack) ack({ ok: true, side });
      } catch (err) {
        console.error('[student_move_grant] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('play_launch', async ({ classId }, ack) => {
      try {
        if (!classId) {
          if (ack) ack({ ok: false, error: 'classId required' });
          return;
        }
        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }
        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }
        // Just a signal: students receive the event and can open their own Play Arena.
        io.to(`live-class:${classId}`).emit('play_launch', { classId, byUserId: userId });
        if (ack) ack({ ok: true });
      } catch (err) {
        console.error('[play_launch] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('chat_message', async ({ classId, text }, ack) => {
      try {
        if (!classId || !text || typeof text !== 'string' || !text.trim()) {
          if (ack) ack({ ok: false, error: 'classId and text required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized) {
          if (ack) ack({ ok: false, error: 'Not authorized' });
          return;
        }

        const chatMode = classRow.chat_mode || 'open';
        if (chatMode === 'instructor-only' && !access.isInstructor) {
          socket.emit('action_rejected', { action: 'chat_message', reason: 'Chat is instructor-only' });
          if (ack) ack({ ok: false, error: 'Chat is instructor-only' });
          return;
        }

        const inserted = await db.query(
          `INSERT INTO chat_messages (live_class_id, user_id, message, created_at)
           VALUES ($1, $2, $3, NOW()) RETURNING *`,
          [classId, userId, text.trim()]
        );

        const msgRow = inserted.rows[0];
        const userRes = await db.query(
          'SELECT name, role FROM users WHERE id = $1',
          [userId]
        );
        const user = userRes.rows[0] || { name: userName, role: userRole };

        const broadcastMsg = {
          id: msgRow.id,
          userId,
          userName: user.name,
          userRole: user.role,
          message: msgRow.message,
          createdAt: msgRow.created_at,
        };

        io.to(`live-class:${classId}`).emit('chat_message_broadcast', broadcastMsg);
        if (ack) ack({ ok: true, message: broadcastMsg });
      } catch (err) {
        console.error('[chat_message] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    /* ── private student → coach DM ──
       A student writes to the coach directly; the message is visible ONLY to
       that student and the instructor — never to the rest of the room. */
    socket.on('chat_dm', async ({ classId, text, clientId }, ack) => {
      try {
        if (classId == null || !text || !String(text).trim()) {
          if (ack) ack({ ok: false, error: 'classId and message required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized) {
          if (ack) ack({ ok: false, error: 'Not authorized' });
          return;
        }
        if (access.isInstructor) {
          socket.emit('action_rejected', { action: 'chat_dm', reason: 'DMs are for students to reach the coach' });
          if (ack) ack({ ok: false, error: 'Students use DMs to reach the coach' });
          return;
        }

        /* Who may host this class, and therefore who the student is writing to.

           userIsMemberOfClass treats EVERY admin/superadmin as an instructor, so
           routing a DM to classRow.coach_id alone meant a Super Admin could host
           the classroom, appear in the roster as HOST, and never receive the
           student's message — it went to the coach's bell instead. Recipients are
           therefore the class coach PLUS every admin/superadmin actually present
           in the room. Presence comes from the socket rooms, which is the same
           source the roster uses, so we do not notify admins who are not here.

           Falls back to any admin/superadmin when nobody is in the room yet, so a
           message sent before the host connects is not silently dropped. */
        const recipientIds = new Set();
        if (classRow.coach_id != null) recipientIds.add(Number(classRow.coach_id));

        try {
          const roomSockets = await io.in(`live-class:${classId}`).fetchSockets();
          for (const s of roomSockets) {
            const uid = s.user?.id;
            if (uid == null) continue;
            const role = s.user?.role;
            if (role === 'admin' || role === 'superadmin') recipientIds.add(Number(uid));
          }
        } catch (e) {
          console.warn('[chat_dm] recipient discovery failed:', e.message);
        }

        if (recipientIds.size === 0) {
          const adminRes = await db.query(
            "SELECT id FROM users WHERE role = 'admin' OR role = 'superadmin' ORDER BY id LIMIT 1",
          );
          if (adminRes.rows[0]) recipientIds.add(Number(adminRes.rows[0].id));
        }
        if (recipientIds.size === 0) {
          if (ack) ack({ ok: false, error: 'No coach assigned to this class' });
          return;
        }
        const recipients = [...recipientIds];
        const recipientId = recipients[0];

const body = String(text).trim();
        let echoRow = null;
        const userRes = await db.query(
          'SELECT name, role FROM users WHERE id = $1',
          [userId],
        );
        const user = userRes.rows[0] || { name: userName, role: userRole };

        /* One row PER RECIPIENT. recipient_id is single-valued, so a shared row
           would leave every host except the first with no thread in the Messages
           page (getThread and listConversations both key on recipient_id).

           sender_id is the column every DM read path uses to find the author
           (getThread joins users on it; listConversations derives the
           conversation partner from it). Writing only user_id left it NULL, so
           the message existed but was invisible. Both columns are set: user_id
           for class-scoped queries, sender_id for DMs. */
        let firstDm = null;
        for (const rid of recipients) {
          const inserted = await db.query(
            `INSERT INTO chat_messages (live_class_id, user_id, sender_id, recipient_id, is_private, message, created_at)
             VALUES ($1, $2, $2, $3, TRUE, $4, NOW())
             RETURNING id, recipient_id, message, created_at`,
            [classId, userId, rid, body],
          );
          const msgRow = inserted.rows[0];
          if (!echoRow) echoRow = msgRow;

          const dm = {
            id: msgRow.id,
            userId,
            senderId: userId,
            recipientId: rid,
            userName: user.name,
            userRole: user.role,
            message: msgRow.message,
            createdAt: msgRow.created_at,
            /* Echoed straight back to the sender so the optimistic copy can be
               matched and confirmed instead of shown twice. */
            clientId: clientId || null,
          };

          /* Deliver to each host's personal room (`user:<id>`, joined for every
             authenticated socket in server.js) and echo to the sender.

             This used to walk io.sockets.sockets and compare ids by hand, which
             silently dropped the message whenever coach_id came back from pg as
             a number while the JWT id was a string. Room addressing has no such
             type question. */
          if (!firstDm) firstDm = dm;
          io.to(`user:${rid}`).emit('chat_dm', dm);

          /* Bell entry per host, so the message is findable when they are not
             looking at this classroom — the same treatment
             chatController.sendDirectMessage gives its DMs. One unread row per
             conversation, deduped like the REST path does. relatedId is the
             sender, so tapping the notification opens the right thread.
             notificationService.create fails softly by design; a bell problem
             must not lose the DM. */
          try {
            const preview = body.slice(0, 120);
            const dupe = await db.query(
              `SELECT 1 FROM notifications
                WHERE user_id = $1 AND type = 'message' AND related_id = $2 AND is_read = FALSE
                LIMIT 1`,
              [rid, userId],
            );
            if (dupe.rows.length === 0 && preview) {
              await notificationService.push(io, rid, user.name, preview, {
                type: 'message',
                senderId: userId,
                relatedId: userId,
              });
            }
          } catch (e) {
            console.warn('[chat_dm] notification skipped:', e.message);
          }
        }

        /* Echo to the sender so their own copy appears immediately. This uses the
           first inserted row, not a fabricated id, so the sender's Messages
           thread matches what the server stored. */
        if (echoRow) {
          socket.emit('chat_dm', {
            id: echoRow.id,
            userId,
            senderId: userId,
            recipientId: echoRow.recipient_id,
            userName: user.name,
            userRole: user.role,
            message: echoRow.message,
            createdAt: echoRow.created_at,
            clientId: clientId || null,
          });
        }

        if (ack) ack({ ok: true, message: firstDm });
      } catch (err) {
        console.error('[chat_dm] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    /* ── coach → student private reply ──
       The other half of the classroom DM. `chat_dm` above is deliberately
       students-only (an instructor is rejected there), so the coach's answer
       gets its own event instead of widening that route. It is stored with the
       SAME conversation shape (live_class_id + sender_id + recipient_id +
       is_private) so both directions load into one thread on history, and it is
       delivered ONLY to the target student's personal room and echoed to the
       coach — never to the room. */
    socket.on('chat_dm_reply', async ({ classId, toUserId, text, clientId }, ack) => {
      try {
        if (classId == null || toUserId == null || !text || !String(text).trim()) {
          if (ack) ack({ ok: false, error: 'classId, toUserId and message required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        const target = Number(toUserId);
        if (!Number.isFinite(target) || target === Number(userId)) {
          if (ack) ack({ ok: false, error: 'Invalid recipient' });
          return;
        }
        const targetRes = await db.query('SELECT id FROM users WHERE id = $1', [target]);
        if (targetRes.rows.length === 0) {
          if (ack) ack({ ok: false, error: 'Student not found' });
          return;
        }

        const body = String(text).trim();
        const userRes = await db.query('SELECT name, role FROM users WHERE id = $1', [userId]);
        const coach = userRes.rows[0] || { name: userName, role: userRole };

        const inserted = await db.query(
          `INSERT INTO chat_messages (live_class_id, user_id, sender_id, recipient_id, is_private, message, created_at)
           VALUES ($1, $2, $2, $3, TRUE, $4, NOW())
           RETURNING id, recipient_id, message, created_at`,
          [classId, userId, target, body],
        );
        const msgRow = inserted.rows[0];
        const dm = {
          id: msgRow.id,
          userId,
          senderId: userId,
          recipientId: msgRow.recipient_id,
          userName: coach.name,
          userRole: coach.role,
          message: msgRow.message,
          createdAt: msgRow.created_at,
          clientId: clientId || null,
        };

        io.to(`user:${target}`).emit('chat_dm', dm);
        socket.emit('chat_dm', dm);

        try {
          const preview = body.slice(0, 120);
          const dupe = await db.query(
            `SELECT 1 FROM notifications
              WHERE user_id = $1 AND type = 'message' AND related_id = $2 AND is_read = FALSE
              LIMIT 1`,
            [target, userId],
          );
          if (dupe.rows.length === 0 && preview) {
            await notificationService.push(io, target, coach.name, preview, {
              type: 'message',
              senderId: userId,
              relatedId: userId,
            });
          }
        } catch (e) {
          console.warn('[chat_dm_reply] notification skipped:', e.message);
        }

        if (ack) ack({ ok: true, message: dm });
      } catch (err) {
        console.error('[chat_dm_reply] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    /* ── instructor marks one student's DM thread as read ──
       The unread badge is DERIVED on the client from the per-message `read_at`
       flag (the same column the REST Messages feature uses), so clearing it is
       just stamping every still-unread inbound row from that student. The
       `recipient_id = userId` clause makes it self-scoped: a socket can only
       clear rows addressed to itself, so no one can zero out another host's
       inbox. Instructor-only, matching who the badge is for. */
    socket.on('chat_dm_read', async ({ classId, peerId }, ack) => {
      try {
        if (classId == null || peerId == null) {
          if (ack) ack({ ok: false, error: 'classId and peerId required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        const peer = Number(peerId);
        if (!Number.isFinite(peer)) {
          if (ack) ack({ ok: false, error: 'Invalid peer' });
          return;
        }

        await db.query(
          `UPDATE chat_messages SET read_at = NOW()
            WHERE live_class_id = $1 AND sender_id = $2 AND recipient_id = $3
              AND is_private = TRUE AND read_at IS NULL`,
          [classId, peer, userId],
        );

        if (ack) ack({ ok: true });
      } catch (err) {
        console.error('[chat_dm_read] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('admin:remove_participant', async ({ classId, userId: targetUserId }, ack) => {
      try {
        if (!classId || targetUserId == null) {
          if (ack) ack({ ok: false, error: 'classId and userId required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        await db.query(
          `UPDATE live_class_participants
           SET status = 'left', left_at = NOW()
           WHERE live_class_id = $1 AND user_id = $2`,
          [classId, targetUserId]
        );

        io.to(`user:${targetUserId}`).emit('class_kicked', { classId });

        const targetSockets = await io.in(`user:${targetUserId}`).fetchSockets();
        for (const s of targetSockets) {
          s.leave(`live-class:${classId}`);
          if (s.data.liveClasses) s.data.liveClasses.delete(String(classId));
        }

        /* A kick is deliberate, so skip the grace window and evict at once. */
        forceVacate(classId, targetUserId);

        io.to(`live-class:${classId}`).emit('participant_left', { userId: targetUserId });
        if (ack) ack({ ok: true });
      } catch (err) {
        console.error('[admin:remove_participant] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('admin:mute_participant', async ({ classId, userId: targetUserId }, ack) => {
      try {
        if (!classId || targetUserId == null) {
          if (ack) ack({ ok: false, error: 'classId and userId required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        io.to(`user:${targetUserId}`).emit('request_mute', { classId, byUserId: userId });
        io.to(`user:${targetUserId}`).emit('participant_mute_requested', { classId });

        if (ack) ack({ ok: true });
      } catch (err) {
        console.error('[admin:mute_participant] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    /* 👥 invite_students — the instructor invites class members who aren't in
       the room yet. Each invited student gets a DB notification plus a live
       socket push so their client can toast "Join now" → /live-class/:id. */
    socket.on('invite_students', async ({ classId, userIds }, ack) => {
      try {
        if (!classId || !Array.isArray(userIds) || userIds.length === 0) {
          if (ack) ack({ ok: false, error: 'classId and userIds required' });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        const title = `📺 ${classRow.title} — join now!`;
        const message = `${userName || 'Your coach'} invited you to the live classroom. #class-${classId}`;
        for (const uid of [...new Set(userIds)]) {
          if (uid == null) continue;
          /* If the invited student isn't a class member yet (e.g. a new student
             the coach added mid-session), add them to class_students so the
             join access check lets them into the room. Only do this for classes
             that ALREADY use explicit class_students membership — inserting the
             first row into a group/all class would switch it to explicit-only
             and lock out the rest of the students. */
          try {
            const explicit = await db.query(
              'SELECT EXISTS (SELECT 1 FROM class_students WHERE class_id = $1) AS has_explicit',
              [classId]
            );
            if (explicit.rows[0]?.has_explicit) {
              const stuRes = await db.query(
                'SELECT id FROM students WHERE user_id = $1 LIMIT 1',
                [uid]
              );
              if (stuRes.rows.length > 0) {
                await db.query(
                  `INSERT INTO class_students (class_id, student_id)
                   VALUES ($1, $2)
                   ON CONFLICT DO NOTHING`,
                  [classId, stuRes.rows[0].id]
                );
              }
            }
          } catch (e) {
            console.warn('[invite_students] add-to-class skipped:', e.message);
          }
          await notificationService.create({
            userId: uid,
            title,
            message,
            type: 'live_invite',
            senderId: userId,
            relatedId: classId,
          });
          io.to(`user:${uid}`).emit('live_class_invite', {
            classId,
            title: classRow.title,
            invitedById: userId,
          });
        }

        if (ack) ack({ ok: true, invited: [...new Set(userIds)].filter((x) => x != null).length });
      } catch (err) {
        console.error('[invite_students] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('admin:set_chat_mode', async ({ classId, mode }, ack) => {
      try {
        if (!classId || !mode) {
          if (ack) ack({ ok: false, error: 'classId and mode required' });
          return;
        }
        if (mode !== 'open' && mode !== 'instructor-only') {
          if (ack) ack({ ok: false, error: "mode must be 'open' or 'instructor-only'" });
          return;
        }

        const classRow = await getClassRowCached(classId);
        if (!classRow) {
          if (ack) ack({ ok: false, error: 'Class not found' });
          return;
        }

        const access = await userIsMemberOfClass({ userId, userRole }, classRow);
        if (!access.authorized || !access.isInstructor) {
          if (ack) ack({ ok: false, error: 'Instructor only' });
          return;
        }

        const updated = await db.query(
          'UPDATE classes SET chat_mode = $1 WHERE id = $2 RETURNING *',
          [mode, classId]
        );
        if (updated.rows.length > 0) {
          const entry = getClassCacheEntry(classId);
          entry.classRow = updated.rows[0];
          entry.classRowFetchedAt = Date.now();
        }

        io.to(`live-class:${classId}`).emit('chat_mode_changed', { mode });
        if (ack) ack({ ok: true, mode });
      } catch (err) {
        console.error('[admin:set_chat_mode] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('join-game', async (gameId) => {
      if (gameId == null) return;
      const uid = socket.user?.id;
      if (uid == null) return;
      try {
        const rowRes = await db.query('SELECT * FROM online_games WHERE id = $1', [gameId]);
        const row = rowRes.rows[0];
        if (!row) return;
        const isParticipant =
          Number(row.admin_id) === Number(uid) || Number(row.student_id) === Number(uid);
        const isHostRole = socket.user?.role === 'admin' || socket.user?.role === 'superadmin';
        /* Global (non-class) games stay open to any signed-in user, exactly as
           before. Class games are gated below. */
        if (!row.class_id || isParticipant || isHostRole) {
          socket.join(`game:${gameId}`);
          return;
        }
        /* Class game viewed by a non-participant student: enforce the same "own
           game finished + teacher switch" rule the REST layer enforces, so the
           board cannot be watched by emitting this socket event directly. */
        const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [row.class_id]);
        const classRow = classRes.rows[0] || null;
        const ownFinished = await ownClassGameFinished(row.class_id, uid);
        const decision = canSpectateGame({
          viewer: { id: uid, role: socket.user?.role },
          gameRow: row,
          classRow,
          ownGameFinished: ownFinished,
        });
        if (decision.allowed) {
          socket.join(`game:${gameId}`);
        } else {
          socket.emit('action_rejected', {
            action: 'join-game',
            reason: decision.reason === 'disabled'
              ? 'Your coach has turned off watching classmates'
              : 'Finish your own game before watching classmates',
          });
        }
      } catch (err) {
        console.error('[join-game] error', err);
      }
    });

    socket.on('leave-game', (gameId) => {
      if (gameId == null) return;
      socket.leave(`game:${gameId}`);
    });

    socket.on('join-spec', (key) => {
      if (!key) return;
      socket.join(`spec:${key}`);
    });

    socket.on('leave-spec', (key) => {
      if (!key) return;
      socket.leave(`spec:${key}`);
    });

    socket.on('spec:register', (payload, ack) => {
      try {
        if (!payload?.key) {
          if (ack) ack({ ok: false, error: 'key required' });
          return;
        }
        const room = `spec:${payload.key}`;
        socket.data.specSessions = socket.data.specSessions || {};
        socket.data.specSessions[payload.key] = payload;
        socket.to(room).emit('spec-update', { session: payload });
        if (ack) ack({ ok: true });
      } catch (err) {
        console.error('[spec:register] error', err);
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('spec:update', (payload) => {
      if (!payload?.key) return;
      const room = `spec:${payload.key}`;
      socket.data.specSessions = socket.data.specSessions || {};
      socket.data.specSessions[payload.key] = payload;
      socket.to(room).emit('spec-update', { session: payload });
    });

    socket.on('spec:end', (key) => {
      if (!key) return;
      socket.data.specSessions = socket.data.specSessions || {};
      delete socket.data.specSessions[key];
      socket.to(`spec:${key}`).emit('spec-end', { key });
    });

    socket.on('disconnect', async () => {
      try {
        /* socket.io clears socket.rooms before 'disconnect', so the rooms we
           joined are remembered on socket.data instead of re-derived here. */
        const classIds = socket.data.liveClasses
          ? [...socket.data.liveClasses]
          : Array.from(socket.rooms || [])
              .filter((r) => r.startsWith('live-class:'))
              .map((r) => r.slice('live-class:'.length));
        socket.data.liveClasses = undefined;

        for (const classId of classIds) {
          const room = `live-class:${classId}`;
          /* Same grace as an explicit leave: a dropped socket during a refresh
             or a network blip must not evict a user who is already reconnecting. */
          untrackPresence(classId, userId, socket.id, async () => {
            const parsedId = parseInt(classId, 10);
            if (!isNaN(parsedId)) {
              await db.query(
                `UPDATE live_class_participants
                 SET status = 'left', left_at = NOW()
                 WHERE live_class_id = $1 AND user_id = $2 AND status = 'active'`,
                [parsedId, userId]
              );
            }
            io.to(room).emit('participant_left', { userId });
          });
        }
      } catch (err) {
        console.error('[disconnect] error', err);
      }
    });
  });
};
