/* Ordering the app's nav by the ranks a Super Admin saved.
 *
 * The nav item LIST lives in code (adminLinks in Sidebar.jsx, STUDENT_LINKS in
 * StudentAppShell.jsx) and this module only decides the sequence. That split is
 * what lets a nav item be added in a later release without a database change: it
 * simply has no stored rank and keeps its place in code.
 *
 * `item.to` (the route) is the key. Routes are unique within a menu, and the two
 * menus are ordered independently, so the route alone identifies an item —
 * /openings appears in both menus but never twice in one. */

const isRank = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Sort a nav list by saved ranks.
 *
 * An item with a rank sorts by it. An item WITHOUT one — a link added to the app
 * after the order was saved — is ranked as `index + 0.5`, the midpoint of its
 * position in code. That puts it beside the neighbours it was written next to
 * instead of dumping every new link at the bottom of the menu, while guaranteeing
 * it can never displace an item the Super Admin deliberately placed: where its
 * code position collides with a saved rank, the saved rank wins and the new item
 * follows it.
 *
 * @param {Array<{to: string}>} links  the nav items, in code order
 * @param {Record<string, number>} [ranks]  key -> rank, as returned by the API
 * @returns {Array} a new array; `links` is not mutated
 */
export function applyNavOrder(links, ranks) {
  if (!Array.isArray(links)) return [];
  const table = ranks && typeof ranks === 'object' ? ranks : {};

  return links
    .map((link, index) => ({
      link,
      index,
      sortKey: isRank(table[link.to]) ? table[link.to] : index + 0.5,
    }))
    .sort((a, b) => a.sortKey - b.sortKey || a.index - b.index)
    .map((entry) => entry.link);
}

/**
 * Move the item at `index` one place up (-1) or down (+1).
 * Returns the same array when the move would fall off either end, so a caller
 * can render the result unconditionally.
 */
export function moveItem(items, index, direction) {
  const list = Array.isArray(items) ? items : [];
  const to = index + (direction < 0 ? -1 : 1);
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The keys to send when saving, in the order shown. */
export const orderKeys = (links) => (Array.isArray(links) ? links : []).map((link) => link.to);

/**
 * Move one item to sit where another one is, which is what a drag produces:
 * the library reports which row was picked up and which row it was dropped on,
 * never an index, because the drop target moves as the drag proceeds.
 *
 * Both positions are read from the list as it stands BEFORE the move, so the item
 * finishes on the slot the target occupied: dragging the top row onto the bottom
 * one leaves it at the bottom, not second from the bottom. Measuring the target
 * after lifting the dragged item out is the classic off-by-one here — it shifts
 * every downward drag one place too high.
 *
 * A drop onto the row it started from, or onto a key that is not in the list,
 * returns the list untouched, so a cancelled or stray drop cannot corrupt it.
 */
export function moveToKey(items, activeKey, overKey) {
  const list = Array.isArray(items) ? items : [];
  if (activeKey === overKey) return list;
  const from = list.findIndex((link) => link.to === activeKey);
  const to = list.findIndex((link) => link.to === overKey);
  if (from < 0 || to < 0) return list;

  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
