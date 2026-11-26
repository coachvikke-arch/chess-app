/* API client for the new Player Report feature. Additive only. */
import api from './api';

export function getPlayerReport(studentId, source = 'all') {
  return api.get(`/player-report/${encodeURIComponent(studentId)}`, {
    params: { source },
    cache: false,
  }).then((res) => res.data);
}

export function getPlayerGameFeedback(gameId, options = {}) {
  const { studentId, source } = options;
  return api.get(`/player-report/game/${encodeURIComponent(gameId)}`, {
    params: {
      ...(studentId != null ? { studentId } : {}),
      ...(source ? { source } : {}),
    },
    cache: false,
  }).then((res) => res.data);
}
