'use strict';

/* Tournament socket layer + background scheduler.
   Client events
     join-tournament <id>          watch a tournament (students also count as "online" for arena pairing)
     leave-tournament <id>
     tournament:game:join <gameId> sit at / watch a board  (ack -> { ok, state })
     tournament:game:leave <gameId>
   Server events: tournament:update, tournament:game:state, tournament:game:ready */

const db = require('../config/database');
const rt = require('../services/tournamentRealtime');
const GS = require('../services/tournamentGameService');
const engine = require('../services/tournamentEngine');
const progression = require('../services/roundProgressionService');
const { ensureTournamentSchema } = require('../services/tournamentSchema');

let started = false;

function startBackground(io) {
  if (started) return;
  started = true;
  global.__tournamentIo = io;
  GS.init(io);
  try { progression.startWorker(io); } catch (e) { console.error('[tournament] worker', e.message); }

  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      /* Scheduled tournaments start themselves at their start time. */
      const due = await db.query(
        `SELECT id FROM tournaments
          WHERE status = 'upcoming' AND auto_start = TRUE AND start_time IS NOT NULL AND start_time <= NOW()`);
      for (const r of due.rows) {
        try { await engine.startTournament(io, r.id); } catch (e) { console.warn('[tournament] auto-start', r.id, e.message); }
      }
      /* Heartbeat: forfeits, round advance, arena pairing, arena end. */
      const live = await db.query("SELECT id FROM tournaments WHERE status = 'active'");
      for (const r of live.rows) {
        try {
          const res = await progression.processTournament(io, r.id);
          if (res && res.advanced) rt.emitTournament(io, r.id, 'tournament.progressed', {});
        } catch (e) { console.warn('[tournament] tick', r.id, e.message); }
      }
    } catch (e) {
      if (e && e.code !== '42P01') console.warn('[tournament] scheduler', e.message);
    } finally {
      busy = false;
    }
  }, 3000);
  if (timer.unref) timer.unref();
}

module.exports = function tournamentSocket(io) {
  ensureTournamentSchema()
    .then(() => startBackground(io))
    .catch((e) => console.error('[tournament] schema setup failed - tournaments disabled until fixed:', e.message));

  io.on('connection', (socket) => {
    const userId = socket.user && socket.user.id;
    const role = socket.user && socket.user.role;
    socket.data.tournamentRooms = new Set();
    socket.data.tournamentGames = new Map(); // gameId -> tournamentId

    socket.on('join-tournament', (tid, ack) => {
      if (tid == null || userId == null) return;
      socket.join(rt.tournamentRoom(tid));
      socket.data.tournamentRooms.add(String(tid));
      if (role === 'student') rt.trackJoin(tid, userId, socket.id);
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('leave-tournament', (tid) => {
      if (tid == null) return;
      socket.leave(rt.tournamentRoom(tid));
      socket.data.tournamentRooms.delete(String(tid));
      rt.trackLeave(tid, userId, socket.id);
    });

    socket.on('tournament:game:join', async (gameId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const G = await GS.loadGame(gameId);
        if (!G) return reply({ ok: false, error: 'Game not found' });
        if (!(await GS.canView(socket.user, G))) return reply({ ok: false, error: 'Not allowed to watch this board' });
        socket.join(rt.gameRoom(G.id));
        socket.data.tournamentGames.set(G.id, G.tournamentId);
        const isPlayer = !!GS.colorOf(G, userId);
        const state = isPlayer ? await GS.playerJoined(G.id, userId, socket.id) : GS.publicState(G);
        /* Being at a board also counts as being "online" in that tournament. */
        if (role === 'student') {
          socket.join(rt.tournamentRoom(G.tournamentId));
          rt.trackJoin(G.tournamentId, userId, socket.id);
        }
        reply({ ok: true, state, isPlayer });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    });

    socket.on('tournament:game:leave', (gameId) => {
      const gid = Number(gameId);
      socket.leave(rt.gameRoom(gid));
      const tid = socket.data.tournamentGames.get(gid);
      socket.data.tournamentGames.delete(gid);
      GS.playerLeft(gid, userId, socket.id);
      /* Leaving a board page also means "not here any more" for arena pairing,
         unless the tournament page itself is open in this socket. */
      if (tid != null && !socket.data.tournamentRooms.has(String(tid))) rt.trackLeave(tid, userId, socket.id);
    });

    socket.on('disconnect', () => {
      rt.trackDisconnect(userId, socket.id);
      GS.socketDisconnected(userId, socket.id);
    });
  });
};
