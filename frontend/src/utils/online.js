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

export async function cancelGameRequest(id) {
  return (await api.post(`/online/games/${id}/cancel-request`, {}, { cache: false })).data;
}

export async function resignGame(id) {
  return (await api.post(`/online/games/${id}/resign`)).data;
}

/* Leaving a live board. The server decides the consequence from the move list:
   aborted before the first move, resignation afterwards. Used by navigation
   away and by closing a board card — no confirmation prompt anywhere. */
export async function leaveGame(id) {
  return (await api.post(`/online/games/${id}/leave`, {}, { cache: false })).data;
}

/* "Settle every live board I am on." Leaving the classroom must end a game whose
   board was mounted on another tab (and may already be unmounted), which a
   per-game leave cannot address. `classId` scopes it to that room, so a match
   open in another tab is untouched. Resolves with how many matches were
   settled. */
export async function leaveActiveGames(classId) {
  return (await api.post('/online/leave-active', { classId }, { cache: false })).data;
}

/* A clock ran out. Its own endpoint (not resign) so the stored reason is
   'timeout', never a resignation inferred from a disconnect or a close. */
export async function timeoutGame(id) {
  return (await api.post(`/online/games/${id}/timeout`)).data;
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

/* ── Rematch (a finished player-vs-player match) ─────────────────────────────
   Mirrors the draw-offer pair: the request lives on the finished game, so the
   server is the single source of truth for "someone has already asked".
   `requestRematch` resolves with the refreshed game payload, which carries
   `rematchRequest: { by, byName, at, mine }`.
   `respondRematch` with accept:true resolves with the NEW game payload (201),
   and also pushes it to both players over `rematch-started`.
   `cancelRematch` is safe to call unconditionally — a request that was already
   answered comes back as a plain 200 so unmount cleanup never logs an error. */
export async function requestRematch(id) {
  return (await api.post(`/online/games/${id}/rematch-request`, {}, { cache: false })).data;
}

export async function respondRematch(id, accept) {
  return (await api.post(`/online/games/${id}/rematch-respond`, { accept: Boolean(accept) }, { cache: false })).data;
}

export async function cancelRematch(id) {
  return (await api.post(`/online/games/${id}/rematch-cancel`, {}, { cache: false })).data;
}

/* Requests aimed at me that the socket may never have delivered. The offer
   itself is stored on the finished match, so this is only a read of the same
   rows — it is what makes a request survive a sleeping tab, a reconnect, or
   simply being on another page when the other player tapped Rematch.
   Resolves to an array of the usual scoped game payloads. */
export async function fetchPendingRematches() {
  const data = (await api.get('/online/rematch-pending', { cache: false })).data;
  return Array.isArray(data?.games) ? data.games : [];
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
