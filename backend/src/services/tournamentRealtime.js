'use strict';

/* Tournament realtime helpers: room names, event emit, and who is "online" in a
   tournament room (arena pairing only pairs players who are present).

   Rooms
     tournament:<id>   everybody watching a tournament page
     tgame:<id>        everybody watching one tournament game board
     user:<id>         one user's personal room (joined at socket connect)

   Events (all carry { tournamentId, event, ...payload })
     tournament:update       generic "something changed, refetch"
     round.* / tournament.*  fine-grained names the progression worker emits   */

const online = new Map(); // tournamentId -> Map(userId -> Set(socketId))

const tournamentRoom = (id) => `tournament:${id}`;
const gameRoom = (id) => `tgame:${id}`;

function emitTournament(io, tournamentId, event, payload = {}) {
  if (!io || tournamentId == null) return;
  const data = { tournamentId: Number(tournamentId), event, ...payload };
  const room = tournamentRoom(tournamentId);
  io.to(room).emit('tournament:update', data);
  if (event && event !== 'tournament:update') io.to(room).emit(event, data);
}

function emitToUser(io, userId, event, payload) {
  if (!io || userId == null) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function trackJoin(tournamentId, userId, socketId) {
  const key = String(tournamentId);
  if (!online.has(key)) online.set(key, new Map());
  const m = online.get(key);
  if (!m.has(Number(userId))) m.set(Number(userId), new Set());
  m.get(Number(userId)).add(socketId);
}

function trackLeave(tournamentId, userId, socketId) {
  const key = String(tournamentId);
  const m = online.get(key);
  if (!m) return;
  const set = m.get(Number(userId));
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) m.delete(Number(userId));
  if (m.size === 0) online.delete(key);
}

/* Drop a socket from every tournament room it was in (socket disconnect). */
function trackDisconnect(userId, socketId) {
  for (const key of [...online.keys()]) trackLeave(key, userId, socketId);
}

function isOnline(tournamentId, userId) {
  const m = online.get(String(tournamentId));
  return !!(m && m.has(Number(userId)));
}

function onlineUserIds(tournamentId) {
  const m = online.get(String(tournamentId));
  return m ? [...m.keys()] : [];
}

module.exports = {
  tournamentRoom,
  gameRoom,
  emitTournament,
  emitToUser,
  trackJoin,
  trackLeave,
  trackDisconnect,
  isOnline,
  onlineUserIds,
};
