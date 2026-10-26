#!/usr/bin/env node

/**
 * Lichess Puzzle Importer
 *
 * Imports puzzles from the official Lichess puzzle CSV database.
 *
 * Download the CSV first:
 *   curl -L -o lichess_puzzles.csv https://database.lichess.org/lichess_db_puzzle.csv.zst
 *   (then decompress with: zstd -d lichess_puzzles.csv.zst)
 *
 * Or grab a smaller subset from: https://database.lichess.org/
 *
 * Usage:
 *   node scripts/importLichessPuzzles.js <path-to-csv> [--limit N] [--difficulty Medium]
 *
 * CSV format (pipe-delimited):
 *   PuzzleId|FEN|Moves|Rating|RatingDeviation|Popularity|NbPlays|Themes|GameUrl|OpeningTags
 *
 * The first move in Moves is the "trigger" (opponent's last move before the puzzle).
 * The remaining moves alternate: solver, opponent, solver, …
 * The Rating column is ignored — it is neither validated nor stored.
 */

const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const { pool } = require('../src/config/database');

const args = process.argv.slice(2);
const csvPath = args[0];

if (!csvPath) {
  console.error('Usage: node scripts/importLichessPuzzles.js <csv-path> [--limit N] [--difficulty Level]');
  process.exit(1);
}

function getArg(flag, defaultVal) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? (isNaN(Number(args[i + 1])) ? args[i + 1] : Number(args[i + 1])) : defaultVal;
}

const LIMIT = Number(getArg('--limit', 5000)) || 5000;
const DIFFICULTY = String(getArg('--difficulty', 'Medium')).trim();

const THEME_MAP = {
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  sacrifice: 'Sacrifice',
  discoveredAttack: 'Discovered Attack',
  doubleCheck: 'Double Check',
  trappedPiece: 'Trapped Piece',
  deflection: 'Deflection',
  attraction: 'Attraction',
  intermezzo: 'Intermezzo',
  xrayAttack: 'X-Ray Attack',
  zugzwang: 'Zugzwang',
  hangingPiece: 'Hanging Piece',
  capturedDefender: 'Capture Defender',
  clearance: 'Clearance',
  quietMove: 'Quiet Move',
  backRankMate: 'Back-Rank Mate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4',
  mateIn5: 'Mate in 5',
  promotion: 'Promotion',
  underpromotion: 'Underpromotion',
  enPassant: 'En Passant',
  castling: 'Castling',
  cramping: 'Cramping',
  outOfComputingLine: 'Out of Computing Line',
  activitiece: 'Activity',
 ':': '',
};

function mapDifficulty() {
  const v = String(DIFFICULTY).trim();
  const cap = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return ['Easy', 'Medium', 'Hard', 'Expert'].includes(cap) ? cap : 'Medium';
}

function uciToSan(chess, uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  try {
    const move = chess.move({ from, to, promotion });
    return move ? move.san : null;
  } catch {
    return null;
  }
}

function processPuzzle(puzzleId, fen, movesStr, popularity, nbPlays, themesStr, gameUrl, openingTagsStr) {
  const allMoves = movesStr.trim().split(/\s+/);
  if (allMoves.length < 2) return null;

  const triggerMove = allMoves[0];
  const solutionMoves = allMoves.slice(1);

  // Apply trigger move to get the puzzle starting position
  const chess1 = new Chess(fen);
  const triggerSan = uciToSan(chess1, triggerMove);
  if (!triggerSan) return null;
  const puzzleFen = chess1.fen();

  // Verify all solution moves are legal
  const chess2 = new Chess(puzzleFen);
  const solutionSan = [];
  for (const uci of solutionMoves) {
    const san = uciToSan(chess2, uci);
    if (!san) return null;
    solutionSan.push(san);
  }

  const themes = themesStr
    ? themesStr.trim().split(/\s+/).filter(Boolean)
    : [];

  const primaryTheme = themes.length > 0 ? (THEME_MAP[themes[0]] || themes[0]) : 'Tactics';

  const openingTags = openingTagsStr
    ? openingTagsStr.trim().split(/\s+/).filter(Boolean)
    : [];

  return {
    lichess_id: puzzleId,
    fen: puzzleFen,
    solution: solutionSan,
    theme: primaryTheme,
    themes: themes,
    difficulty: mapDifficulty(),
    popularity: Math.round(Number(popularity) || 0),
    nb_plays: Number(nbPlays) || 0,
    game_url: gameUrl || null,
    opening_tags: openingTags,
  };
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`Reading puzzles from ${csvPath}`);
  console.log(`Filters: limit=${LIMIT}, difficulty=${mapDifficulty()}`);

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim());

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const batch = [];

  for (let i = 0; i < lines.length && imported < LIMIT; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('PuzzleId')) continue; // skip header

    const parts = line.split(',');
    if (parts.length < 7) { errors++; continue; }

    const [puzzleId, fen, moves, , , popularity, nbPlays, themes, gameUrl, openingTags] = parts;

    const puzzle = processPuzzle(puzzleId, fen, moves, popularity, nbPlays, themes, gameUrl, openingTags);
    if (!puzzle) { errors++; continue; }

    batch.push(puzzle);
    imported++;

    if (batch.length >= 500) {
      await insertBatch(batch);
      batch.length = 0;
      process.stdout.write(`\r  Imported: ${imported} / ${LIMIT}`);
    }
  }

  if (batch.length > 0) {
    await insertBatch(batch);
  }

  console.log(`\n\nDone! Imported: ${imported}, Skipped: ${skipped}, Errors: ${errors}`);
  await pool.end();
}

async function insertBatch(puzzles) {
  const values = [];
  const placeholders = [];
  let idx = 1;

  for (const p of puzzles) {
    const row = [
      p.lichess_id, p.fen, JSON.stringify(p.solution), p.theme, p.themes,
      p.difficulty, p.explanation || null, p.nb_plays,
      p.popularity, p.game_url, p.opening_tags,
    ];
    placeholders.push(
      `(${row.map(() => `$${idx++}`).join(',')})`
    );
    values.push(...row);
  }

  const sql = `
    INSERT INTO puzzles (lichess_id, fen, solution, theme, themes, difficulty, explanation, nb_plays, popularity, game_url, opening_tags)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (lichess_id) DO UPDATE SET
      nb_plays = EXCLUDED.nb_plays,
      popularity = EXCLUDED.popularity
  `;

  try {
    await pool.query(sql, values);
  } catch (err) {
    console.error('\nBatch insert error:', err.message);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});