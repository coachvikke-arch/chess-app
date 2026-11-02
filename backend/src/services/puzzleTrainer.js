/* Rating-level puzzle trainer feed.
 *
 * Draws from the locally imported `lichess_puzzles` copy (see
 * scripts/importLichessPuzzles.js) — 6.1M rated rows, so five rating bands can
 * serve an endless stream without ever running dry. Each row comes back as
 * `{ id, fen, moves }`: the position with the SOLVER to move and the solver-first
 * UCI line, which is exactly what `frontend/src/utils/puzzleSolve.js` solves
 * against. The trigger move is consumed by `toTrainerPuzzle`, so nothing here
 * reimplements the Lichess line rule.
 *
 * Two decisions worth knowing:
 *
 *  - No theme, rating or difficulty leaves this module. A student who can see a
 *    label can sort the feed by it, and a name like "Mate in 2" hands over the
 *    answer before the first move.
 *  - The "never show me the same puzzle twice" memory lives on the device, in the
 *    `seen` list the caller passes in, and is filtered here. The trainer has no
 *    table of its own; a 6M-row pool and a few hundred excluded ids cannot collide
 *    by accident, so the exclusion is a guard, not the source of truth.
 */

const db = require('../config/database');
const { toTrainerPuzzle } = require('./puzzleGenerator/lichessSource');

/**
 * The five bands, indexed by the `level` the client asks for — the same bands the
 * trainer's level sheet shows (Beginner → Expert). `max` is exclusive, so a
 * puzzle rated exactly 800 belongs to one band only.
 */
const LEVELS = [
  { min: 400, max: 800 },
  { min: 800, max: 1200 },
  { min: 1200, max: 1600 },
  { min: 1600, max: 2000 },
  { min: 2000, max: null },
];

/* Rows the sample is asked to hand over. Several rows in any batch fail the
   legality walk, so one query covers a whole session's worth of retries. */
const CANDIDATES = 24;

/* Of the 6.1M rows, this percentage of the table's PAGES is read (≈12k rows).
   A `WHERE rating …` over the whole table would sort millions of rows per
   request; a sample costs a few milliseconds and is random by construction. */
const SAMPLE_PERCENT = 0.2;

/* Ceiling on the caller's exclusion list. The client keeps a rolling window, so
   this only ever bounds a malformed or hand-crafted request. */
const MAX_EXCLUDED = 800;

function normalizeExclude(seen) {
  const list = Array.isArray(seen) ? seen : String(seen || '').split(/[,\s]+/);
  const out = [];
  for (const id of list) {
    const clean = String(id || '').trim();
    if (!clean || clean.length > 20) continue; // puzzle_id is VARCHAR(20)
    out.push(clean);
    if (out.length >= MAX_EXCLUDED) break;
  }
  return out;
}

/**
 * One random, not-yet-seen puzzle in a band.
 *
 * @param {object} args
 * @param {number|string} args.level  0..4
 * @param {string[]|string} args.seen ids this device has already been shown
 * @returns {Promise<{id: string, fen: string, moves: string[]}|null>}
 */
async function pickTrainerPuzzle({ level, seen = [] }) {
  const band = LEVELS[Number(level)];
  if (!band) return null;

  const exclude = normalizeExclude(seen);
  const params = [band.min, exclude];
  let sql = `SELECT puzzle_id, fen, moves
               FROM lichess_puzzles TABLESAMPLE SYSTEM (${SAMPLE_PERCENT})
              WHERE rating >= $1
                AND NOT (puzzle_id = ANY($2::text[]))`;
  if (band.max != null) {
    params.push(band.max);
    sql += ` AND rating < $${params.length}`;
  }
  sql += ` ORDER BY random() LIMIT ${CANDIDATES}`;

  const rows = await db.query(sql, params);
  for (const row of rows.rows) {
    const puzzle = toTrainerPuzzle(row);
    if (puzzle) return puzzle;
  }
  return null;
}

module.exports = { pickTrainerPuzzle, LEVELS, normalizeExclude };
