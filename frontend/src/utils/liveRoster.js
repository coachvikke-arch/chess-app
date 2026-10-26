/* Pure roster helpers for the live classroom.
 *
 * The server's `class:init` roster arrives in snake_case (it comes straight out
 * of SQL). The rest of the client speaks camelCase, so it is normalised once,
 * defensively, on the way in. Both helpers are dependency-free so they can be
 * unit-tested without a browser or a socket.
 */

/** Map the server roster (snake_case OR camelCase) to the client shape. */
export function normalizeRoster(roster) {
  if (!Array.isArray(roster)) return [];
  return roster
    .map((p) => ({
      userId: p.userId ?? p.user_id,
      name: p.name,
      roleInClass: p.roleInClass ?? p.role_in_class,
      status: p.status ?? 'active',
      joinedAt: p.joinedAt ?? p.joined_at,
    }))
    .filter((p) => p.userId != null);
}

/**
 * Replace the roster wholesale, keeping one entry per user. The same person can
 * appear twice when the HTTP snapshot and the socket roster land together on a
 * refresh, and a duplicate key would make React warn and the count lie.
 */
export function dedupeParticipants(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const next = [];
  for (const p of list) {
    if (!p || p.userId == null) continue;
    const key = String(p.userId);
    if (seen.has(key)) continue;
    seen.add(key);
    /* The authoritative roster is exactly the people present now, so every
       entry counts as active regardless of any stale status it carried. */
    next.push({ ...p, status: 'active' });
  }
  return next;
}
