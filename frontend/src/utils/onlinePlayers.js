/* Helpers for the Online Match opponent cards.
   The API returns one row per user with the four rating pools; the card shows
   the pool that matches the time control currently selected. */

export const RATING_CLASS_BY_FAMILY = {
  Bullet: 'bullet',
  Blitz: 'blitz',
  Rapid: 'rapid',
  Classical: 'classical',
};

/** Rating for the selected clock family, or null when the player has none. */
export function ratingForPlayer(player, timeClass) {
  if (!player || !timeClass) return null;
  const n = Number(player[`${timeClass}_rating`]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "rapid" → "Rapid", used next to the number so the pool is unambiguous. */
export function ratingPoolLabel(timeClass) {
  return timeClass ? timeClass.charAt(0).toUpperCase() + timeClass.slice(1) : '';
}

/* Search plus a defensive self-filter: the API already excludes the caller,
   but the cards must never offer a challenge to yourself. */
export function filterOnlinePlayers(players, { query = '', excludeId = null } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(players) ? players : []).filter((p) => {
    if (!p || p.id == null) return false;
    if (excludeId != null && String(p.id) === String(excludeId)) return false;
    if (!q) return true;
    return String(p.name || '').toLowerCase().includes(q);
  });
}
