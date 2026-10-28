const db = require('../config/database');
const { Chess } = require('chess.js');
const rating = require('../services/ratingService');
const notif = require('../services/notificationService');
const { userIsMemberOfClass } = require('../services/liveClassAccess');
const { canSpectateClass, canSpectateGame } = require('../services/spectateAccess');
/* Background Stockfish analysis. Fire-and-forget on every finish path — see
   services/analysis/enqueueHooks.js for why a hook failure must never affect
   saving the game itself. */
const analysisHooks = require('../services/analysis/enqueueHooks');

function emitToUser(io, userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/* Every open "Live games" list must drop a match the moment it stops being
   watchable. `game-update` is scoped to the two players and the game room, so a
   third user browsing the arena never hears about the finish and keeps seeing a
   dead board until the next poll. This broadcasts a neutral signal (id + status,
   no names or result) to everyone; clients remove that one card and let their
   next poll reconcile anything else. Repeated calls for the same finish (rating
   hooks, retries) are collapsed for a few seconds. */
const liveEndedSeen = new Map();
function broadcastLiveEnded(io, row) {
  if (!io || (row.status !== 'finished' && row.status !== 'aborted')) return;
  const last = liveEndedSeen.get(row.id);
  if (last && last.status === row.status && Date.now() - last.at < 10000) return;
  const at = Date.now();
  liveEndedSeen.set(row.id, { status: row.status, at });
  const timer = setTimeout(() => {
    if (liveEndedSeen.get(row.id)?.at === at) liveEndedSeen.delete(row.id);
  }, 10000);
  timer.unref?.();
  io.emit('live-games-changed', { gameId: row.id, status: row.status });
}

function emitGameUpdate(req, gameId) {
  const io = req.app.get('io');
  if (!io) return;
  getGameRow(gameId).then((row) => {
    if (!row) return;
    const forAdmin = payload(row, 'admin', row.admin_id);
    const forStudent = payload(row, 'student', row.student_id);
    // Neutral, role-agnostic view for spectators: both players + live state.
    const forSpectator = spectatePayload(row);
    const wrapped = { forAdmin, forStudent, forSpectator };
    io.to(`game:${gameId}`).emit('game-update', wrapped);
    // Also notify each participant directly (in case they aren't in the game room yet)
    emitToUser(io, row.admin_id, 'game-update', wrapped);
    emitToUser(io, row.student_id, 'game-update', wrapped);
    broadcastLiveEnded(io, row);
  }).catch(() => {});
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const nowMs = () => Date.now();
const rowMs = (v) => new Date(v).getTime();

/* ── Rating hook (online / classroom student-vs-student matches) ────────
 * Rating counts ONLY for STUDENT vs STUDENT games. Coach-vs-student
 * (practice/teaching/demo) matches are excluded from the rating engine.
 * Classroom PvP games are explicitly marked as rated metadata, but still pass
 * through the same player-role and concrete-result eligibility checks. */
/* Tell the classroom hosts that a game in their class just finished. Recipients
   mirror the `chat_dm` rule in liveClassSocket.js: the class coach PLUS every
   admin/superadmin actually present in the live-class room, because
   userIsMemberOfClass lets any of them host. Falls back to any admin when the
   room is empty so a game that ends before the host connects is not silent. */
async function notifyClassGameFinished(req, row) {
  if (!row.class_id) return;
  const io = req.app.get('io');
  if (!io) return;
  try {
    /* Ping the class room so the instructor's live PvP grid re-fetches the
       instant a board ends, instead of waiting up to 4s for its next poll. */
    io.to(`live-class:${row.class_id}`).emit('pvp-finished', {
      classId: row.class_id,
      gameId: row.id,
      result: row.result,
      reason: row.result_reason || null,
    });
    /* The classroom table is `classes` (see liveClassController) — there is no
       `live_classes`; querying that name threw and the outer catch downgraded it
       to a warning, so no coach was ever notified. */
    const classRes = await db.query(
      'SELECT id, title, coach_id FROM classes WHERE id = $1',
      [row.class_id]
    );
    const classRow = classRes.rows[0];
    if (!classRow) return;

    const recipientIds = new Set();
    if (classRow.coach_id != null) recipientIds.add(Number(classRow.coach_id));
    try {
      const roomSockets = await io.in(`live-class:${row.class_id}`).fetchSockets();
      for (const s of roomSockets) {
        const uid = s.user?.id;
        if (uid == null) continue;
        if (s.user?.role === 'admin' || s.user?.role === 'superadmin') recipientIds.add(Number(uid));
      }
    } catch (e) {
      console.warn('[game-finished] host discovery failed:', e.message);
    }
    if (recipientIds.size === 0) {
      const adminRes = await db.query(
        "SELECT id FROM users WHERE role = 'admin' OR role = 'superadmin' ORDER BY id LIMIT 1"
      );
      if (adminRes.rows[0]) recipientIds.add(Number(adminRes.rows[0].id));
    }
    if (recipientIds.size === 0) return;

    const whoRes = await db.query(
      'SELECT id, name FROM users WHERE id = $1',
      [row.student_id]
    );
    const studentName = whoRes.rows[0]?.name || 'A student';
    const vsBot = Boolean(row.is_bot);
    const message = vsBot
      ? `${studentName} finished a computer game — ${resultPhrase(row.result)}.`
      : `${studentName} finished a paired game — ${resultPhrase(row.result)}.`;

    for (const uid of recipientIds) {
      await notif.push(io, uid, `Game finished · ${classRow.title || 'Class'}`, message, {
        type: 'game_result',
        senderId: row.student_id,
        relatedId: row.id,
      });
    }
    emitToUser(io, row.student_id, 'game-finished-in-class', {
      classId: row.class_id,
      gameId: row.id,
      result: row.result,
    });
  } catch (err) {
    console.warn('[game-finished] notify failed:', err.message);
  }
}

function resultPhrase(result) {
  if (result === 'white') return 'White won';
  if (result === 'black') return 'Black won';
  if (result === 'draw') return 'a draw';
  if (result === 'abandoned') return 'ended by agreement';
  return 'game over';
}

async function applyOnlineRating(row, result) {
  try {
    // Result must be concrete. Abandoned, aborted, and classroom bot games
    // therefore never receive a rating.
    if (!['white', 'black', 'draw'].includes(result)) return;
    if (row.is_bot) return;

    // Both participants must be students; else it's practice mode (no rating).
    const users = await db.query(
      `SELECT id, role FROM users WHERE id IN ($1,$2)`,
      [row.admin_id, row.student_id]
    );
    if (users.rows.length < 2 || users.rows.some((u) => u.role !== 'student')) return;

    const students = await db.query(
      `SELECT id, user_id FROM students WHERE user_id IN ($1,$2)`,
      [row.admin_id, row.student_id]
    );
    const byUser = {};
    students.rows.forEach((s) => (byUser[s.user_id] = s.id));
    const adminStudent = byUser[row.admin_id];
    const oppStudent = byUser[row.student_id];
    if (!adminStudent || !oppStudent) return;

    // Track which student is white (admin_color may be white or black).
    const whiteStudent = row.admin_color === 'white' ? adminStudent : oppStudent;
    const blackStudent = row.admin_color === 'white' ? oppStudent : adminStudent;

    /* `s.id` MUST be in this select. Both maps below are keyed by it, and the
       ids are the keys that tie a rating row back to a player:
         - without it every row keys as the string "undefined", so the two
           players COLLIDE into one entry and ratingById[studentId] is undefined;
         - ratingService.updateSingleStudent then reads
           opponentRating ?? profile.current_rating, silently substituting the
           player's OWN rating, so expectedScore(r, r) === 0.5 for every game
           and the K-factor turns every result into a flat +10 / -10 no matter
           how far apart the two players actually are;
         - opponent_name in rating_history was stored NULL for the same reason.
       `name` lives only on `users` (students has no name column), so it is
       qualified here purely for clarity - the resolved column is unchanged. */
    const info = await db.query(
      `SELECT s.id, s.current_rating, u.name
         FROM students s JOIN users u ON u.id = s.user_id
        WHERE s.id IN ($1,$2)`,
      [whiteStudent, blackStudent]
    );
    const ratingById = {}; const nameById = {};
    info.rows.forEach((r) => { ratingById[r.id] = r.current_rating; nameById[r.id] = r.name; });

    /* Guard, not decoration. If either player's rating or name cannot be
       resolved, applying the result would rate the game against the player's
       own rating (see above) and quietly write a wrong ±10. Refuse instead of
       rating on bad data; applyOnlineRating's catch keeps the game flow intact. */
    if (ratingById[whiteStudent] == null || ratingById[blackStudent] == null
        || nameById[whiteStudent] == null || nameById[blackStudent] == null) {
      console.error(
        `applyOnlineRating: could not resolve both players for game ${row.id} `
        + `(white=${whiteStudent}, black=${blackStudent}) - skipping rating to avoid `
        + 'rating against a missing opponent.'
      );
      return null;
    }

    const whiteScore = result === 'white' ? 1 : result === 'black' ? 0 : 0.5;
    const blackScore = result === 'black' ? 1 : result === 'white' ? 0 : 0.5;

    await rating.applyGameResult({
      player: { studentId: whiteStudent, score: whiteScore, rating: ratingById[whiteStudent], name: nameById[whiteStudent] },
      opponent: { studentId: blackStudent, score: blackScore, rating: ratingById[blackStudent], name: nameById[blackStudent] },
      meta: {
        /* The display label the player reads ("Rapid", "Blitz", ...). Derived
           from the game's own persisted time_base_minutes. */
        timeControl: onlineTcLabel(row.time_base_minutes, row.time_increment_seconds),
        /* The CANONICAL category key, derived from the same persisted column but
           by ratingService's single classifier - the same function that picks the
           rating pool. Passing it explicitly means the controller's label helper
           and the pool selector can never disagree about a game's category, which
           is what made a Blitz game able to report as Rapid. */
        timeClass: rating.classifyTimeControl(
          onlineTcLabel(row.time_base_minutes, row.time_increment_seconds),
        ),
        gameType: row.class_id ? 'classroom' : 'online',
        classroomGame: Boolean(row.class_id),
        rated: true,
        /* Links the two rating_history rows to this game, which is how
           getRatingResult finds "my change for this game" later. */
        onlineGameId: row.id,
      },
    });

    /* Returned so the caller knows a rating happened. The per-player numbers are
       NOT returned to the client from here: emitGameUpdate broadcasts both
       sides' payloads to both sockets, so a delta riding along in payload()
       would leak the opponent's rating to their opponent. The client reads its
       own change from GET /games/:id/rating-result instead. */
    return { rated: true };
  } catch (err) {
    // rating must never break the game flow
    console.error('applyOnlineRating error:', err.message);
    return null;
  }
}

function onlineTcLabel(baseMin, incSec) {
  const b = Number(baseMin) || 0;
  if (b < 3) return 'Bullet';
  if (b < 10) return 'Blitz';
  if (b < 30) return 'Rapid';
  return 'Classical';
}

async function getGameRow(id) {
  const r = await db.query(
    `SELECT g.*, au.name AS admin_name, su.name AS student_name,
            au.profile_image AS admin_profile_image, au.avatar_config AS admin_avatar_config,
            su.profile_image AS student_profile_image, su.avatar_config AS student_avatar_config
     FROM online_games g
     JOIN users au ON au.id = g.admin_id
     JOIN users su ON su.id = g.student_id
     WHERE g.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

function parsePgn(pgn) {
  const g = new Chess();
  try {
    g.loadPgn(pgn || '', { strict: false });
  } catch (err) {
    /* keep starting position */
  }
  return g;
}

function clockState(row) {
  const base = (Number(row.time_base_minutes) || 5) * 60000;
  let whiteMs = Number(row.white_ms) || base;
  let blackMs = Number(row.black_ms) || base;
  const g = parsePgn(row.pgn);
  const turn = g.turn() === 'w' ? 'white' : 'black';
  if (row.status === 'active') {
    const elapsed = Math.max(0, nowMs() - rowMs(row.updated_at));
    if (turn === 'white') whiteMs = Math.max(0, whiteMs - elapsed);
    else blackMs = Math.max(0, blackMs - elapsed);
  }
  return {
    whiteMs,
    blackMs,
    turn,
    startedAt: row.updated_at,
    baseMinutes: Number(row.time_base_minutes) || 5,
    incrementSeconds: Number(row.time_increment_seconds) || 0,
  };
}

// Build a view of a match for a given viewer ({ role, id }).
// The creator is stored in admin_id, the opponent in student_id — regardless of role.
function playerProfile(row, side) {
  const id = side === 'admin' ? row.admin_id : row.student_id;
  const name = side === 'admin' ? row.admin_name : row.student_name;
  if (id == null || !name) return null;
  return {
    id,
    name,
    profile_image: (side === 'admin' ? row.admin_profile_image : row.student_profile_image) || null,
    avatar_config: (side === 'admin' ? row.admin_avatar_config : row.student_avatar_config) || null,
  };
}

function payload(row, viewerRole, viewerId) {
  const isCreator = row.admin_id === viewerId;
  const myColor = isCreator ? row.admin_color : row.admin_color === 'white' ? 'black' : 'white';
  const opponentColor = isCreator ? (row.admin_color === 'white' ? 'black' : 'white') : row.admin_color;
  const g = parsePgn(row.pgn);
  const history = g.history();
  const clock = clockState(row);
  return {
    id: row.id,
    classId: row.class_id ?? null,
    status: row.status,
    result: row.result,
    resultReason: row.result_reason || null,
    isBot: Boolean(row.is_bot),
    botLevel: Number(row.bot_level) || 6,
    botColor: row.bot_color || null,
    adminColor: row.admin_color,
    myColor,
    opponentColor,
    // The participant this payload is scoped to, so clients can reliably pick
    // their own perspective (a user's stored position can differ from their role).
    meId: viewerId,
    myName: isCreator ? row.admin_name : row.student_name,
    /* The player rows render a picture per side, scoped to the viewer: my photo
       next to my colour, the opponent's next to theirs. A bot has no account to
       photograph, so `opponentProfile` stays null and the UI draws its default. */
    myProfile: playerProfile(row, isCreator ? 'admin' : 'student'),
    opponentProfile: row.is_bot ? null : playerProfile(row, isCreator ? 'student' : 'admin'),
    opponentId: isCreator ? row.student_id : row.admin_id,
    canAccept: row.status === 'pending' && row.student_id === viewerId,
    canAbort: row.status === 'pending' && row.admin_id === viewerId,
    myRole: viewerRole,
    fen: g.fen(),
    pgn: row.pgn || '',
    moves: history,
    turn: g.turn() === 'w' ? 'white' : 'black',
    // Computer games: the opponent is the engine, never the instructor account.
    opponentName: row.is_bot
      ? '🤖 Computer'
      : (isCreator ? row.student_name : row.admin_name),
    clock,
    serverNow: nowMs(),
    lastReaction: row.last_react_at
      ? {
          emoji: row.last_react_emoji,
          name: row.last_react_by === viewerId ? null : row.last_react_by === row.admin_id ? row.admin_name : row.student_name,
          at: rowMs(row.last_react_at),
          mine: row.last_react_by === viewerId,
        }
      : null,
    /* Pending draw offer, or null. `mine` is the whole point of sending it: the
       same row describes "I offered, waiting" and "they offered, answer me", and
       only the viewer knows which. Without it the client has to guess from the
       name, which is exactly the kind of inference that gets a player to accept
       their own offer. */
    drawOffer: row.draw_offered_by
      ? {
          by: row.draw_offered_by,
          byName: row.draw_offered_by === row.admin_id ? row.admin_name : row.student_name,
          at: row.draw_offered_at ? rowMs(row.draw_offered_at) : null,
          mine: row.draw_offered_by === viewerId,
        }
      : null,
    updatedAt: row.updated_at,
  };
}

// Neutral, role-agnostic view of a match — used by spectators (both players +
// live position + clocks + result). Shared shape with computer-game sessions.
function spectatePayload(row) {
  const g = parsePgn(row.pgn);
  const history = g.history();
  const clock = clockState(row);
  // Computer games: the engine takes the admin/grey side — label it as such
  // instead of the instructor's account name.
  const whiteName = row.is_bot && row.admin_color === 'white'
    ? '🤖 Computer'
    : (row.admin_color === 'white' ? row.admin_name : row.student_name);
  const blackName = row.is_bot && row.admin_color === 'black'
    ? '🤖 Computer'
    : (row.admin_color === 'white' ? row.student_name : row.admin_name);
  /* Ratings ride along only when the rows that came back actually carried
     them (the live list joins `students`). Coaches and other non-student
     accounts have no rating, so those cards simply omit it. */
  const adminRating = row.admin_rating ?? null;
  const studentRating = row.student_rating ?? null;
  return {
    type: 'online',
    gameId: row.id,
    classId: row.class_id ?? null,
    whiteId: row.admin_color === 'white' ? row.admin_id : row.student_id,
    blackId: row.admin_color === 'white' ? row.student_id : row.admin_id,
    whiteName,
    blackName,
    whiteRating: row.admin_color === 'white' ? adminRating : studentRating,
    blackRating: row.admin_color === 'white' ? studentRating : adminRating,
    fen: g.fen(),
    pgn: row.pgn || '',
    moves: history,
    turn: g.turn() === 'w' ? 'white' : 'black',
    clock,
    clockState: clock,
    status: row.status,
    result: row.result,
    resultReason: row.result_reason || null,
    baseMinutes: Number(row.time_base_minutes) || 5,
    incrementSeconds: Number(row.time_increment_seconds) || 0,
    serverNow: nowMs(),
    updatedMs: rowMs(row.updated_at),
  };
}

/* Did this user already finish their own game in the class? Drives the
   spectator gates. Any still-active own game means "not finished", regardless
   of an earlier finished one — a student who has been paired into a new round
   must not keep watching classmates while they themselves are playing. */
async function ownClassGameFinished(classId, userId) {
  const r = await db.query(
    `SELECT status FROM online_games
     WHERE class_id = $1 AND (admin_id = $2 OR student_id = $2)
       AND status IN ('active', 'finished')`,
    [classId, userId]
  );
  if (r.rows.length === 0) return false;
  return r.rows.every((row) => row.status === 'finished');
}

async function listFor(userId) {
  const r = await db.query(
    `SELECT g.*, au.name AS admin_name, su.name AS student_name
     FROM online_games g
     JOIN users au ON au.id = g.admin_id
     JOIN users su ON su.id = g.student_id
     WHERE g.admin_id = $1 OR g.student_id = $1
     ORDER BY g.created_at DESC
     LIMIT 30`,
    [userId]
  );
  return r.rows;
}

// All users eligible to play against.
exports.listUsers = async (req, res) => {
  try {
    // Flag who is currently online (active socket) so the picker can show a
    // green dot — offline players stay selectable, they just can't be pinged live.
    const io = req.app.get('io');
    const onlineIds = new Set();
    if (io) {
      try {
        const sockets = await io.fetchSockets();
        for (const sock of sockets) {
          if (sock.user && sock.user.id != null) onlineIds.add(sock.user.id);
        }
      } catch (e) {
        console.warn('[online users] could not fetch sockets', e.message);
      }
    }

    // The picker renders a card per player: the same photo/avatar the profile
    // page uses, plus the per time-class rating the match will be played under.
    // One LEFT JOIN per pool keeps the row unique (student_time_ratings is
    // UNIQUE on student_id + time_class).
    const r = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.profile_image, u.avatar_config,
              rt_b.rating  AS bullet_rating,
              rt_bl.rating AS blitz_rating,
              rt_r.rating  AS rapid_rating,
              rt_c.rating  AS classical_rating
         FROM users u
         LEFT JOIN students s ON s.user_id = u.id
         LEFT JOIN student_time_ratings rt_b  ON rt_b.student_id = s.id AND rt_b.time_class = 'bullet'
         LEFT JOIN student_time_ratings rt_bl ON rt_bl.student_id = s.id AND rt_bl.time_class = 'blitz'
         LEFT JOIN student_time_ratings rt_r  ON rt_r.student_id = s.id AND rt_r.time_class = 'rapid'
         LEFT JOIN student_time_ratings rt_c  ON rt_c.student_id = s.id AND rt_c.time_class = 'classical'
        WHERE u.id <> $1
        ORDER BY u.name ASC`,
      [req.user.id]
    );
    res.json(
      r.rows
        .map((u) => ({ ...u, online: onlineIds.has(u.id) }))
        .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name))
    );
  } catch (err) {
    res.status(500).json({ message: 'Failed to list users', error: err.message });
  }
};

// List matches I'm part of.
exports.listGames = async (req, res) => {
  try {
    const rows = await listFor(req.user.id);
    res.json(rows.map((row) => payload(row, req.user.role, req.user.id)));
  } catch (err) {
    res.status(500).json({ message: 'Failed to list matches', error: err.message });
  }
};

// Every currently-watchable game: active online matches (server) + computer
// sessions announced by students' browsers (in-memory). Any logged-in user can
// spectate any of these.
exports.listLive = async (req, res) => {
  try {
    const classId = req.query.classId ? parseInt(req.query.classId, 10) : null;
    /* A class-scoped request from a student who is NOT yet allowed to spectate
       (own game still running, or the coach switched watching off) is narrowed
       to their OWN rows. The student player board calls this same endpoint to
       discover the pairing it must open, so it cannot be blocked outright — but
       it must not double as a way to read classmates' positions through the
       summary feed. Instructors and finished students get the whole class. */
    let restrictToSelf = false;
    if (classId) {
      const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
      const classRow = classRes.rows[0];
      if (classRow) {
        const ownGameFinished = await ownClassGameFinished(classId, req.user.id);
        const decision = canSpectateClass({
          viewer: { id: req.user.id, role: req.user.role },
          classRow,
          ownGameFinished,
        });
        restrictToSelf = !decision.allowed;
      }
    }
    /* Class-scoped requests also keep just-finished games for a short window so
       the instructor's live PvP grid shows the RESULT ("White wins" / "Draw")
       instead of the board silently vanishing the moment it ends. The global
       feed stays active-only to avoid clutter. */
    const onlineRes = await db.query(
      `SELECT g.*, au.name AS admin_name, su.name AS student_name,
              ast.current_rating AS admin_rating, sst.current_rating AS student_rating
       FROM online_games g
       JOIN users au ON au.id = g.admin_id
       JOIN users su ON su.id = g.student_id
       LEFT JOIN students ast ON ast.user_id = g.admin_id
       LEFT JOIN students sst ON sst.user_id = g.student_id
       WHERE ${
         classId
           ? `g.class_id = $1 AND (g.status = 'active'
                OR (g.status = 'finished' AND g.updated_at > NOW() - INTERVAL '3 minutes'))${
                  restrictToSelf ? ' AND (g.admin_id = $2 OR g.student_id = $2)' : ''
                }`
           : `g.status = 'active'`
       }
       ORDER BY g.updated_at DESC
       LIMIT 30`,
      classId ? (restrictToSelf ? [classId, req.user.id] : [classId]) : undefined
    );
    const spec = require('../services/specService');
    // Computer sessions announced by students' browsers are kept for the global
    // feed only; a class-scoped request shows exactly that class's PvP games.
    const liveSessions = classId ? [] : spec.list();
    const sessions = [
      ...onlineRes.rows.map(spectatePayload),
      ...liveSessions,
    ];
    sessions.sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list live games', error: err.message });
  }
};

// Open a neutral spectator view of an active online match. Non-class games may
// be watched by anyone signed in; a class game is gated by the classroom rule
// (a student may only watch a classmate's board once their own game finished and
// the teacher left the switch on). A participant can always open their own game.
exports.spectateGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });

    if (row.class_id) {
      const isParticipant =
        Number(row.admin_id) === Number(req.user.id) || Number(row.student_id) === Number(req.user.id);
      if (!isParticipant) {
        const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [row.class_id]);
        const classRow = classRes.rows[0] || null;
        const ownGameFinished = await ownClassGameFinished(row.class_id, req.user.id);
        const decision = canSpectateGame({
          viewer: { id: req.user.id, role: req.user.role },
          gameRow: row,
          classRow,
          ownGameFinished,
        });
        if (!decision.allowed) {
          return res.status(403).json({
            message: decision.reason === 'disabled'
              ? 'Your coach has turned off watching classmates'
              : 'Finish your own game before watching classmates',
            reason: decision.reason,
          });
        }
      }
    }

    if (row.status !== 'active') return res.status(400).json({ message: 'Match is not in progress' });
    res.json(spectatePayload(row));
  } catch (err) {
    res.status(500).json({ message: 'Failed to load match', error: err.message });
  }
};

/* "Watch classmates": the other students' boards in this live class, for a
   student who has finished their own game. Returns the same neutral spectator
   shape as listLive (live boards + a short window of just-finished results) so
   the client can render thumbnail cards. The canSpectateClass gate is enforced
   here, on the socket `join-game`, and on GET /online/games/:id/spectate — so the
   anti-cheat rule cannot be bypassed by hitting a different endpoint. */
exports.watchClassmates = async (req, res) => {
  try {
    const classId = parseInt(req.params.id, 10);
    if (!Number.isInteger(classId)) return res.status(400).json({ message: 'Bad class id' });
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass(
      { userId: req.user.id, userRole: req.user.role },
      classRow
    );
    if (!access.authorized) return res.status(403).json({ message: 'You are not in this class' });

    const ownGameFinished = await ownClassGameFinished(classId, req.user.id);
    const decision = canSpectateClass({
      viewer: { id: req.user.id, role: req.user.role },
      classRow,
      ownGameFinished,
    });
    if (!decision.allowed) {
      return res.status(403).json({
        message: decision.reason === 'disabled'
          ? 'Your coach has turned off watching classmates'
          : 'Finish your own game before watching classmates',
        reason: decision.reason,
      });
    }

    /* Other students' games only — never the viewer's own board. Just-finished
       games stay listed for a short window so their result card does not vanish
       the instant it ends. */
    const gamesRes = await db.query(
      `SELECT g.*, au.name AS admin_name, su.name AS student_name
       FROM online_games g
       JOIN users au ON au.id = g.admin_id
       JOIN users su ON su.id = g.student_id
       WHERE g.class_id = $1
         AND g.admin_id <> $2 AND g.student_id <> $2
         AND (g.status = 'active'
              OR (g.status = 'finished' AND g.updated_at > NOW() - INTERVAL '3 minutes'))
       ORDER BY g.updated_at DESC
       LIMIT 30`,
      [classId, req.user.id]
    );
    const sessions = gamesRes.rows.map(spectatePayload);
    sessions.sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0));

    res.json({
      classId: classId,
      spectateEnabled: classRow.spectate_enabled !== false,
      ownGameFinished,
      sessions,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to list classmates', error: err.message });
  }
};

// Any logged-in user (admin or student) creates a match against a chosen user.
exports.createGame = async (req, res) => {
  try {
    const { studentId, adminColor, timeControl } = req.body;
    const color = adminColor === 'black' ? 'black' : 'white';
    if (!studentId) return res.status(400).json({ message: 'Choose a player to play against' });
    if (Number(studentId) === req.user.id) {
      return res.status(400).json({ message: 'Pick someone else — you cannot play yourself' });
    }
    const target = await db.query('SELECT id FROM users WHERE id = $1', [studentId]);
    if (target.rows.length === 0) return res.status(404).json({ message: 'Player not found' });

    /* 360 = the picker's largest clock (5 h + 60 min). The old 60 ceiling
       silently turned every 2 h–6 h challenge into a 1 h game. */
    const baseMin = Math.max(1, Math.min(360, Number(timeControl?.baseMinutes) || 5));
    const incSec = Math.max(0, Math.min(60, Number(timeControl?.incrementSeconds) || 0));
    const startMs = baseMin * 60000;

    const result = await db.query(
      `INSERT INTO online_games (admin_id, student_id, admin_color, fen, pgn, status,
         time_base_minutes, time_increment_seconds, white_ms, black_ms)
       VALUES ($1, $2, $3, $4, '', 'pending', $5, $6, $7, $7)
       RETURNING id`,
      [req.user.id, studentId, color, START_FEN, baseMin, incSec, startMs]
    );
    const row = await getGameRow(result.rows[0].id);

    // Notify the invited player in real time (they must be online).
    const io = req.app.get('io');
    emitToUser(io, Number(studentId), 'game-invite', {
      game: payload(row, 'student', Number(studentId)),
      from: {
        id: req.user.id,
        name: req.user.name || row.admin_name,
      },
      timeLabel: `${baseMin}+${incSec}`,
    });

    // Match-request notifications. The RECEIVER gets the actionable card
    // ("[Sender] sent you a match request") with Accept/Decline; the SENDER
    // gets a tracking card that shows "Request sent — Pending", never actions.
    const senderName = req.user.name || row.admin_name;
    const receiverName = row.student_name || 'your opponent';
    await notif.push(
      io,
      Number(studentId),
      'New match request',
      `${senderName} sent you a match request`,
      { type: 'match_request', senderId: req.user.id, relatedId: row.id, requestStatus: 'pending' }
    );
    await notif.push(
      io,
      req.user.id,
      'Match request sent',
      `You sent ${receiverName} a match request`,
      { type: 'match_request', senderId: req.user.id, relatedId: row.id, requestStatus: 'pending' }
    );

    res.status(201).json(payload(row, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to create match', error: err.message });
  }
};

// Instructor-started "Player vs Player" games inside a live classroom. Unlike
// the normal challenge flow (pending → accept), every pairing here is created
// already-started with the instructor's chosen time control and fixed White /
// Black. Each game is tagged with the class_id so the classroom's live
// spectator grid can list exactly this class's boards, and both students are
// pushed their game payload in real time (the Play Arena auto-opens it).
exports.createClassroomGames = async (req, res) => {
  try {
    const classId = parseInt(req.body?.classId, 10);
    const timeControl = req.body?.timeControl || {};
    const pairings = Array.isArray(req.body?.pairings) ? req.body.pairings : [];
    if (!Number.isInteger(classId)) return res.status(400).json({ message: 'Class is required' });

    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRes.rows[0]);
    if (!access.authorized || !access.isInstructor) {
      return res.status(403).json({ message: 'Only the instructor can pair students' });
    }

    // Keep only complete, non-self pairings.
    const clean = pairings
      .filter((p) => p && p.whiteId && p.blackId)
      .map((p) => ({ whiteId: Number(p.whiteId), blackId: Number(p.blackId) }))
      .filter((p) => Number.isInteger(p.whiteId) && Number.isInteger(p.blackId) && p.whiteId !== p.blackId);
    if (clean.length === 0) {
      return res.status(400).json({ message: 'Add at least one complete pairing (White vs Black)' });
    }

    // No student may appear in more than one pairing.
    const seen = new Set();
    for (const p of clean) {
      if (seen.has(p.whiteId) || seen.has(p.blackId)) {
        return res.status(400).json({ message: 'A student can only be in one pairing' });
      }
      seen.add(p.whiteId);
      seen.add(p.blackId);
    }

    // Every paired player must be a student account.
    const ids = [...seen];
    const membersRes = await db.query(
      `SELECT u.id FROM users u JOIN students st ON st.user_id = u.id
       WHERE u.id = ANY($1::int[])`,
      [ids]
    );
    if (membersRes.rows.length !== ids.length) {
      return res.status(400).json({ message: 'All paired players must be students in this class' });
    }

    const baseMin = Math.max(1, Math.min(120, Number(timeControl?.baseMinutes) || 5));
    const incSec = Math.max(0, Math.min(60, Number(timeControl?.incrementSeconds) || 0));
    const startMs = baseMin * 60000;

    const io = req.app.get('io');
    const created = [];

    for (const p of clean) {
      const r = await db.query(
        `INSERT INTO online_games (admin_id, student_id, admin_color, fen, pgn, status,
           time_base_minutes, time_increment_seconds, white_ms, black_ms, class_id)
         VALUES ($1, $2, 'white', $3, '', 'active', $4, $5, $6, $6, $7)
         RETURNING id`,
        [p.whiteId, p.blackId, START_FEN, baseMin, incSec, startMs, classId]
      );
      const row = await getGameRow(r.rows[0].id);
      if (!row) continue;

      const forAdmin = payload(row, 'admin', row.admin_id);
      const forStudent = payload(row, 'student', row.student_id);
      const forSpectator = spectatePayload(row);
      const wrapped = { forAdmin, forStudent, forSpectator };
      if (io) {
        io.to(`game:${row.id}`).emit('game-update', wrapped);
        emitToUser(io, row.admin_id, 'game-update', wrapped);
        emitToUser(io, row.student_id, 'game-update', wrapped);
        // Targeted "you have been paired" notice straight to each student so
        // their classroom can toast it and open their playable board.
        emitToUser(io, row.admin_id, 'pvp-started', {
          classId, gameId: row.id,
          myColor: 'white', opponentName: row.student_name,
          baseMinutes: baseMin, incrementSeconds: incSec,
        });
        emitToUser(io, row.student_id, 'pvp-started', {
          classId, gameId: row.id,
          myColor: 'black', opponentName: row.admin_name,
          baseMinutes: baseMin, incrementSeconds: incSec,
        });
        /* A new round means neither player may keep watching classmates; tell
           any open "Watch classmates" view to close (the gates would refuse the
           next join anyway, but closing the live view is the honest signal). */
        emitToUser(io, row.admin_id, 'spectate_closed', { classId });
        emitToUser(io, row.student_id, 'spectate_closed', { classId });
      }
      created.push(forSpectator);
    }

    // Tell the whole classroom that games just started so the live grid refreshes.
    if (io && created.length > 0) {
      io.to(`live-class:${classId}`).emit('pvp-pairing', {
        classId,
        games: created,
        timeControl: { baseMinutes: baseMin, incrementSeconds: incSec },
      });
    }

    res.status(201).json({ games: created, timeControl: { baseMinutes: baseMin, incrementSeconds: incSec } });
  } catch (err) {
    res.status(500).json({ message: 'Failed to start classroom games', error: err.message });
  }
};

// Instructor-started "Computer vs Students" inside a live classroom. Unlike the
// shared-board computer speedrun, every selected student gets their OWN,
// separate online_games row (is_bot = true) so each student plays the bot on
// their individual PvP board — never on the shared main board. The instructor
// is stored as the row's creator (admin_id) and drives the bot side from their
// browser; each game is tagged with class_id so the instructor's live watch
// grid lists exactly this class's computer boards, and every student gets a
// targeted pvp-started notice that auto-opens their own playable board.
exports.createClassroomBotGames = async (req, res) => {
  try {
    const classId = parseInt(req.body?.classId, 10);
    const timeControl = req.body?.timeControl || {};
    const studentIds = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds.map((id) => Number(id)).filter(Number.isInteger)
      : [];
    const botColor = req.body?.botColor === 'black' ? 'black' : 'white';
    const botLevel = Math.max(1, Math.min(40, Number(req.body?.botLevel) || 12));
    // Start-from-current-board-position: accept the instructor's shared-board FEN
    // and PGN so every student game begins where the class left off.
    let startFen = START_FEN;
    let startPgn = '';
    if (typeof req.body?.fen === 'string' && req.body.fen.trim()) {
      try {
        // chess.js throws on malformed FEN, so a successful construction is the
        // validity check; re-serialize to normalise whitespace/case.
        const probe = new Chess(req.body.fen.trim());
        startFen = probe.fen();
        startPgn = typeof req.body?.pgn === 'string' ? req.body.pgn : '';
      } catch (err) {
        /* fall back to starting position if the FEN is unparsable */
      }
    }
    if (!Number.isInteger(classId)) return res.status(400).json({ message: 'Class is required' });
    if (studentIds.length === 0) return res.status(400).json({ message: 'Pick at least one student to play the computer' });

    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRes.rows[0]);
    if (!access.authorized || !access.isInstructor) {
      return res.status(403).json({ message: 'Only the instructor can start computer games' });
    }

    // Every selected student must be a student account.
    const membersRes = await db.query(
      `SELECT u.id FROM users u JOIN students st ON st.user_id = u.id
       WHERE u.id = ANY($1::int[])`,
      [studentIds]
    );
    if (membersRes.rows.length !== studentIds.length) {
      return res.status(400).json({ message: 'All selected students must be students' });
    }

    // Unlimited: give a huge-but-finite base (9999 min) so the GameClock never
    // depletes mid-game, while still fitting int4 ms columns. Skipping the 1..120
    // clamp keeps "unlimited" distinct from the normal max.
    const unlimited = Boolean(req.body?.timeControl?.unlimited) || Boolean(req.body?.unlimited);
    const baseMin = unlimited ? 9999 : Math.max(1, Math.min(120, Number(timeControl?.baseMinutes) || 5));
    const incSec = Math.max(0, Math.min(60, Number(timeControl?.incrementSeconds) || 0));
    const startMs = baseMin * 60000;
    const io = req.app.get('io');
    const created = [];

    for (const studentId of studentIds) {
      const r = await db.query(
        `INSERT INTO online_games (admin_id, student_id, admin_color, fen, pgn, status,
           time_base_minutes, time_increment_seconds, white_ms, black_ms, class_id,
           is_bot, bot_level, bot_color)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $8, $9, true, $10, $3)
         RETURNING id`,
        [req.user.id, studentId, botColor, startFen, startPgn, baseMin, incSec, startMs, classId, botLevel]
      );
      const row = await getGameRow(r.rows[0].id);
      if (!row) continue;

      const forAdmin = payload(row, 'admin', row.admin_id);
      const forStudent = payload(row, 'student', row.student_id);
      const forSpectator = spectatePayload(row);
      const wrapped = { forAdmin, forStudent, forSpectator };
      if (io) {
        io.to(`game:${row.id}`).emit('game-update', wrapped);
        emitToUser(io, row.admin_id, 'game-update', wrapped);
        emitToUser(io, row.student_id, 'game-update', wrapped);
        // "Your individual computer game is ready" right to the student so their
        // classroom auto-opens their own vs-Computer board (separate game).
        emitToUser(io, row.student_id, 'pvp-started', {
          classId, gameId: row.id,
          myColor: row.admin_color === 'white' ? 'black' : 'white',
          opponentName: '🤖 Computer',
          baseMinutes: baseMin, incrementSeconds: incSec,
          isBot: true,
        });
        /* New round → close any open "Watch classmates" view for this student. */
        emitToUser(io, row.student_id, 'spectate_closed', { classId });
      }
      created.push(forSpectator);
    }

    // Tell the whole classroom so the live (watch-all) grid refreshes with the
    // new Computer vs Student boards.
    if (io && created.length > 0) {
      io.to(`live-class:${classId}`).emit('pvp-pairing', {
        classId,
        games: created,
        timeControl: { baseMinutes: baseMin, incrementSeconds: incSec },
      });
    }

    res.status(201).json({ games: created, timeControl: { baseMinutes: baseMin, incrementSeconds: incSec } });
  } catch (err) {
    res.status(500).json({ message: 'Failed to start computer games', error: err.message });
  }
};

// MY OWN rating change for one finished match.
//
// Deliberately participant-only and deliberately one-sided: it returns the
// caller's own row and nothing about the opponent's. The game screen needs "you
// gained 12" after a rated game, and that must not be readable as "your opponent
// gained 12" - which rules out putting the delta in payload(), since
// emitGameUpdate broadcasts both sides' payloads to both sockets.
//
// `rated: false` is a real, expected answer, not an error:
//   - bot games (row.is_bot) are never rated, by design
//   - practice mode (a coach/admin in the match) is never rated
//   - abandoned / aborted results are never rated
//   - a bot game that has not finished yet has no row to find
exports.getRatingResult = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    if (row.status !== 'finished') {
      return res.json({ rated: false, reason: 'in_progress' });
    }
    if (row.is_bot) {
      return res.json({ rated: false, reason: 'bot_game' });
    }
    if (!['white', 'black', 'draw'].includes(row.result)) {
      return res.json({ rated: false, reason: 'no_result' });
    }

    /* Resolve the caller to a student row. A coach/admin playing for practice
       has no student record, which is exactly why the game was unrated. */
    const me = await db.query(
      `SELECT s.id FROM students s WHERE s.user_id = $1`,
      [req.user.id]
    );
    if (!me.rows.length) {
      return res.json({ rated: false, reason: 'practice_mode' });
    }

    /* Both players write a row for this game. Fetch BOTH and split them by
       `is_me`, so the result card can show each player's rating move.

       Returning the opponent's delta is deliberate and safe here: both callers
       are verified participants of THIS match (checked above), a 1v1 result is
       already public to both of them, and the result card is meaningless with
       only one side of it. The scoping that still matters — never broadcasting
       a delta inside `emitGameUpdate`, which reaches sockets outside this match
       — is unchanged. */
    const hist = await db.query(
      `SELECT rh.rating_before, rh.rating_after, rh.rating_change,
              rh.result, rh.time_control, rh.time_class, rh.played_at, rh.student_id,
              rh.opponent_name,
              (rh.student_id = $2) AS is_me
         FROM rating_history rh
        WHERE rh.online_game_id = $1
        LIMIT 2`,
      [row.id, me.rows[0].id]
    );
    if (!hist.rows.length) {
      /* The game finished but no row was written - an unrated pairing, or the
         rating update failed (it is wrapped so it can never break the game). */
      return res.json({ rated: false, reason: 'unrated' });
    }

    /* The authoritative category for THIS game.

       Derived from the game's own persisted time_base_minutes via the single
       canonical classifier (ratingService.classifyTimeControl) - the same
       function that selected the rating pool when the game was rated. Rows
       written before `time_class` existed fall back to the stored label, so old
       games still report a category instead of nothing.

       The card consumes this rather than re-deriving a category from its own
       state, which is what let a Blitz game display as Rapid: the frontend had
       no authoritative category to read and nothing stopped it defaulting. */
    const storedClass = hist.rows.find((h) => h.is_me)?.time_class
      || hist.rows[0].time_class;
    const timeClass = rating.classifyTimeControl(row.time_base_minutes) || storedClass || null;

    /* The pool move this game caused, when one was recorded. Lets the card show
       the rating the player is actually climbing in the category they played,
       instead of only the overall number. */
    const poolRows = await db.query(
      `SELECT student_id, time_class, rating_before, rating_after, rating_change
         FROM time_control_rating_history
        WHERE online_game_id = $1`,
      [row.id],
    );
    const poolShape = (h) => ({
      timeClass: h.time_class,
      ratingBefore: h.rating_before,
      ratingAfter: h.rating_after,
      ratingChange: h.rating_change,
    });

    const shape = (h) => ({
      ratingBefore: h.rating_before,
      ratingAfter: h.rating_after,
      ratingChange: h.rating_change,
      result: h.result,
      /* Display label, kept for backwards compatibility. */
      timeControl: h.time_control || null,
      /* Canonical category key + label. */
      timeClass,
      timeClassLabel: rating.timeClassLabel(timeClass),
      playedAt: h.played_at,
    });

    const own = hist.rows.find((h) => h.is_me) || hist.rows[0];
    const opp = hist.rows.find((h) => !h.is_me) || null;

    /* Each player's pool move for this game, keyed by student. */
    const poolFor = (sid) => {
      const h = poolRows.rows.find((p) => p.student_id === sid);
      return h ? poolShape(h) : null;
    };
    const myStudentId = me.rows[0].id;
    const oppStudentId = opp ? opp.student_id : null;

    /* Which side each player sat on, and what each side is called.
       NOT derived from `rating_history.result`: that column is the player's
       OUTCOME ('win' | 'draw' | 'loss'), not a colour, so testing it against
       'white'/'black' silently yielded null for every game. The colour lives on
       the game row instead — `admin_color` is the ADMIN's side, so the other
       participant's is its opposite. Same derivation as `payload()` and
       gameHistoryController, so the three can never disagree about who was White. */
    const iAmAdmin = row.admin_id === req.user.id;
    const myColor = iAmAdmin
      ? row.admin_color
      : (row.admin_color === 'white' ? 'black' : 'white');
    const opponentColor = myColor === 'white' ? 'black' : 'white';

    /* Names resolved BY COLOUR rather than by admin/student, because the caller
       may be either participant. `admin_name`/`student_name` are the two players
       (the column names are historical — "admin" just means the challenger).

       `myName` is the caller's own name, and `opponentName` the other player's,
       both taken from the game row so they cannot depend on a caller that never
       opens the app to see it. This replaces an earlier single top-level
       `opponentName` field: the UI consumed it as the caller's own label and
       both rows rendered the opponent's name. A field whose name does not say
       whose it is will be misused, so the two names are now explicit. */
    const adminIsWhite = row.admin_color === 'white';
    const whiteName = adminIsWhite ? row.admin_name : row.student_name;
    const blackName = adminIsWhite ? row.student_name : row.admin_name;
    const myName = (myColor === 'white' ? whiteName : blackName) || null;
    const opponentName = (myColor === 'white' ? blackName : whiteName) || null;

    return res.json({
      rated: true,
      ...shape(own),
      /* The caller's own name, so the card never has to guess it. */
      myName,
      /* The rating the caller actually climbed in the category they played.
         Null when this game did not move a pool (unrated, or a game with no
         recognisable time control). */
      timeControlChange: poolFor(myStudentId),
      opponentTimeControlChange: oppStudentId ? poolFor(oppStudentId) : null,
      /* The opponent's move, when the match was rated on both sides. Absent for
         an unrated opponent (e.g. a coach in practice mode), so the UI can omit
         that row rather than print a misleading zero. */
      opponent: opp
        ? {
            ...shape(opp),
            /* The game row's name wins: it always names BOTH participants and so
               cannot collapse to a single player. `own.opponent_name` is only a
               last-resort fallback — it is read off the CALLER'S OWN row (each
               row names the player ITS OWNER faced), is null on rows written
               before the column existed, and is a snapshot taken at rating time,
               so it can be stale. Reading it off the OPPONENT's row instead is
               what printed one player's name on both rating rows. */
            name: opponentName || own.opponent_name || null,
          }
        : null,
      myColor,
      opponentColor,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch rating result', error: err.message });
  }
};

// Fetch one match, if I'm a participant.
exports.getGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    res.json(payload(row, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch match', error: err.message });
  }
};

// Opponent accepts a pending challenge.
exports.acceptGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.student_id !== req.user.id) return res.status(403).json({ message: 'This challenge is not for you' });
    const wasPending = row.status === 'pending';
    if (wasPending) {
      await db.query(
        "UPDATE online_games SET status = 'active', updated_at = NOW() WHERE id = $1",
        [row.id]
      );
      row.status = 'active';
    }
    if (wasPending) {
      // Resolve the request notification on both sides. The receiver's card
      // shows "Accepted"; the sender is notified "[Receiver] accepted your
      // match request" and their card flips to Accepted too.
      const io = req.app.get('io');
      const receiverRows = await notif.setRequestStatus({ relatedId: row.id, userId: row.student_id, requestStatus: 'accepted', isRead: true });
      receiverRows.forEach((n) => notif.emitToUser(io, row.student_id, 'notification', n));
      const senderRows = await notif.setRequestStatus({ relatedId: row.id, userId: row.admin_id, requestStatus: 'accepted', message: `${row.student_name} accepted your match request`, isRead: false });
      senderRows.forEach((n) => notif.emitToUser(io, row.admin_id, 'notification', n));
    }
    emitGameUpdate(req, row.id);
    res.json(payload(row, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to accept match', error: err.message });
  }
};

// Opponent declines a pending challenge (the request is resolved and closed).
exports.declineGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.student_id !== req.user.id) return res.status(403).json({ message: 'This challenge is not for you' });
    if (row.status !== 'pending') return res.status(409).json({ message: 'This match request has already been resolved' });
    await db.query(
      "UPDATE online_games SET status = 'declined', updated_at = NOW() WHERE id = $1",
      [row.id]
    );
    row.status = 'declined';

    // Receiver's card flips to "Declined" (buttons replaced by the label).
    const io = req.app.get('io');
    const receiverRows = await notif.setRequestStatus({ relatedId: row.id, userId: row.student_id, requestStatus: 'declined', isRead: true });
    receiverRows.forEach((n) => notif.emitToUser(io, row.student_id, 'notification', n));
    // Inform the sender without a second row — their tracking card updates instead.
    const senderRows = await notif.setRequestStatus({ relatedId: row.id, userId: row.admin_id, requestStatus: 'declined', message: `${row.student_name} declined your match request`, isRead: false });
    senderRows.forEach((n) => notif.emitToUser(io, row.admin_id, 'notification', n));

    // Dedicated, TARGETED real-time push to the original sender's room only
    // (never a broadcast, never the decliner). Carries the full payload so the
    // sender's client can toast + flip state instantly without a re-fetch.
    notif.emitToUser(io, row.admin_id, 'match-declined', {
      requestId: row.id,
      gameId: row.id,
      senderId: row.admin_id,
      declinerId: row.student_id,
      declinerName: row.student_name,
      message: `${row.student_name} declined your match request`,
    });

    emitGameUpdate(req, row.id);
    res.json(payload(row, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to decline match', error: err.message });
  }
};

// Creator aborts a pending challenge (it never started).
exports.abortGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    if (row.status === 'pending') {
      /* Unstarted challenges stay creator-only: the invitee answers with
         accept/decline, they don't abort someone else's invitation. */
      if (row.admin_id !== req.user.id) {
        return res.status(403).json({ message: 'Only the creator can abort this match' });
      }
      await db.query(
        "UPDATE online_games SET status = 'aborted', updated_at = NOW() WHERE id = $1",
        [row.id]
      );
      row.status = 'aborted';
      // Close the request notifications so the receiver sees "Cancelled" and
      // the sender's tracking card stops showing "Pending".
      const io = req.app.get('io');
      const creatorRows = await notif.setRequestStatus({ relatedId: row.id, userId: row.admin_id, requestStatus: 'cancelled', isRead: true });
      creatorRows.forEach((n) => notif.emitToUser(io, row.admin_id, 'notification', n));
      const receiverRows = await notif.setRequestStatus({ relatedId: row.id, userId: row.student_id, requestStatus: 'cancelled', message: `${row.admin_name} cancelled the match request`, isRead: false });
      receiverRows.forEach((n) => notif.emitToUser(io, row.student_id, 'notification', n));
      emitGameUpdate(req, row.id);
      return res.json(payload(row, req.user.role, req.user.id));
    }
    /* Aborting a STARTED game: allowed only in the starting position, before
       both players have made their first move (< 2 half-moves) — the standard
       abort rule. Either participant may call it (classroom pairings have no
       instructor in the game row, so creator-only would lock students out of
       fixing a mispaired board). Past that point the game has a real result
       coming and must be resigned or drawn, never vanished. */
    if (row.status !== 'active') {
      return res.status(400).json({ message: 'Match is not in progress' });
    }
    let halfMoves = 0;
    try {
      halfMoves = parsePgn(row.pgn).history().length;
    } catch {
      halfMoves = 0;
    }
    if (halfMoves >= 2) {
      return res.status(400).json({ message: 'Too late to abort — both players have moved' });
    }
    await db.query(
      `UPDATE online_games SET status = 'finished', result = 'aborted', result_reason = 'aborted',
        draw_offered_by = NULL, draw_offered_at = NULL, updated_at = NOW() WHERE id = $1`,
      [row.id]
    );
    row.status = 'finished';
    row.result = 'aborted';
    row.result_reason = 'aborted';
    /* Deliberately no rating and no analysis: an aborted game has no result to
       rate and at most one half-move to analyse. The class IS told, so the
       instructor's live grid drops the dead board immediately. */
    await notifyClassGameFinished(req, row);
    emitGameUpdate(req, row.id);
    res.json(payload(row, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to abort match', error: err.message });
  }
};

/* Can `color` still deliver checkmate with the material it has on the board?
   FIDE 6.9: a flag-fall is a DRAW, not a loss, when the player who still has
   time cannot possibly mate. Any pawn, rook or queen suffices; among the minors
   only the bishop pair, bishop+knight and three knights can construct a mate.
   A lone king, or king + a single minor, can never mate. */
function sideHasMatingMaterial(g, color) {
  const me = color === 'white' ? 'w' : 'b';
  let pawns = 0, rooks = 0, queens = 0, bishops = 0, knights = 0;
  for (const rank of g.board()) {
    for (const sq of rank) {
      if (!sq || sq.color !== me) continue;
      if (sq.type === 'p') pawns += 1;
      else if (sq.type === 'r') rooks += 1;
      else if (sq.type === 'q') queens += 1;
      else if (sq.type === 'b') bishops += 1;
      else if (sq.type === 'n') knights += 1;
    }
  }
  if (pawns || rooks || queens) return true;
  if (bishops >= 2) return true;
  if (bishops >= 1 && knights >= 1) return true;
  if (knights >= 3) return true;
  return false;
}

// Either participant resigns — the opponent wins.
exports.resignGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    if (row.status !== 'active') return res.status(400).json({ message: 'Match is not in progress' });
    const myColor = row.admin_id === req.user.id ? row.admin_color : row.admin_color === 'white' ? 'black' : 'white';
    const winner = myColor === 'white' ? 'black' : 'white';
    await db.query(
      `UPDATE online_games SET status = 'finished', result = $2, result_reason = 'resignation',
         draw_offered_by = NULL, draw_offered_at = NULL, updated_at = NOW() WHERE id = $1`,
      [row.id, winner]
    );
    row.status = 'finished';
    row.result = winner;
    row.result_reason = 'resignation';
    await applyOnlineRating(row, winner);
    await notifyClassGameFinished(req, row);
    /* Queue the background analysis. Non-blocking and failure-tolerant: the
       match is already saved and rated, and a queue that is down must not turn a
       resignation into a 500. */
    analysisHooks.onlineGameFinished(row);
    emitGameUpdate(req, row.id);
    res.json(payload(row, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to resign match', error: err.message });
  }
};

/* A participant's clock ran out and their client reports the flag fall.

   This is deliberately its own route rather than a resignation with a flag:
   inferring "timeout" from a resignation body — or from a disconnect / window
   close / whatever the board happened to look like at the end — is exactly how
   games used to be recorded as resignation when the clock was really what
   ended them. Here the REASON is explicit and the winner is derived from who
   still had time, never from the final position.

   Per FIDE 6.9 the opponent only WINS if they can still mate; otherwise the
   game is a draw (reason 'insufficient'), not a fabricated win. */
exports.timeoutGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    if (row.status !== 'active') return res.status(400).json({ message: 'Match is not in progress' });
    /* The caller is the side whose flag fell; the opponent is the side that
       still had time. */
    const flaggedColor = row.admin_id === req.user.id
      ? row.admin_color
      : row.admin_color === 'white' ? 'black' : 'white';
    const opponentColor = flaggedColor === 'white' ? 'black' : 'white';
    const g = parsePgn(row.pgn);
    const opponentCanMate = sideHasMatingMaterial(g, opponentColor);
    const result = opponentCanMate ? opponentColor : 'draw';
    const reason = opponentCanMate ? 'timeout' : 'insufficient';
    await db.query(
      `UPDATE online_games SET status = 'finished', result = $2, result_reason = $3,
         draw_offered_by = NULL, draw_offered_at = NULL, updated_at = NOW() WHERE id = $1`,
      [row.id, result, reason]
    );
    row.status = 'finished';
    row.result = result;
    row.result_reason = reason;
    await applyOnlineRating(row, result);
    await notifyClassGameFinished(req, row);
    analysisHooks.onlineGameFinished(row);
    emitGameUpdate(req, row.id);
    res.json(payload(row, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to flag match', error: err.message });
  }
};

/* Clear any pending draw offer. Called whenever the game reaches a decision —
   accepting, declining, or any finish (resignation, checkmate) — so a stale
   offer can never be answered after the game is already over. */
async function clearDrawOffer(gameId) {
  await db.query(
    'UPDATE online_games SET draw_offered_by = NULL, draw_offered_at = NULL WHERE id = $1',
    [gameId]
  );
}

/* Finish an active match as a draw by agreement, rating both players.
   Shared by respondDraw() (an explicit accept) and offerDraw() (the
   simultaneous-offer case, where offering back IS acceptance) so the finish
   sequence cannot drift between the two paths.

   `row` is the pre-update game row. */
async function finishAsAgreedDraw(req, res, row) {
  await db.query(
    `UPDATE online_games
        SET status = 'finished', result = 'draw', result_reason = 'agreement',
            draw_offered_by = NULL, draw_offered_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [row.id]
  );
  const finished = await getGameRow(row.id);
  /* An agreed draw IS a rated result (unlike the old 'abandoned'), so it goes
     through the same rating path as a resignation or a natural draw. Omitting
     this is how the old immediate-draw button left both players' ratings
     untouched. */
  await applyOnlineRating(finished, 'draw');
  await notifyClassGameFinished(req, finished);
  analysisHooks.onlineGameFinished(finished);
  emitGameUpdate(req, row.id);
  return res.json(payload(finished, req.user.role, req.user.id));
}

/* Offer a draw.
 *
 * This deliberately does NOT finish the game. A draw is an OFFER: the opponent
 * has to accept it, exactly as on a real board. The old single "Draw" button
 * called endGame(), which set status='finished' immediately — so one click ended
 * the match with the opponent never asked, and rated nobody.
 *
 * Play continues while the offer is pending; it survives moves and only ends on
 * an explicit accept, a decline, or the game finishing some other way.
 *
 * Simultaneous offers count as acceptance, which is the standard rule: if my
 * opponent has already offered and I offer back, I am agreeing to their draw.
 */
exports.offerDraw = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    if (row.status !== 'active') return res.status(400).json({ message: 'Match is not in progress' });
    /* A computer cannot accept, so offering one would hang forever. The existing
       endGame() already refuses this case; do the same here rather than hiding
       the button only in the UI. */
    if (row.is_bot) {
      return res.status(400).json({ message: 'Computer games cannot be drawn by agreement' });
    }

    /* They already offered and I am offering back → that IS acceptance. */
    if (row.draw_offered_by && row.draw_offered_by !== req.user.id) {
      return finishAsAgreedDraw(req, res, row);
    }

    await db.query(
      `UPDATE online_games SET draw_offered_by = $2, draw_offered_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [row.id, req.user.id]
    );
    const updated = await getGameRow(row.id);
    emitGameUpdate(req, row.id);
    res.json(payload(updated, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to offer a draw', error: err.message });
  }
};

/* Answer a pending draw offer: accept (finish as a draw) or decline (clear it).

   NOTE: this handler takes ONLY (req, res). An earlier version had a third
   `forcedAccept` parameter for the simultaneous-offer case — and Express invokes
   handlers as (req, res, next), so every real call passed the `next` FUNCTION as
   `forcedAccept`. A function is truthy, so every DECLINE silently took the accept
   branch and finished the game as a draw. The shared finish path is now a module
   function called directly, so no handler signature carries an extra parameter. */
exports.respondDraw = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    if (row.status !== 'active') return res.status(400).json({ message: 'Match is not in progress' });
    if (!row.draw_offered_by) return res.status(400).json({ message: 'There is no draw offer to answer' });
    /* Only the OTHER player may answer. Without this, offering a draw and then
       accepting it yourself would end the game — the exact one-sided behaviour
       this flow exists to remove. */
    if (row.draw_offered_by === req.user.id) {
      return res.status(400).json({ message: 'You cannot answer your own draw offer' });
    }

    if (req.body?.accept !== true) {
      await clearDrawOffer(row.id);
      const declined = await getGameRow(row.id);
      emitGameUpdate(req, row.id);
      return res.json(payload(declined, req.user.role, req.user.id));
    }

    return finishAsAgreedDraw(req, res, row);
  } catch (err) {
    res.status(500).json({ message: 'Failed to answer the draw offer', error: err.message });
  }
};

// Send an emoji reaction to your opponent (kept as the latest reaction).
exports.reactGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    if (row.status !== 'active') return res.status(400).json({ message: 'Match is not in progress' });
    const emoji = String(req.body?.emoji || '').trim().slice(0, 40);
    if (!emoji) return res.status(400).json({ message: 'Pick an emoji' });
    await db.query(
      `UPDATE online_games SET last_react_emoji = $2, last_react_by = $3, last_react_at = NOW() WHERE id = $1`,
      [row.id, emoji, req.user.id]
    );
    const updated = await getGameRow(row.id);
    emitGameUpdate(req, row.id);
    res.json(payload(updated, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to send reaction', error: err.message });
  }
};

// Apply a move. Server validates turn + legality with chess.js, runs the clock.
exports.moveGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });

    const isCreator = row.admin_id === req.user.id;
    const isOpponent = row.student_id === req.user.id;
    if (!isCreator && !isOpponent) return res.status(403).json({ message: 'Not part of this match' });
    if (row.status !== 'active') return res.status(400).json({ message: 'Match is not in progress' });

    const { from, to, promotion } = req.body;
    if (!from || !to) return res.status(400).json({ message: 'Move needs from and to squares' });

    const g = parsePgn(row.pgn);
    const turn = g.turn() === 'w' ? 'white' : 'black';
    // For bot games the student's browser drives BOTH colors (their own + the
    // engine's), so the side that is allowed to move follows the board turn,
    // not the requester's stored color.
    const isBot = Boolean(row.is_bot);
    const moverColor = isBot
      ? turn
      : isCreator
        ? row.admin_color
        : row.admin_color === 'white' ? 'black' : 'white';
    if (moverColor !== turn) return res.status(400).json({ message: "It's not your turn" });

    // clock accounting — the time used since the last move belongs to the mover
    const base = (Number(row.time_base_minutes) || 5) * 60000;
    let whiteMs = Number(row.white_ms) || base;
    let blackMs = Number(row.black_ms) || base;
    const elapsed = Math.max(0, nowMs() - rowMs(row.updated_at));
    const moverMsBefore = Math.max(0, (moverColor === 'white' ? whiteMs : blackMs) - elapsed);
    if (moverMsBefore <= 0) {
      // flag fell before the move — opponent wins on time, unless they cannot mate
      const opponentColor = moverColor === 'white' ? 'black' : 'white';
      const opponentCanMate = sideHasMatingMaterial(g, opponentColor);
      const result = opponentCanMate ? opponentColor : 'draw';
      const reason = opponentCanMate ? 'timeout' : 'insufficient';
      await db.query(
        `UPDATE online_games SET status = 'finished', result = $2, result_reason = $3, updated_at = NOW() WHERE id = $1`,
        [row.id, result, reason]
      );
      const updated = await getGameRow(row.id);
      await applyOnlineRating(updated, result);
      await notifyClassGameFinished(req, updated);
      analysisHooks.onlineGameFinished(updated);
      emitGameUpdate(req, row.id);
      return res.json(payload(updated, req.user.role, req.user.id));
    }

    const mv = g.move({ from: String(from), to: String(to), promotion: promotion || 'q' });
    if (!mv) return res.status(400).json({ message: 'Illegal move' });

    let status = 'active';
    let result = null;
    let reason = null;
    if (g.isCheckmate()) {
      status = 'finished';
      result = mv.color === 'w' ? 'white' : 'black';
      reason = 'checkmate';
    } else if (g.isStalemate()) {
      status = 'finished';
      result = 'draw';
      reason = 'stalemate';
    } else if (g.isThreefoldRepetition()) {
      status = 'finished';
      result = 'draw';
      reason = 'repetition';
    } else if (g.isInsufficientMaterial()) {
      status = 'finished';
      result = 'draw';
      reason = 'insufficient';
    } else if (g.isDrawByFiftyMoves()) {
      status = 'finished';
      result = 'draw';
      reason = 'fifty-move';
    }

    // add increment to the mover after the move
    const incMs = (Number(row.time_increment_seconds) || 0) * 1000;
    const moverMsAfter = moverMsBefore + incMs;
    if (moverColor === 'white') whiteMs = moverMsAfter;
    else blackMs = moverMsAfter;
    if (status === 'finished') {
      // leftover time isn't meaningful once the game ends, but keep it stable
      const other = moverColor === 'white' ? blackMs : whiteMs;
      if (moverColor === 'white') blackMs = Math.max(0, other);
      else whiteMs = Math.max(0, other);
    }

    /* A pending draw offer is cleared the moment the game reaches a decision, so
       it can never be answered after the game is over.
       The offer columns are written as EXPLICIT values rather than
       `CASE WHEN $3 = 'finished' ...`: reusing the status parameter makes
       Postgres deduce two different types for $3 (varchar from `status = $3`,
       text from the comparison) and reject the whole statement. Deciding it in
       JS keeps the statement single-purpose and type-safe. */
    const gameOver = status === 'finished';
    await db.query(
      `UPDATE online_games SET fen = $1, pgn = $2, status = $3, result = $4, result_reason = $5,
         white_ms = $6, black_ms = $7, draw_offered_by = $8, draw_offered_at = $9,
         updated_at = NOW() WHERE id = $10`,
      [
        g.fen(), g.pgn(), status, result, reason, whiteMs, blackMs,
        gameOver ? null : row.draw_offered_by,
        gameOver ? null : row.draw_offered_at,
        row.id,
      ]
    );
    const updated = await getGameRow(row.id);
    if (status === 'finished') {
      await applyOnlineRating(updated, result);
      await notifyClassGameFinished(req, updated);
      /* Natural end (checkmate / stalemate / repetition / insufficient). Queued
         here rather than in notifyClassGameFinished because that helper returns
         early for a game with no class_id — a plain PvP match has none, and would
         otherwise never be analysed. */
      analysisHooks.onlineGameFinished(updated);
    }
    emitGameUpdate(req, row.id);
    res.json(payload(updated, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to play move', error: err.message });
  }
};

// Either participant can end the match (draw by agreement / abandoned).
exports.endGame = async (req, res) => {
  try {
    const row = await getGameRow(req.params.id);
    if (!row) return res.status(404).json({ message: 'Match not found' });
    if (row.admin_id !== req.user.id && row.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Not part of this match' });
    }
    if (row.status !== 'finished') {
      /* No opponent to agree with in a computer game, so "end as draw" is not a
         real result — it would store 'abandoned' and show up in the coach's list
         as if the student quit. Refuse it outright rather than hiding the button
         only in the UI, so the endpoint can't be reached directly either. */
      if (row.is_bot) {
        return res.status(400).json({ message: 'Computer games cannot be ended as a draw' });
      }
      await db.query(
        `UPDATE online_games SET status = 'finished', result = 'abandoned', result_reason = 'agreement',
         draw_offered_by = NULL, draw_offered_at = NULL, updated_at = NOW() WHERE id = $1`,
        [row.id]
      );
      row.status = 'finished';
      row.result = 'abandoned';
      row.result_reason = 'agreement';
      await notifyClassGameFinished(req, row);
      /* A draw by agreement still has a real move list worth reviewing. */
      analysisHooks.onlineGameFinished(row);
    }
    emitGameUpdate(req, row.id);
    res.json(payload(row, req.user.role, req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Failed to end match', error: err.message });
  }
};