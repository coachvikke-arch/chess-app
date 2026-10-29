#!/usr/bin/env node

/**
 * Lichess puzzle importer for the admin Puzzle Generator.
 *
 * Copies lichess_db_puzzle.csv (pipe-delimited) into the `lichess_puzzles`
 * table, which is what the generator queries by theme + rating. The CSV itself
 * is never read at request time; importing once keeps generation fast and lets
 * a deployment run without the 300 MB file.
 *
 * Download (CC0): https://database.lichess.org/#puzzles
 *   curl -L -o lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
 *
 * Usage (run from backend/):
 *   node scripts/importLichessPuzzles.js                      # uses LICHESS_PUZZLE_CSV
 *   node scripts/importLichessPuzzles.js <file.csv|.csv.zst> [--limit N] [--batch 2000]
 *
 * A .zst source is decompressed on the fly with the `zstd` CLI when present,
 * else with Python's `zstandard` module. Nothing is written to disk in between.
 *
 * Columns: PuzzleId|FEN|Moves|Rating|RatingDeviation|Popularity|NbPlays|Themes|GameUrl|OpeningTags
 * NOTE: `Moves` starts with the opponent's trigger move; it is stored verbatim
 * here and stripped by the generator when a puzzle is picked.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');
const db = require('../src/config/database');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const source = positional[0] || process.env.LICHESS_PUZZLE_CSV || '';
const LIMIT = Number(flag('--limit', 0)) || 0;
const BATCH = Number(flag('--batch', 2000)) || 2000;

function hasCommand(cmd, probeArgs) {
  const r = spawnSync(cmd, probeArgs, { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

const PY_DECOMPRESS = [
  'import sys, zstandard',
  'd = zstandard.ZstdDecompressor()',
  'with open(sys.argv[1], "rb") as f, d.stream_reader(f) as r:',
  '    out = sys.stdout.buffer',
  '    while True:',
  '        chunk = r.read(1 << 20)',
  '        if not chunk: break',
  '        out.write(chunk)',
].join('\n');

function pythonCommand() {
  for (const cmd of ['python', 'python3', 'py']) {
    if (hasCommand(cmd, ['--version'])) return cmd;
  }
  return null;
}

/** Stream of decompressed CSV bytes for either a plain or zstd file. */
function openCsvStream(file) {
  if (!/\.zst(\.)?$/i.test(file)) return fs.createReadStream(file);

  if (hasCommand('zstd', ['--version'])) {
    return spawn('zstd', ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] }).stdout;
  }
  const py = pythonCommand();
  if (py && hasCommand(py, ['-c', 'import zstandard'])) {
    return spawn(py, ['-c', PY_DECOMPRESS, file], { stdio: ['ignore', 'pipe', 'inherit'] }).stdout;
  }
  throw new Error(
    'Cannot decompress a .zst file: no `zstd` CLI and no Python `zstandard` module. '
    + 'Run `zstd -d <file>` first, or `pip install zstandard`.'
  );
}

/** Split one CSV record, honouring double-quoted fields. */
function splitRow(line, delimiter) {
  if (delimiter === '|') return line.split('|');
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

/** The current download is comma-separated; older copies are pipe-separated. */
function detectDelimiter(headerLine) {
  const pipes = (headerLine.match(/\|/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return pipes > commas ? '|' : ',';
}

function parseLine(line, delimiter) {
  const parts = splitRow(line, delimiter);
  if (parts.length < 8) return null;
  const [puzzleId, fen, moves, rating, rdev, popularity, nbPlays, themes, gameUrl, openingTags] = parts;
  if (!puzzleId || !fen || !moves) return null;
  return {
    puzzle_id: puzzleId.trim(),
    fen: fen.trim(),
    moves: moves.trim(),
    rating: Number(rating) || null,
    rating_deviation: Number(rdev) || null,
    popularity: Number(popularity) || 0,
    nb_plays: Number(nbPlays) || 0,
    themes: (themes || '').trim().split(/\s+/).filter(Boolean),
    game_url: gameUrl ? gameUrl.trim() : null,
    opening_tags: (openingTags || '').trim().split(/\s+/).filter(Boolean),
  };
}

async function insertBatch(rows) {
  if (!rows.length) return 0;
  const cols = ['puzzle_id', 'fen', 'moves', 'rating', 'rating_deviation',
    'popularity', 'nb_plays', 'themes', 'game_url', 'opening_tags'];
  const values = [];
  const tuples = rows.map((row, i) => {
    const base = i * cols.length;
    values.push(row.puzzle_id, row.fen, row.moves, row.rating, row.rating_deviation,
      row.popularity, row.nb_plays, row.themes, row.game_url, row.opening_tags);
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`;
  });
  await db.pool.query(
    `INSERT INTO lichess_puzzles (${cols.join(',')})
     VALUES ${tuples.join(',')}
     ON CONFLICT (puzzle_id) DO UPDATE SET
       fen = EXCLUDED.fen, moves = EXCLUDED.moves, rating = EXCLUDED.rating,
       rating_deviation = EXCLUDED.rating_deviation, popularity = EXCLUDED.popularity,
       nb_plays = EXCLUDED.nb_plays, themes = EXCLUDED.themes,
       game_url = EXCLUDED.game_url, opening_tags = EXCLUDED.opening_tags`,
    values
  );
  return rows.length;
}

async function main() {
  if (!source) {
    console.error('No CSV given. Pass a path or set LICHESS_PUZZLE_CSV.');
    console.error('  node scripts/importLichessPuzzles.js C:/data/lichess_db_puzzle.csv');
    process.exit(1);
  }
  const file = path.resolve(source);
  if (!fs.existsSync(file)) {
    console.error(`Lichess puzzle file not found: ${file}`);
    console.error('Set LICHESS_PUZZLE_CSV to the CSV (or .csv.zst) location.');
    process.exit(1);
  }

  console.log(`Importing ${file}`);
  if (LIMIT) console.log(`  limit: ${LIMIT} rows`);

  const stream = openCsvStream(file);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let read = 0;
  let imported = 0;
  let skipped = 0;
  let batch = [];
  let delimiter = null;
  const startedAt = Date.now();

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    if (!delimiter) {
      delimiter = detectDelimiter(line);
      if (/^PuzzleId[|,]/i.test(line)) continue;   // header
    }
    if (LIMIT && read >= LIMIT) break;
    read += 1;
    const row = parseLine(line, delimiter);
    if (!row) { skipped += 1; continue; }
    batch.push(row);
    if (batch.length >= BATCH) {
      imported += await insertBatch(batch);
      batch = [];
      const rate = Math.round(imported / Math.max(1, (Date.now() - startedAt) / 1000));
      process.stdout.write(`\r  imported ${imported} (${rate}/s)   `);
    }
  }
  imported += await insertBatch(batch);

  const total = await db.pool.query('SELECT COUNT(*)::int AS n FROM lichess_puzzles');
  console.log(`\nDone — read ${read}, imported ${imported}, skipped ${skipped}.`);
  console.log(`lichess_puzzles now holds ${total.rows[0].n} puzzles.`);
}

main()
  .catch((err) => {
    console.error('\nImport failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
