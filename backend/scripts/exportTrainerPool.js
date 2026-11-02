/* Regenerates data/trainerPuzzlePool.json from the full Lichess import.

   The deployed app cannot reach a 6.1M-row table it does not have, so the
   trainer ships a curated pool instead and installs it on first use (see
   src/services/puzzleTrainer.js). This script is how that file is topped up or
   rebuilt: it draws candidates from each rating band of the local
   `lichess_puzzles` copy and keeps only rows that survive the real solver-first
   walk, so a seeded row can never be one the request path would throw away.

     node scripts/exportTrainerPool.js [--band-rows 500] [--scan 1400]
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const { LEVELS } = require('../src/services/puzzleTrainer');
const { toTrainerPuzzle } = require('../src/services/puzzleGenerator/lichessSource');

const args = process.argv.slice(2);
const num = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : Number(args[i + 1]) || fallback;
};
const KEEP_PER_BAND = num('--band-rows', 500);
const SCAN = num('--scan', 1400);
const OUT = path.join(__dirname, '..', 'data', 'trainerPuzzlePool.json');

(async () => {
  const rows = [];
  const seenFen = new Set();

  for (const band of LEVELS) {
    /* nb_plays is the quality signal: a puzzle thousands of players have tried
       has had its line checked by all of them. */
    const sql = `SELECT puzzle_id, fen, moves, rating, themes
                   FROM lichess_puzzles
                  WHERE rating >= $1 AND rating IS NOT NULL
                    AND nb_plays > 500 AND array_length(themes, 1) > 0
                    ${band.max != null ? 'AND rating < ' + band.max : ''}
                  ORDER BY random() LIMIT ${SCAN}`;
    const candidates = (await db.query(sql, [band.min])).rows;

    let kept = 0;
    for (const row of candidates) {
      if (kept >= KEEP_PER_BAND) break;
      const puzzle = toTrainerPuzzle(row);
      /* Dedupe on the position the student is shown, not on the source row: the
         Lichess export repeats the same solved position under several ids. */
      if (!puzzle || seenFen.has(puzzle.fen)) continue;
      seenFen.add(puzzle.fen);
      rows.push([String(row.puzzle_id), row.fen, String(row.moves).trim(), row.rating, row.themes]);
      kept++;
    }
    console.error(`band ${band.min}-${band.max ?? 'open'}: scanned ${candidates.length}, kept ${kept}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(rows));
  console.error(`wrote ${rows.length} rows to ${OUT}`);
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
