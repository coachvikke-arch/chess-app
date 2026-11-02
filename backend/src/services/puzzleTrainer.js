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

/* Below this many rows a page sample is worthless, so the draw reads the table. */
const SAMPLE_AT_ABOVE = 50000;

/* The pool a database without the 6.1M-row import is seeded with: 2,500
   positions, 500 to a band, every one walked through the same solver-first rule
   this module applies at request time. Built by scripts/exportTrainerPool.js. */
const SEED_ROWS = require('../../data/trainerPuzzlePool.json');

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
 * The trainer's feed table, installed if the database does not have it.
 *
 * `lichess_puzzles` and its import were only ever run on the machine that built
 * the feature, so the deployed app answered every student with
 * `relation "lichess_puzzles" does not exist` — a 500 the page could only report
 * as a broken service. The module that owns the query now installs the table it
 * reads, the same idempotent-DDL way tournamentRatingService installs its own.
 *
 * It never touches a pool that already has rows, so the full Lichess import
 * stays the better source wherever it has been run.
 *
 * Memoised because the check is one cheap query per container, not per request;
 * a failure clears the memo so the next request retries instead of sticking.
 */
let poolReady = null;

async function installPool() {
  const present = await db.query("SELECT to_regclass('public.lichess_puzzles') AS t");
  if (!present.rows[0].t) {
    await db.query(`CREATE TABLE IF NOT EXISTS lichess_puzzles (
      puzzle_id        VARCHAR(20) PRIMARY KEY,
      fen              VARCHAR(120) NOT NULL,
      moves            TEXT NOT NULL,
      rating           INTEGER,
      rating_deviation INTEGER,
      popularity       INTEGER,
      nb_plays         INTEGER,
      themes           TEXT[] NOT NULL DEFAULT '{}',
      game_url         TEXT,
      opening_tags     TEXT[] NOT NULL DEFAULT '{}'
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS lichess_puzzles_rating_idx ON lichess_puzzles (rating)');
    await db.query('CREATE INDEX IF NOT EXISTS lichess_puzzles_themes_idx ON lichess_puzzles USING GIN (themes)');
  }

  const count = await db.query('SELECT count(*)::int AS n FROM lichess_puzzles');
  if (count.rows[0].n > 0) return count.rows[0].n;

  await seedPool();
  return (await db.query('SELECT count(*)::int AS n FROM lichess_puzzles')).rows[0].n;
}

async function seedPool() {
  const BATCH = 250;
  for (let i = 0; i < SEED_ROWS.length; i += BATCH) {
    const params = [];
    const tuples = SEED_ROWS.slice(i, i + BATCH).map(([id, fen, moves, rating, themes]) => {
      params.push(id, fen, moves, rating, themes || []);
      const at = params.length - 4;
      return `($${at}, $${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}::text[])`;
    });
    await db.query(
      `INSERT INTO lichess_puzzles (puzzle_id, fen, moves, rating, themes)
       VALUES ${tuples.join(', ')}
       ON CONFLICT DO NOTHING`,
      params
    );
  }
}

function ensurePool() {
  if (!poolReady) {
    poolReady = installPool().catch((err) => {
      poolReady = null;
      throw err;
    });
  }
  return poolReady;
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

  const pool = await ensurePool();
  const exclude = normalizeExclude(seen);
  const puzzle = await draw(band, exclude, pool);
  /* A student who has worked through the band gets a repeat rather than a dead
     end. The shipped pool is finite, and "there is no puzzle for you" is a worse
     answer than one they have already met. */
  if (puzzle || !exclude.length) return puzzle;
  return draw(band, [], pool);
}

/* One sampled query. `pool` is the row count, which decides whether the table
   can afford to be sampled at all. */
async function draw(band, exclude, pool) {
  /* SYSTEM (0.2) reads 0.2% of the table's PAGES, which is what keeps a 6M-row
     import from sorting millions of rows per request. On a pool of a few
     thousand the same percentage rounds down to no pages at all, so the sample
     only goes in once there are enough rows for it to land on something. */
  const sample = pool >= SAMPLE_AT_ABOVE ? ` TABLESAMPLE SYSTEM (${SAMPLE_PERCENT})` : '';
  const params = [band.min, exclude];
  let sql = `SELECT puzzle_id, fen, moves
               FROM lichess_puzzles${sample}
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

module.exports = { pickTrainerPuzzle, ensurePool, LEVELS, normalizeExclude };
