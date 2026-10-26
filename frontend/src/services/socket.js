import { io } from 'socket.io-client';

/* Deployed frontends reach the Express/Socket.io server directly: Vercel
   rewrites cannot carry WebSocket upgrades. Same-origin locally. */
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

let socket = null;

export function getSocket() {
  const desiredToken = localStorage.getItem('token');
  // No token → never open a socket: the backend auth middleware would reject
  // the handshake, which socket.io-client logs as "Connection closed before
  // receiving a handshake response" and retries noisily. Wait until a token.
  if (!desiredToken) return null;
  if (socket) {
    // If the signed-in user changed since the socket connected (e.g. testing admin
    // and student in tabs of the same browser, which share localStorage), reconnect
    // the SAME socket object with the fresh token so listeners survive.
    const currentAuthToken = socket.auth && socket.auth.token ? socket.auth.token : undefined;
    if (currentAuthToken !== desiredToken) {
      try {
        socket.auth = { token: desiredToken };
        socket.disconnect();
        socket.connect();
      } catch (err) {
        socket = null;
      }
    }
    return socket;
  }
  socket = io(SOCKET_URL, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token: desiredToken },
  });
  return socket;
}

export function joinGameRoom(gameId) {
  if (!gameId) return;
  const s = getSocket();
  if (s) s.emit('join-game', gameId);
}

export function leaveGameRoom(gameId) {
  if (!gameId) return;
  const s = getSocket();
  if (s) s.emit('leave-game', gameId);
}

export function onGameUpdate(callback) {
  const s = getSocket();
  if (!s) return () => {};
  s.on('game-update', callback);
  return () => s.off('game-update', callback);
}

export function onGameInvite(callback) {
  const s = getSocket();
  if (!s) return () => {};
  s.on('game-invite', callback);
  return () => s.off('game-invite', callback);
}

/* Targeted event pushed ONLY to the original sender when their match request is
 * declined. Payload: { requestId, gameId, senderId, declinerId, declinerName, message }. */
export function onMatchDeclined(callback) {
  const s = getSocket();
  if (!s) return () => {};
  s.on('match-declined', callback);
  return () => s.off('match-declined', callback);
}

export function joinTournamentRoom(tournamentId) {
  if (!tournamentId) return;
  const s = getSocket();
  if (s) s.emit('join-tournament', tournamentId);
}

export function leaveTournamentRoom(tournamentId) {
  if (!tournamentId) return;
  const s = getSocket();
  if (s) s.emit('leave-tournament', tournamentId);
}

export function onTournamentUpdate(callback) {
  const s = getSocket();
  if (!s) return () => {};
  s.on('tournament:update', callback);
  return () => s.off('tournament:update', callback);
}

export function onNotification(callback) {
  const s = getSocket();
  if (!s) return () => {};
  s.on('notification', callback);
  return () => s.off('notification', callback);
}

export function joinLiveClass(classId, ack) {
  const s = getSocket();
  if (s) s.emit('join-live-class', classId, ack);
}

export function leaveLiveClass(classId) {
  const s = getSocket();
  if (s) s.emit('leave-live-class', classId);
}

export function on(event, cb) {
  const s = getSocket();
  if (!s) return () => {};
  s.on(event, cb);
  return () => s.off(event, cb);
}

export function emit(event, data, ack) {
  const s = getSocket();
  if (s) s.emit(event, data, ack);
}

/* ── Spectate (watch live games: computer sessions + online matches) ── */
export function joinSpec(key) {
  if (!key) return;
  const s = getSocket();
  if (s) s.emit('join-spec', key);
}

export function leaveSpec(key) {
  if (!key) return;
  const s = getSocket();
  if (s) s.emit('leave-spec', key);
}

/* The player whose browser runs a computer game announces it (and its live
   updates) so others can spectate. */
export function registerComputerSpec(payload, ack) {
  const s = getSocket();
  if (s) s.emit('spec:register', payload, ack);
}

export function updateComputerSpec(payload) {
  const s = getSocket();
  if (s) s.emit('spec:update', payload);
}

export function endComputerSpec(key) {
  if (!key) return;
  const s = getSocket();
  if (s) s.emit('spec:end', key);
}

export function onSpecUpdate(callback) {
  const s = getSocket();
  if (!s) return () => {};
  s.on('spec-update', callback);
  return () => s.off('spec-update', callback);
}

export function onSpecEnd(callback) {
  const s = getSocket();
  if (!s) return () => {};
  s.on('spec-end', callback);
  return () => s.off('spec-end', callback);
}
