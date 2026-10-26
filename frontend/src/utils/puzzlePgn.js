// ─────────────────────────────────────────────────────────────────────────────
// Puzzle PGN builder.
//
// Turns a saved Game Review line into a solvable puzzle: a starting FEN plus a
// full Standard Algebraic Notation (SAN) move sequence written out as a proper
// PGN with [FEN]/[SetUp "1"] headers, so external viewers (Lichess, chess.com)
// load the right starting position and the move list is correctly numbered
// from the FEN's fullmove counter (not always move 1).
//
// All SAN is produced by chess.js by actually replaying the moves from the
// FEN, so captures (x), checks (+), mates (#), disambiguation (Nbd7),
// castling (O-O/O-O-O), promotions (e8=Q) and en passant are always legal and
// correct. Illegal moves are rejected before anything is saved.
// ─────────────────────────────────────────────────────────────────────────────

import { Chess } from 'chess.js';
import { APP_NAME } from '../config/brand';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function normalizeFen(fen) {
  return fen && fen !== 'start' ? fen : START_FEN;
}

/**
 * Build a puzzle PGN from a starting FEN and an ordered SAN move list
 * (the solution line). Every move is validated by replaying it with chess.js.
 *
 * Returns:
 *   { startFen, pgn, moves }  on success (moves = the resolved SAN list)
 *   { startFen, pgn: null, moves: [], error }  if any move is illegal/invalid
 */
export function buildPuzzlePgn({ fen, moves }) {
  const startFen = normalizeFen(fen);

  let game;
  try {
    game = new Chess(startFen);
  } catch {
    return { startFen, pgn: null, moves: [], error: 'Invalid starting FEN — this position cannot be saved as a puzzle.' };
  }

  const sanList = [];
  for (const m of moves || []) {
    if (!m) continue;
    let mv;
    try {
      mv = game.move(m);
    } catch {
      return {
        startFen,
        pgn: null,
        moves: [],
        error: `Illegal move "${m}" from the starting position — this line cannot be saved as a puzzle.`,
      };
    }
    sanList.push(mv.san);
  }

  return { startFen, pgn: renderPgn({ startFen, sanList }), moves: sanList, error: '' };
}

/*
 * Render the PGN. Headers follow standard puzzle conventions. The movetext is
 * written in pair style matching the FEN: if Black is to move first the line
 * opens with "N... X", then pairs "N+1. w b"; otherwise plain "1. w b 2. w b".
 * This is exactly the shape Lichess/chess.com PGN viewers expect.
 */
function renderPgn({ startFen, sanList }) {
  const [, side, , , , fullmoveRaw] = startFen.split(/\s+/);
  let num = parseInt(fullmoveRaw, 10) || 1;
  let turn = side === 'b' ? 'b' : 'w';

  const tokens = [];
  let i = 0;
  if (turn === 'b' && sanList.length) {
    tokens.push(`${num}... ${sanList[0]}`);
    num += 1;
    i = 1;
  }
  for (; i < sanList.length; i += 2) {
    const white = sanList[i];
    const black = sanList[i + 1];
    tokens.push(black ? `${num}. ${white} ${black}` : `${num}. ${white}`);
    num += 1;
  }

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const headers = [
    '[Event "Puzzle"]',
    `[Site "${APP_NAME}"]`,
    `[Date "${date}"]`,
    '[Round "1"]',
    '[White "White"]',
    '[Black "Black"]',
    '[Result "*"]',
    '[SetUp "1"]',
    `[FEN "${startFen}"]`,
  ];

  return `${headers.join('\n')}\n\n${tokens.length ? tokens.join(' ') : '*'}`;
}