import api from '../services/api';

export async function listUsers() {
  return (await api.get('/online/users')).data;
}

export async function listGames() {
  return (await api.get('/online/games', { cache: false })).data;
}

/* All currently watchable games: active online matches + computer sessions.
   Pass a classId to filter to a single live classroom's PvP boards. */
export async function listLiveSessions(classId) {
  const params = classId ? { classId } : {};
  return (await api.get('/online/live', { cache: false, params })).data;
}

/* Start every pairing in one shot from the classroom pairing modal. */
export async function createClassroomGames(payload) {
  return (await api.post('/online/classroom-games', payload)).data;
}

/* Instructor starts one separate "Computer vs Student" game per selected
   student. Every student gets their OWN online_games row so they each play the
   bot on an individual board; the instructor's client drives the bot side. */
export async function createClassroomBotGames(payload) {
  return (await api.post('/online/classroom-bot-games', payload)).data;
}

/* Neutral spectator view of one active online match (no participation needed). */
export async function spectateGame(id) {
  return (await api.get(`/online/games/${id}/spectate`, { cache: false })).data;
}

export async function createGame(payload) {
  return (await api.post('/online/games', payload)).data;
}

export async function fetchGame(id) {
  return (await api.get(`/online/games/${id}`, { cache: false })).data;
}

export async function acceptGame(id) {
  return (await api.post(`/online/games/${id}/accept`)).data;
}

export async function declineGame(id) {
  return (await api.post(`/online/games/${id}/decline`)).data;
}

export async function abortGame(id) {
  return (await api.post(`/online/games/${id}/abort`)).data;
}

export async function resignGame(id) {
  return (await api.post(`/online/games/${id}/resign`)).data;
}

/* A clock ran out. Its own endpoint (not resign) so the stored reason is
   'timeout', never a resignation inferred from a disconnect or a close. */
export async function timeoutGame(id) {
  return (await api.post(`/online/games/${id}/timeout`)).data;
}

export async function sendReaction(id, emoji) {
  return (await api.post(`/online/games/${id}/react`, { emoji })).data;
}

/* Offer a draw. This does NOT end the game — it records a pending offer the
   opponent has to accept. Play continues in the meantime, exactly as on a real
   board, and the offer stands until it is accepted or declined. */
export async function offerDraw(id) {
  return (await api.post(`/online/games/${id}/draw-offer`)).data;
}

/* Answer the opponent's pending offer. `accept: true` finishes the game as a
   draw; `accept: false` declines it and clears it. */
export async function respondDraw(id, accept) {
  return (await api.post(`/online/games/${id}/draw-respond`, { accept: Boolean(accept) })).data;
}

export async function sendMove(id, move) {
  return (await api.post(`/online/games/${id}/move`, move)).data;
}

export async function endGame(id) {
  return (await api.post(`/online/games/${id}/end`)).data;
}

/* MY OWN rating change for one finished game, or `{ rated: false, reason }`.

   Deliberately its own request rather than a field on the game payload:
   emitGameUpdate broadcasts both players' payloads to both sockets, so a rating
   delta travelling with the game state would hand each player the opponent's
   change. This endpoint is participant-scoped and returns only the caller's own
   numbers, which is what the result popup shows.

   `cache: false` matters: the answer changes the moment a game is rated, and a
   cached "in_progress" would leave the popup saying nothing happened. */
export async function fetchRatingResult(id) {
  return (await api.get(`/online/games/${id}/rating-result`, { cache: false })).data;
}