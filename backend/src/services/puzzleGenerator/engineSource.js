/* Engine-mined puzzle source.
 *
 * Positions are taken from the games already in the database (GM library and
 * imported PGNs), searched with Stockfish at depth 18 / MultiPV 2, and kept
 * only when the best move is clearly better than the runner-up. That
 * uniqueness gate is what makes the stored solution defensible: a puzzle whose
 * second-best move is nearly as good is not a puzzle.
 *
 * Balanced grandmaster positions almost never show a 150cp gap between the top
 * two moves, so the pool is deliberately biased toward forcing positions
 * (loose pieces, checks, exposed kings) and every one goes through a cheap
 * depth-8 screen before the expensive depth-18 confirmation.
 *
 * The starting FEN is the position where the solver moves first — there is no
 * opponent "setup" move here, unlike the Lichess source.
 */

const crypto = require('crypto');
const { Chess } = require('chess.js');
const db = require('../../config/database');
const { detectThemes } = require('./themeDetectors');
const { fenKeyOf } = require('./fenKey');

const DEFAULT_DEPTH = Number(process.env.PUZZLE_ENGINE_DEPTH || 18);
const SCREEN_DEPTH = 8;
const SCREEN_GAP_CP = 100;
const DEFAULT_TIMEOUT_MS = Number(process.env.PUZZLE_ENGINE_TIMEOUT_MS || 20000);
const SCREEN_TIMEOUT_MS = 8000;
const MIN_GAP_CP = 150;
const MAX_SOLVER_MOVES = 4;
const MATE_CP = 10000;
const DECIDED_CP = 700;
const DECIDED_MATERIAL = 4;

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialBalance(chess) {
  let balance = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const v = PIECE_VALUE[piece.type] || 0;
      balance += piece.color === 'w' ? v : -v;
    }
  }
  return balance;
}

function kingSquare(chess, color) {
  for (let f = 0; f < 8; f += 1) {
    for (let r = 0; r < 8; r += 1) {
      const sq = 'abcdefgh'[f] + (r + 1);
      const p = chess.get(sq);
      if (p && p.type === 'k' && p.color === color) return sq;
    }
  }
  return null;
}

function enemyEscapeSquares(chess, color) {
  const king = kingSquare(chess, color);
  if (!king) return 8;
  const f0 = king.charCodeAt(0) - 97;
  const r0 = Number(king[1]) - 1;
  let open = 0;
  for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const f = f0 + df;
    const r = r0 + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    const sq = 'abcdefgh'[f] + (r + 1);
    const piece = chess.get(sq);
    if (piece && piece.color === color) continue;
    if (!chess.isAttacked(sq, color === 'w' ? 'b' : 'w')) open += 1;
  }
  return open;
}

/**
 * How much this position looks like a tactic waiting to happen. Used only to
 * rank candidates — the engine still decides what is actually best.
 */
function tacticalScore(chess) {
  const us = chess.turn();
  const them = us === 'w' ? 'b' : 'w';
  let score = 0;
  for (const move of chess.moves({ verbose: true })) {
    if (move.captured) {
      const gain = (PIECE_VALUE[move.captured] || 0) - (PIECE_VALUE[move.piece] || 0);
      const defended = chess.attackers(move.to, them).length > 0;
      if (!defended && (PIECE_VALUE[move.captured] || 0) >= 3) score += 5;
      else if (gain >= 2) score += 3;
      else if (gain > 0) score += 1;
    }
    if (move.san.includes('#')) score += 6;
    else if (move.san.includes('+')) score += move.captured ? 3 : 2;
  }
  score += Math.max(0, 3 - enemyEscapeSquares(chess, them));
  return score;
}

function puzzleIdFor(fen) {
  return `engine-${crypto.createHash('sha1').update(fenKeyOf(fen)).digest('hex').slice(0, 16)}`;
}

/** Positions ~10 moves deep from one PGN, sampled so long games don't dominate. */
function positionsFromPgn(pgn, { startPly = 20, step = 5, max = 8 } = {}) {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return [];
  }
  const history = chess.history({ verbose: true });
  if (history.length < startPly + 1) return [];

  const replay = new Chess();
  const out = [];
  for (let i = 0; i < history.length; i += 1) {
    replay.move(history[i].san);
    if (i + 1 < startPly) continue;
    if ((i + 1 - startPly) % step !== 0) continue;
    if (replay.isGameOver() || replay.isCheck()) continue;
    // Threefold is not "game over" in chess.js; positions already repeating
    // themselves produce draws rather than tactics.
    if (replay.isThreefoldRepetition()) continue;
    if (Math.abs(materialBalance(replay)) >= DECIDED_MATERIAL) continue;
    const score = tacticalScore(replay);
    if (score <= 0) continue;
    out.push({ fen: replay.fen(), score });
    if (out.length >= max) break;
  }
  return out;
}

/** Random spread of positions across every game source, best tactical starts first. */
async function loadCandidatePositions({ games = 120, library = 60, limit = 320 } = {}) {
  const [gm, lib] = await Promise.all([
    db.query('SELECT id, pgn FROM gm_games ORDER BY random() LIMIT $1', [games]),
    db.query(`SELECT id, COALESCE(pgn, notation) AS pgn FROM library_items
               WHERE type = 'pgn' ORDER BY random() LIMIT $1`, [library]),
  ]);
  const positions = [];
  const seen = new Set();
  for (const row of [...gm.rows, ...lib.rows]) {
    for (const candidate of positionsFromPgn(row.pgn)) {
      const key = fenKeyOf(candidate.fen);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      positions.push(candidate);
    }
  }
  positions.sort((a, b) => b.score - a.score);
  const top = positions.slice(0, limit);
  // Shuffle inside the cut so a run does not always open in the same games.
  for (let i = top.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [top[i], top[j]] = [top[j], top[i]];
  }
  return top.map((p) => p.fen);
}

function uciToSanLine(fen, uciMoves) {
  const chess = new Chess(fen);
  const san = [];
  const uci = [];
  for (const move of uciMoves) {
    let played;
    try {
      played = chess.move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move.length > 4 ? move[4] : undefined,
      });
    } catch {
      break;
    }
    if (!played) break;
    san.push(played.san);
    uci.push(move);
    if (chess.isCheckmate()) break;
  }
  return { san, uci, mate: chess.isCheckmate() };
}

/** Solver moves land on even SAN indexes; cut a dangling opponent reply. */
function trimToSolverSwing(san, uci) {
  let n = Math.min(san.length, MAX_SOLVER_MOVES * 2 - 1);
  if (n % 2 === 0) n -= 1;
  return { san: san.slice(0, n), uci: uci.slice(0, n) };
}

function difficultyFromGap(gapCp) {
  if (gapCp >= 600) return 'Easy';
  if (gapCp >= 300) return 'Medium';
  return 'Hard';
}

/**
 * Mine puzzles for one topic.
 *
 * @param {object} args
 * @param {object} args.pool         engine pool from stockfish.js
 * @param {object} args.topic        entry from topics.js (must have `engine`)
 * @param {number} args.count        how many puzzles to aim for
 * @param {string} args.difficulty   requested label, or null to derive it
 * @param {Set<string>} args.exclude fen keys already taken
 * @param {(p:number, msg:string)=>void} args.onProgress
 * @param {()=>boolean} args.isCancelled
 */
async function mineEnginePuzzles({
  pool,
  topic,
  count = 6,
  difficulty = null,
  exclude = new Set(),
  onProgress = () => {},
  isCancelled = () => false,
  depth = DEFAULT_DEPTH,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!topic.engine) return { puzzles: [], evaluated: 0, warning: null };

  let positions;
  try {
    positions = await loadCandidatePositions();
  } catch (err) {
    return { puzzles: [], evaluated: 0, warning: `Could not read games for engine mining: ${err.message}` };
  }
  if (!positions.length) {
    return {
      puzzles: [],
      evaluated: 0,
      warning: 'No usable positions were found in your games — add some GM or imported PGN games.',
    };
  }

  const puzzles = [];
  const seen = new Set(exclude);
  const maxScans = Math.min(positions.length, Math.max(120, count * 22));
  let scanned = 0;
  let evaluated = 0;

  for (let i = 0; i < maxScans && puzzles.length < count; i += 1) {
    if (isCancelled()) break;
    const fen = positions[i];
    scanned += 1;
    if (scanned % 2 === 0) {
      onProgress(Math.min(90, 34 + Math.round((scanned / maxScans) * 54)), `Running Stockfish (depth ${depth}, MultiPV 2)`);
    }

    // Cheap screen: is there a big gap at all? Balanced positions stop here.
    let shallow;
    try {
      shallow = await pool.search(fen, { depth: SCREEN_DEPTH, multiPv: 2, timeoutMs: SCREEN_TIMEOUT_MS });
    } catch {
      continue;
    }
    const shallowLines = shallow.lines || [];
    if (shallowLines.length < 2) continue;
    const shallowGap = shallowLines[0].cp - shallowLines[1].cp;
    const shallowMate = shallowLines[0].cp >= MATE_CP - 200;
    if (!shallowMate && shallowGap < SCREEN_GAP_CP) continue;

    evaluated += 1;
    let result;
    try {
      result = await pool.search(fen, { depth, multiPv: 2, timeoutMs });
    } catch {
      continue;
    }
    const lines = result.lines || [];
    if (lines.length < 2) continue;

    const [best, second] = lines;
    const gap = best.cp - second.cp;
    const isMate = best.cp >= MATE_CP - 200;
    if (!isMate && gap < MIN_GAP_CP) continue;

    const solverColor = new Chess(fen).turn();
    const absolute = solverColor === 'w' ? best.cp : -best.cp;
    if (!isMate && Math.abs(absolute) >= DECIDED_CP) continue;   // already decided

    const line = uciToSanLine(fen, best.pv || []);
    if (!line.san.length) continue;
    const trimmed = trimToSolverSwing(line.san, line.uci);
    if (!trimmed.san.length) continue;

    const detection = detectThemes(fen, trimmed.san);
    if (!detection.themes.includes(topic.engine)) continue;

    const key = fenKeyOf(fen);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    puzzles.push({
      id: puzzleIdFor(fen),
      source: 'engine',
      fen,
      solverColor,
      theme: topic.label,
      themes: detection.themes,
      difficulty: difficulty || difficultyFromGap(gap),
      rating: null,
      engineGap: gap,
      engineDepth: depth,
      solutionUci: trimmed.uci,
      solutionSan: trimmed.san,
    });
  }

  return { puzzles, evaluated, scanned, warning: null };
}

module.exports = {
  mineEnginePuzzles,
  loadCandidatePositions,
  positionsFromPgn,
  uciToSanLine,
  MIN_GAP_CP,
};
