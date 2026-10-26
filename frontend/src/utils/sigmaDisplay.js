/* Brilliant-move DISPLAY helpers.
 *
 * The stored sigma row is what the analysis pipeline produced: (game source,
 * game id, ply), the move's SAN, its from/to squares and the position BEFORE it.
 * This module turns that row into the two things a board needs — the position
 * AFTER the move, and the canonical Brilliant colours — without touching the
 * classification itself. Nothing here re-derives a verdict: the sigma verdict is
 * read, never recomputed.
 *
 * WHY THE "AFTER" POSITION MATTERS. A card drawing `fenBefore` shows the empty
 * square the sacrifice is about to occupy, so the moment that makes the move
 * brilliant is the one thing missing — and for a capture the destination still
 * holds the piece being taken. The board must show the move already played.
 */

import { Chess } from 'chess.js';
import { reviewMetaFor } from './gameReview.js';
import { SIGMA_VERDICT } from './sigmaType.js';

/** The canonical Brilliant/Sigma badge colour, from REVIEW_META.
 *
 *  Read through reviewMetaFor rather than hardcoded: REVIEW_META is where the
 *  review board gets its badge, arrow and square-tint colours, so this can only
 *  ever agree with it. One definition of "Brilliant" exists; this reuses it. */
export function brilliantColor() {
  return reviewMetaFor(SIGMA_VERDICT)?.color || '#19c9c3';
}

/** The canonical Brilliant accent, for a square highlight. */
export function brilliantDeepColor() {
  return reviewMetaFor(SIGMA_VERDICT)?.deep || '#0a807d';
}

/**
 * Play a stored move on its own before-position and return the resulting FEN.
 *
 * Uses the canonical from/to squares (plus the promotion piece carried in the
 * SAN) rather than re-parsing the move number or the board, so the arrow and
 * the resulting position can never disagree about which move this was.
 *
 * @param {{fenBefore?:string, fromSquare?:string, toSquare?:string, moveSan?:string}} move
 * @returns {string|null} the FEN AFTER the move, or null when it cannot be
 *   derived (no stored position, or the squares do not form a legal move).
 */
export function sigmaMoveAfterFen(move) {
  if (!move || !move.fenBefore || !move.fromSquare || !move.toSquare) return null;
  try {
    const game = new Chess(move.fenBefore);
    /* The promotion piece lives in the SAN ("b8=N"); from/to are two letters
       only, so without this a promoting move could not be replayed.
       Lower-cased because PGN writes the piece uppercase and chess.js matches
       its own lowercase codes — "N" is rejected as an invalid move, which is
       how an underpromotion used to lose its whole board. */
    const san = move.moveSan || '';
    const promo = /=/.test(san) ? san.slice(san.indexOf('=') + 1).trim().toLowerCase() : undefined;
    const played = game.move({
      from: move.fromSquare,
      to: move.toSquare,
      promotion: promo,
    });
    return played ? game.fen() : null;
  } catch {
    return null;
  }
}

/**
 * The position to draw for a Brilliant card, plus the move drawn on it.
 *
 * Returns null when nothing can be shown, so the caller renders its explicit
 * "position unavailable" placeholder instead of an empty grid that reads as a
 * position with no pieces.
 *
 * @returns {{fen:string, from:string, to:string, color:string, isAfter:boolean}|null}
 */
export function sigmaCardBoard(move) {
  const after = sigmaMoveAfterFen(move);
  if (!after) return null;
  return {
    fen: after,
    from: move.fromSquare,
    to: move.toSquare,
    color: brilliantColor(),
    isAfter: true,
  };
}

/**
 * The board destination square for a move, for the badge overlay.
 *
 * @returns {{square:string, file:number, rank:number}|null}
 */
export function destinationBadge(fromSquare, toSquare) {
  if (!toSquare || toSquare.length < 2) return null;
  return {
    square: toSquare,
    file: toSquare.charCodeAt(0) - 97,   // 0-7
    rank: Number(toSquare[1]) - 1,       // 0-7
  };
}

/**
 * How many moves of a game must be replayed to leave the board ON the given
 * ply, showing that ply's move already played.
 *
 * A review ply is 0-based, so ply 49 is the game's 50th move and the position
 * after it is reached by replaying ply + 1 moves. Getting this wrong by one
 * lands the board on the position BEFORE the selected move — the reported bug —
 * and it is off by one differently for White and Black if the move NUMBER is
 * used instead of the ply (25...Bxg3 is ply 49, not "move 25").
 *
 * @param {number} ply 0-based review ply
 * @param {number} [moveCount] total moves in the game. Optional: the stored
 *   sigma row does not carry it, so a missing total means "do not clamp" —
 *   clamping against an unknown length would resolve to 0 and drop the board on
 *   the starting position, which is exactly the bug this conversion exists to
 *   avoid. The card clamps against the real move list once it has the game.
 * @returns {number} moves to replay
 */
export function plyToMoveIndex(ply, moveCount) {
  const p = Number(ply);
  if (!Number.isFinite(p) || p < 0) return 0;
  const index = Math.floor(p) + 1;
  const total = Number(moveCount);
  if (!Number.isFinite(total) || total <= 0) return index;
  return Math.max(0, Math.min(total, index));
}