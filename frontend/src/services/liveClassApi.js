import api from './api';

/**
 * Meeting URLs (Zoom / Meet) as typed by the coach.
 *
 * A URL saved without a scheme — "meet.google.com/x" — is resolved by the
 * browser as a path RELATIVE to the app's own origin, so an anchor pointing at
 * it navigates to "<app-origin>/meet.google.com/x" (a 404 inside MATE ZONE CHESS ACADEMY)
 * instead of the meeting, and the same string in a notification is not tappable.
 * Nothing downstream can tell the two apart, so every consumer normalises through
 * here first. Implemented in utils/meetingUrl.js, which this re-exports so the
 * pages keep a single import for live-class concerns.
 */
export { normalizeMeetingUrl } from '../utils/meetingUrl';

export async function startClass(id) {
  const { data } = await api.post(`/classes/${id}/start`);
  return data;
}

export async function endClass(id) {
  const { data } = await api.post(`/classes/${id}/end`);
  return data;
}

export async function cancelClass(id) {
  const { data } = await api.post(`/classes/${id}/cancel`);
  return data;
}

export async function getJoinToken(id) {
  const { data } = await api.get(`/classes/${id}/join-token`);
  return data;
}

export async function joinExternalClass(id) {
  const { data } = await api.post(`/classes/${id}/join-external`);
  return data;
}

export async function getChat(id, beforeId) {
  const params = beforeId ? { beforeId } : {};
  const { data } = await api.get(`/classes/${id}/chat`, { params });
  return data;
}

export async function clearChat(id) {
  const { data } = await api.post(`/classes/${id}/chat/clear`);
  return data;
}

export async function listParticipants(id) {
  const { data } = await api.get(`/classes/${id}/participants`);
  return data;
}

/**
 * Classroom leaderboard: points earned inside this class only.
 *
 * `cache: false` is required. api.js memoises GETs for 30s, and a leaderboard
 * that can go stale mid-lesson is worse than useless - a student who just
 * solved the drill would not see their own points move.
 */
export async function getClassLeaderboard(id) {
  const { data } = await api.get(`/classes/${id}/leaderboard`, { cache: false });
  return data;
}

/**
 * "Watch classmates": the other students' live boards for a student whose own
 * game in this class has finished. `cache: false` — a board that just ended (or
 * a classmate who just got paired) must not be served from the 30s GET cache.
 * The server rejects the call (403) while the caller is still playing.
 */
export async function getWatchableGames(id) {
  const { data } = await api.get(`/classes/${id}/watch`, { cache: false });
  return data;
}

/**
 * Instructor switch: allow/deny students watching their classmates. The whole
 * room is notified over the socket, so callers update optimistically and only
 * reconcile here. Returns the persisted value.
 */
export async function setClassSpectateEnabled(id, enabled) {
  const { data } = await api.patch(`/classes/${id}/spectate`, { enabled: Boolean(enabled) });
  return data;
}
