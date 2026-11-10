import api from './api';

/* Coach-side view of a student's linked Chess.com + Lichess profiles.

   These three calls drive the Student Chess Profiles page; everything else that
   page shows (accounts, ratings history, games, statistics, openings, insights)
   reuses the chessProfiles service with a studentId, which routes to the same
   admin endpoints under /api/admin/chess-profiles/:studentId. */

export const listStudentProfiles = () =>
  api.get('/admin/chess-profiles', { cache: false }).then((r) => r.data);

/* listAccountsForStudent returns the student's account list in the exact shape
   their own page reads (`{ accounts }` plus their header row). Never cached: a
   sync the coach just ran must be visible on the next read. */
export const listAccountsForStudent = (studentId) =>
  api.get(`/admin/chess-profiles/${studentId}`, { cache: false }).then((r) => r.data);

/* Re-reads both public APIs server-side. Per-account failures come back in
   `failures` with the cached accounts still attached, so a rate-limited
   platform leaves the page showing what it already had. */
export const syncStudentProfile = (studentId) =>
  api.post(`/admin/chess-profiles/${studentId}/sync`, undefined, { cache: false }).then((r) => r.data);

/* Coach-managed links. The server verifies the username on the platform's
   official public API, stores it on the STUDENT's own account row, imports the
   data and notifies the student. Every response carries the refreshed account
   list, so the page never needs a second round-trip to show the result. */
export const connectStudentAccount = (studentId, platform, username) =>
  api.post(
    `/admin/chess-profiles/${studentId}/accounts`,
    { platform, username },
    { cache: false },
  ).then((r) => r.data);

export const updateStudentAccount = (studentId, accountId, username) =>
  api.put(
    `/admin/chess-profiles/${studentId}/accounts/${accountId}`,
    { username },
    { cache: false },
  ).then((r) => r.data);

export const removeStudentAccount = (studentId, accountId) =>
  api.delete(
    `/admin/chess-profiles/${studentId}/accounts/${accountId}`,
    { cache: false },
  ).then((r) => r.data);
