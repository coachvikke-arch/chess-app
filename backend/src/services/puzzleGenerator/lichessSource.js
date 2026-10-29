/* Lichess puzzle source.
 *
 * Reads the locally imported `lichess_puzzles` copy of lichess_db_puzzle.csv
 * (see scripts/importLichessPuzzles.js) and turns rows into ready-to-show
 * puzzles.
 *
 * The dataset's `Moves` column starts with the OPPONENT's trigger move. That
 * move is applied to the FEN here and then thrown away: the puzzle the admin
 * sees starts with the solver to move and never reveals how the position arose.
 */

const { Chess } = require('chess.js');
const db = require('../../config/database');
const { fenKeyOf } = require('./fenKey');

const RATING_RANGE = {
  easy: [0, 1199],
  medium: [1200, 1800],
  hard: [1801, 4000],
};

function difficultyForRating(rating) {
  if (!rating) return 'Medium';
  if (rating < 1200) return 'Easy';
  if (rating <= 1800) return 'Medium';
  return 'Hard';
}

function uciMoveObject(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

/**
 * One database row → one puzzle, or null when the line is not playable.
 * The trigger move is consumed silently; solution moves are converted to SAN.
 */
function toPuzzle(row, topic) {
  try {
    const chess = new Chess(row.fen);
    const moves = String(row.moves || '').trim().split(/\s+/).filter(Boolean);
    if (moves.length < 2) return null;

    const trigger = moves.shift();
    const triggerMove = chess.move(uciMoveObject(trigger));
    if (!triggerMove) return null;

    const startFen = chess.fen();
    const solverColor = chess.turn();
    const solutionSan = [];
    const solutionUci = [];
    for (const uci of moves) {
      const move = chess.move(uciMoveObject(uci));
      if (!move) return null;
      solutionSan.push(move.san);
      solutionUci.push(uci);
    }
    if (!solutionSan.length) return null;

    const rating = Number(row.rating) || null;
    return {
      id: `lichess-${row.puzzle_id}`,
      source: 'lichess',
      lichessId: row.puzzle_id,
      fen: startFen,
      solverColor,
      theme: topic.label,
      themes: Array.isArray(row.themes) ? row.themes : [],
      difficulty: difficultyForRating(rating),
      rating,
      popularity: Number(row.popularity) || 0,
      gameUrl: row.game_url || null,
      solutionUci,
      solutionSan,
    };
  } catch {
    return null;
  }
}

/**
 * Random sample of puzzles for a topic, filtered by theme tags + rating band.
 *
 * @param {object} args
 * @param {object} args.topic          entry from topics.js
 * @param {string} args.difficulty     'any' | 'easy' | 'medium' | 'hard'
 * @param {number} args.count          how many usable puzzles to return
 * @param {Set<string>} args.exclude   fen keys already taken / already saved
 * @returns {Promise<{ puzzles: object[], scanned: number }>}
 */
async function pickLichessPuzzles({ topic, difficulty = 'any', count = 6, exclude = new Set() }) {
  if (!topic.lichess.length) return { puzzles: [], scanned: 0 };

  const range = difficulty && difficulty !== 'any' ? RATING_RANGE[difficulty] : null;
  // Over-fetch: some rows fail legality checks and duplicates are dropped.
  const limit = Math.max(count * 6, 40);

  const params = [topic.lichess];
  let sql = `SELECT puzzle_id, fen, moves, rating, popularity, themes, game_url
               FROM lichess_puzzles
              WHERE themes && $1::text[]`;
  if (range) {
    params.push(range[0], range[1]);
    sql += ` AND rating BETWEEN $2 AND $3`;
  }
  params.push(limit);
  sql += ` ORDER BY random() LIMIT $${params.length}`;

  const rows = await db.query(sql, params);
  const puzzles = [];
  const seen = new Set();
  for (const row of rows.rows) {
    if (puzzles.length >= count) break;
    const puzzle = toPuzzle(row, topic);
    if (!puzzle) continue;
    const key = fenKeyOf(puzzle.fen);
    if (!key || exclude.has(key) || seen.has(key)) continue;
    seen.add(key);
    puzzles.push(puzzle);
  }
  return { puzzles, scanned: rows.rows.length };
}

/** How many rows exist at all for a topic (used to explain an empty result). */
async function countForTopic(topic) {
  if (!topic.lichess.length) return 0;
  const r = await db.query('SELECT COUNT(*)::int AS n FROM lichess_puzzles WHERE themes && $1::text[]', [topic.lichess]);
  return r.rows[0].n;
}

module.exports = { pickLichessPuzzles, countForTopic, toPuzzle, difficultyForRating };
