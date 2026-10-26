const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = require('./src/app');
const liveClassSocket = require('./src/socket/liveClassSocket');
const specService = require('./src/services/specService');

/* Multer writes into these directories directly; a fresh volume or container
   starts empty, so create them before the first upload arrives. */
for (const dir of ['uploads', 'uploads/chat', 'uploads/certificates']) {
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
}

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: (process.env.CLIENT_URL || 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  },
});

/* Attach io to the express app so controllers can reach it via req.app.get('io') */
app.set('io', io);
global.__tournamentIo = io;

/* Socket.io auth middleware: verify the JWT from socket.auth.token */
io.use(async (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('No token provided'));
  let decoded;
  try {
    const jwt = require('jsonwebtoken');
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(new Error('Unauthorized'));
  }
  /* Session-bound tokens are refused once revoked, so a device bumped by the
     2-device cap cannot keep a live socket open. Tokens without a session_id
     (legacy/service) are unaffected. */
  if (decoded.session_id) {
    try {
      const sessionService = require('./src/services/sessionService');
      const active = await sessionService.isSessionActive(decoded.session_id, decoded.id);
      if (!active) return next(new Error('SESSION_REVOKED'));
    } catch (err) {
      /* Fail open on a DB hiccup — an outage must not drop every socket. */
    }
  }
  socket.user = decoded; // { id, role, name, email, session_id? }
  next();
});

io.on('connection', (socket) => {
  /* Online match rooms: emit->game:gameId. Read-only by design — moves go
     through REST, so any authorized viewer may watch a board live. */
  socket.on('join-game', async (gameId, ack) => {
    if (!gameId) return;
    const gate = await inTournament(socket.user, (await gameTournamentId(gameId)) ?? null);
    if (!gate.ok) {
      if (ack) ack({ ok: false, error: gate.reason });
      return;
    }
    socket.join(`game:${Number(gameId)}`);
    if (ack) ack({ ok: true, spectator: Boolean(gate.spectator) });
  });
  socket.on('leave-game', (gameId) => {
    if (!gameId) return;
    socket.leave(`game:${gameId}`);
  });

  /* ── Spectate: computer-vs-student sessions broadcast by the player ──
     A student's browser registers its running computer game here so coaches
     and other players can watch the live board, move list and clocks.     */
  const ownedSpecKeys = new Set();
  socket.on('join-spec', (key, ack) => {
    if (!key) return;
    const k = String(key);
    socket.join(`spec:${k}`);
    const session = specService.get(k);
    if (ack) {
      if (session) ack({ ok: true, session: { ...session, serverNow: Date.now() } });
      else ack({ ok: false, error: 'Session not found' });
    }
  });
  socket.on('leave-spec', (key) => {
    if (!key) return;
    socket.leave(`spec:${String(key)}`);
  });
  socket.on('spec:register', (payload, ack) => {
    try {
      const key = String((payload && payload.key) || '');
      if (!key) {
        if (ack) ack({ ok: false, error: 'key required' });
        return;
      }
      const session = specService.register({
        key,
        ownerUserId: (socket.user && socket.user.id) || null,
        whiteId: payload.whiteId,
        blackId: payload.blackId,
        whiteName: payload.whiteName || (socket.user && socket.user.name) || 'Player',
        blackName: payload.blackName || 'Computer',
        fen: payload.fen,
        pgn: payload.pgn,
        whiteMs: payload.whiteMs,
        blackMs: payload.blackMs,
        turn: payload.turn,
        status: payload.status,
        result: payload.result,
        level: payload.level,
        baseMinutes: payload.baseMinutes,
        incrementSeconds: payload.incrementSeconds,
      });
      socket.join(`spec:${key}`);
      ownedSpecKeys.add(key);
      io.to(`spec:${key}`).emit('spec-update', { key, session: { ...session, serverNow: Date.now() } });
      if (ack) ack({ ok: true, session });
    } catch (err) {
      if (ack) ack({ ok: false, error: err.message });
    }
  });
  socket.on('spec:update', (payload, ack) => {
    try {
      const key = String((payload && payload.key) || '');
      if (!key) {
        if (ack) ack({ ok: false, error: 'key required' });
        return;
      }
      const session = specService.update(key, payload);
      if (!session) {
        if (ack) ack({ ok: false, error: 'Session not found' });
        return;
      }
      io.to(`spec:${key}`).emit('spec-update', { key, session: { ...session, serverNow: Date.now() } });
      if (ack) ack({ ok: true, session });
    } catch (err) {
      if (ack) ack({ ok: false, error: err.message });
    }
  });
  socket.on('spec:end', (key, ack) => {
    const k = String(key || '');
    if (!k) {
      if (ack) ack({ ok: false, error: 'key required' });
      return;
    }
    const session = specService.get(k);
    if (session && session.status !== 'finished') {
      session.status = 'finished';
      session.serverNow = Date.now();
      io.to(`spec:${k}`).emit('spec-update', { key: k, session: { ...session, serverNow: Date.now() } });
    }
    specService.remove(k);
    ownedSpecKeys.delete(k);
    io.to(`spec:${k}`).emit('spec-end', { key: k });
    if (ack) ack({ ok: true });
  });
  socket.on('spec:list', (ack) => {
    if (ack) ack({ ok: true, sessions: specService.list() });
  });

  /* Notifications / targeted pushes: user:<id> */
  if (socket.user && socket.user.id != null) {
    socket.join(`user:${socket.user.id}`);
  }

  /* Tournament rooms. Server-side authorization: admins always, participants
     always, and everyone else only for public tournaments (spectating). */
  const gameTournamentId = async (gameId) => {
    try {
      const db = require('./src/config/database');
      const r = await db.query('SELECT tournament_id FROM tournament_games WHERE id = $1', [Number(gameId)]);
      return r.rows[0] ? r.rows[0].tournament_id : null;
    } catch (e) {
      return null;
    }
  };
  const inTournament = async (user, tid) => {
    if (!user) return { ok: false, reason: 'unauthenticated' };
    const id = Number(tid);
    if (!Number.isFinite(id)) return { ok: false, reason: 'bad_id' };
    try {
      const db = require('./src/config/database');
      const t = (await db.query('SELECT visibility FROM tournaments WHERE id = $1', [id])).rows[0];
      if (!t) return { ok: false, reason: 'not_found' };
      if (['admin', 'superadmin'].includes(user.role)) return { ok: true };
      const reg = (await db.query(
        `SELECT 1 FROM tournament_registrations
          WHERE tournament_id = $1 AND student_id = $2
            AND player_status NOT IN ('removed','withdrawn') AND invitation_status <> 'declined'`,
        [id, user.id]
      )).rows.length;
      if (reg) return { ok: true };
      if (t.visibility === 'public') return { ok: true, spectator: true };
      return { ok: false, reason: 'private_tournament' };
    } catch (e) {
      return { ok: false, reason: 'db_error' };
    }
  };
  const handleTournamentJoin = async (tournamentId, ack) => {
    const gate = await inTournament(socket.user, tournamentId);
    if (!gate.ok) {
      if (ack) ack({ ok: false, error: gate.reason });
      return;
    }
    socket.join(`tournament:${Number(tournamentId)}`);
    if (ack) ack({ ok: true, spectator: Boolean(gate.spectator) });
  };
  socket.on('join-tournament', handleTournamentJoin);
  socket.on('subscribe-tournament', handleTournamentJoin);
  socket.on('join-tournament-spectate', handleTournamentJoin);
  socket.on('leave-tournament', (tournamentId) => {
    if (tournamentId) socket.leave(`tournament:${Number(tournamentId)}`);
  });

  /* Per-SESSION room: `session_revoked` is delivered here, so bumping one
     device (the 2-device cap) logs out only that device, not every device the
     user owns. */
  if (socket.user && socket.user.session_id != null) {
    socket.join(`session:${socket.user.session_id}`);
  }

  /* When the registering client goes away, drop its computer sessions so the
     live list never shows a game nobody can actually watch anymore.
     NB: socket.io clears socket.rooms before emitting 'disconnect', so we
     track owned keys up front instead of re-scanning rooms. */
  socket.on('disconnect', () => {
    for (const k of ownedSpecKeys) {
      const session = specService.get(k);
      if (!session) continue;
      specService.remove(k);
      io.to(`spec:${k}`).emit('spec-end', { key: k });
    }
    ownedSpecKeys.clear();
  });
});

/* Live class room handlers (board, chat, annotations, admin controls) */
liveClassSocket(io);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  /* Durable tournament progression worker: drains the outbox (game-finalized
     kick + backoff retries) and advances rounds automatically. */
  try {
    require('./src/services/roundProgressionService').startWorker(io);
  } catch (e) { console.warn('tournament progression worker failed to start:', e.message); }
  /* The mail setup is checked ONCE, at start-up, where the warning is actually
     seen: a missing SMTP block, the dummy transport (which prints instead of
     sending) and a From address the provider will refuse are all worth saying
     out loud before somebody wonders why a student got no mail. */
  try {
    require('./src/services/mailService').checkMailSetup();
  } catch { /* the mail service must never stop the server from starting */ }
});
