/* ──────────────────────────────────────────────────────────────────────────
 * The Brilliant Moves list must show EVERY eligible Sigma for the owner, not
 * just the ones left after a client-side filter ran on one server page.
 *
 * The regression: the API returned all Sigma rows for the owner (including an
 * opponent's, because a review files both sides under the game's owner), and the
 * component filtered them by colour/parity AFTER the server had already cut a
 * page and computed the totals. A page whose rows were mostly the opponent's
 * rendered two cards while `total` said more, and a Black-side brilliant could
 * vanish entirely when `ownerColor` was unavailable. The fix moved the owner-only
 * predicate into SQL (before LIMIT/OFFSET) and made the client render the page
 * and totals the server sent.
 *
 * These are static source assertions on purpose: the behaviour is a property of
 * the wiring (where the filter runs), which is exactly what broke.
 *
 * Run: node --test scripts/sigma-list-completeness.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SIGMA = read('src/components/SigmaMoves.jsx');
const CONTROLLER = readFileSync(
  new URL('../../backend/src/controllers/sigmaController.js', import.meta.url), 'utf8',
);

/* ── the client renders the server's page, unfiltered ─────────────────────── */

test('the list does not filter a server page by colour or ply parity', () => {
  assert.doesNotMatch(SIGMA, /m\.ownerColor === 'white' && m\.ply % 2 === 0/,
    'the owner filter belongs in SQL, not on one page');
  assert.doesNotMatch(SIGMA, /m\.ownerColor === 'black' && m\.ply % 2 === 1/);
  assert.doesNotMatch(SIGMA, /allMoves\.filter\(/,
    'the page the server returned is the page that is drawn');
});

test('the list does not recompute totals after pagination', () => {
  for (const stale of ['filteredTotal', 'filteredTypeCounts', 'filteredPageCount']) {
    assert.ok(!SIGMA.includes(stale), `${stale} is gone — totals come from the server`);
  }
});

test('counts, chips and pager all read the server response', () => {
  assert.match(SIGMA, /const total = data\?\.total \|\| 0;/);
  assert.match(SIGMA, /const pageCount = data\?\.pageCount \|\| 1;/);
  assert.match(SIGMA, /const typeCounts = data\?\.typeCounts \|\| \{\};/);
  assert.match(SIGMA, /All <span className="gr-sigma-filter-n">\{total\}<\/span>/);
  assert.match(SIGMA, /Page \{page\} of \{pageCount\} · \{total\} total/);
  /* A chip count and the grid must agree, so the chips read the same response
     the grid does. */
  assert.match(SIGMA, /const n = typeCounts\[key\] \|\| 0;/);
});

/* ── the server keeps the owner's own moves, before the page is cut ────────── */

test('the API keeps only the side the owner played', () => {
  assert.match(CONTROLLER, /r\.owner_color = 'white' AND r\.ply % 2 = 0/);
  assert.match(CONTROLLER, /r\.owner_color = 'black' AND r\.ply % 2 = 1/);
  /* An unattributable move is kept rather than hidden — "better a card drawn
     from the wrong side than no card at all" is the documented trade-off. */
  assert.match(CONTROLLER, /r\.owner_color IS NULL/);
});

test('the owner predicate is applied to the page query before LIMIT', () => {
  const rows = CONTROLLER.slice(
    CONTROLLER.indexOf('const rowsRes = await db.query('),
    CONTROLLER.indexOf('res.json({'),
  );
  assert.match(rows, /WHERE \$\{whereSql\}/);
  assert.ok(rows.indexOf('ORDER BY') < rows.indexOf('LIMIT'),
    'rows are ordered before the page is cut');
  /* The predicate lives in `where` (via OWN_MOVE_SQL), which the page, the count
     and the chips all share. */
  assert.match(CONTROLLER, /const where = \['r\.owner_user_id = \$1', OWN_MOVE_SQL\];/);
  assert.match(CONTROLLER, /AND \$\{OWN_MOVE_SQL\}/,
    'the chip counts use the same owner predicate as the grid');
});

test('the colour is resolved for every one of the four sources', () => {
  for (const col of ['cp.my_color', 'cg.player_color', 'og.admin_color',
    'tg.white_player', 'tg.black_player']) {
    assert.ok(CONTROLLER.includes(col), `${col} must still be resolved in SQL`);
  }
});
