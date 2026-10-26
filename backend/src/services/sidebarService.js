/* Sidebar order — the one piece of navigation state a Super Admin controls for
 * everybody.

 * Design note: this table is a RANK CACHE, not the source of truth for which nav
 * items exist. Each client keeps its own list in code (adminLinks in Sidebar.jsx,
 * STUDENT_LINKS in StudentAppShell.jsx) and POSTs the route keys it wants in the
 * order it wants them; the client then sorts its own list by the ranks read back.
 * That means a nav item added in a later release has no row here and simply falls
 * back to its code position, rather than disappearing until someone re-saves.

 * The order is global rather than per-user on purpose: the brief is that a Super
 * Admin's change applies to every login. */

const db = require('../config/database');
const { pool } = require('../config/database');

/** The two menus that can be ordered. Kept in sync with the CHECK constraint on
 *  the table and with the client's menu switcher. (The constraint also admits
 *  legacy values nothing writes anymore; widening it again needs no data move.) */
const MENUS = ['admin', 'student'];

const isMenu = (value) => MENUS.includes(value);

/** Ranks for every menu, as { menu: { key: rank } }. Missing menus come back as
 *  an empty object, which the client reads as "use the code order". */
async function getRanks() {
  const { rows } = await db.query(
    'SELECT menu, item_key, sort_order FROM sidebar_order ORDER BY menu, sort_order',
  );

  const ranks = { admin: {}, student: {} };
  for (const menu of MENUS) ranks[menu] = {};

  for (const row of rows) {
    /* A menu value outside the known set can only exist if the constraint was
       added after the fact; ignoring it keeps a bad row from breaking a menu. */
    if (!isMenu(row.menu)) continue;
    ranks[row.menu][row.item_key] = row.sort_order;
  }
  return ranks;
}

/** Replace one menu's order with `keys` (route strings, in the desired order). */
async function setOrder(menu, keys, updatedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* Replace rather than merge: a key the client no longer sends has been
       removed from the menu, and leaving a stale rank behind would resurrect it
       in a surprising position if it ever came back. */
    await client.query('DELETE FROM sidebar_order WHERE menu = $1', [menu]);
    await client.query(
      `INSERT INTO sidebar_order (menu, item_key, sort_order, updated_by)
       SELECT $1, t.key, (t.ord::int - 1), $3
       FROM unnest($2::text[]) WITH ORDINALITY AS t(key, ord)`,
      [menu, keys, updatedBy ?? null],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return (await getRanks())[menu];
}

/** Drop a menu's stored order so every client falls back to its code order. */
async function resetOrder(menu) {
  await db.query('DELETE FROM sidebar_order WHERE menu = $1', [menu]);
  return {};
}

module.exports = { MENUS, isMenu, getRanks, setOrder, resetOrder };
