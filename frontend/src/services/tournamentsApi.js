import api from './api';

/* Thin wrappers over /api/tournaments. GETs opt out of the 30s response cache:
   a tournament changes under your feet (clocks, results, pairings). */
const noCache = { cache: false };

export const listTournaments = () => api.get('/tournaments', noCache).then((r) => r.data.tournaments);
export const getTournament = (id) => api.get(`/tournaments/${id}`, noCache).then((r) => r.data);
export const getTournamentReport = (id) => api.get(`/tournaments/${id}/report`, noCache).then((r) => r.data);
export const getStudentPool = () => api.get('/tournaments/students', noCache).then((r) => r.data.students);

export const createTournament = (body) => api.post('/tournaments', body).then((r) => r.data.tournament);
export const updateTournament = (id, body) => api.put(`/tournaments/${id}`, body).then((r) => r.data.tournament);
export const deleteTournament = (id) => api.delete(`/tournaments/${id}`).then((r) => r.data);

export const setTournamentStatus = (id, status) => api.patch(`/tournaments/${id}/status`, { status }).then((r) => r.data);
export const generateNextRound = (id) => api.post(`/tournaments/${id}/generate-pairings`).then((r) => r.data);
export const addPlayers = (id, studentIds) => api.post(`/tournaments/${id}/add-players`, { studentIds }).then((r) => r.data);
export const removePlayer = (id, userId, { disqualify = false } = {}) =>
  api.delete(`/tournaments/${id}/players/${userId}`, { params: disqualify ? { disqualify: 1 } : {} }).then((r) => r.data);
export const manualPairing = (id, whiteId, blackId = null) =>
  api.post(`/tournaments/${id}/manual-pairing`, { whiteId, blackId }).then((r) => r.data);
export const getAudit = (id) => api.get(`/tournaments/${id}/audit`, noCache).then((r) => r.data.audit);
export const setPairingResult = (id, pairingId, result) =>
  api.post(`/tournaments/${id}/pairings/${pairingId}/result`, { result }).then((r) => r.data);

export const joinTournament = (id) => api.post(`/tournaments/${id}/join`).then((r) => r.data);
export const leaveTournament = (id) => api.post(`/tournaments/${id}/leave`).then((r) => r.data);
export const arenaPause = (id) => api.post(`/tournaments/${id}/arena/pause`).then((r) => r.data);
export const arenaResume = (id) => api.post(`/tournaments/${id}/arena/resume`).then((r) => r.data);

/* live boards */
export const getGame = (gameId) => api.get(`/tournaments/games/${gameId}`, noCache).then((r) => r.data);
export const sendMove = (gameId, move) => api.post(`/tournaments/games/${gameId}/move`, move).then((r) => r.data.game);
export const resignGame = (gameId) => api.post(`/tournaments/games/${gameId}/resign`).then((r) => r.data.game);
export const offerDraw = (gameId) => api.post(`/tournaments/games/${gameId}/draw`).then((r) => r.data.game);
export const respondDraw = (gameId, accept) =>
  api.post(`/tournaments/games/${gameId}/draw/respond`, { accept }).then((r) => r.data.game);
export const berserkGame = (gameId) => api.post(`/tournaments/games/${gameId}/berserk`).then((r) => r.data.game);

export const errorMessage = (err, fallback = 'Something went wrong') =>
  (err && err.response && err.response.data && err.response.data.message) || fallback;
