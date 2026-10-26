/* ── Review navigation → MoveEffect ─────────────────────────────────────────
 *
 * ONE entry point for stepping through a finished game. Every navigation path
 * (next/previous, undo/redo, notation click, jump-to-start/end, keyboard) calls
 * this with the ply it lands on, so the effect is chosen from the STORED
 * move/verdict and never from whatever the board happens to diff afterwards.
 *
 * The effect type is data, not live detection:
 *   move.promotion        -> promotion
 *   position is mate      -> checkmate
 *   stored verdict sigma  -> brilliant
 *   anything else         -> no effect (cleanup only)
 */

import { playMoveEffect, clearMoveEffects } from './index.js';
import { isSigmaVerdict } from '../../utils/sigmaType.js';

function verboseMove(game, moveIndex) {
  if (!game) return null;
  try {
    const history = game.history({ verbose: true });
    return history[moveIndex - 1] || null;
  } catch {
    return null;
  }
}

function logTrigger(source, moveIndex, type, state, runId) {
  try {
    if (state === 'started') {
      console.debug(`[effect] run=${runId ?? '-'} source=${source} move=${moveIndex} type=${type} started`);
    } else {
      console.debug(`[effect] run=- source=${source} move=${moveIndex} skipped(${type})`);
    }
  } catch { /* ignore */ }
}

/**
 * @param {number} moveIndex 1-based ply the board now shows (0 = start).
 * @param {string} source    navigation channel used in the debug log.
 * @param {object} opts
 * @param {object} opts.game  chess.js position AFTER moveIndex.
 * @param {object} [opts.move] explicit verbose move (live board path, where the
 *   controlled game may have been rebuilt from a FEN and lost its history).
 * @param {string} [opts.verdict] stored review verdict for this ply.
 * @param {boolean} [opts.sacrifice]
 * @param {string} [opts.boardId] explicit host id (otherwise the active board).
 * @param {'white'|'black'} [opts.orientation]
 */
export function playEffectForMove(moveIndex, source = 'review-nav', {
  game,
  move: explicitMove = null,
  verdict = null,
  sacrifice = false,
  boardId = null,
  orientation = 'white',
} = {}) {
  if (!game || !Number.isFinite(moveIndex) || moveIndex < 1) {
    logTrigger(source, moveIndex, 'no-position', 'skipped');
    clearMoveEffects(source);
    return null;
  }

  const move = explicitMove || verboseMove(game, moveIndex);
  if (!move) {
    logTrigger(source, moveIndex, 'no-move', 'skipped');
    clearMoveEffects(source);
    return null;
  }

  let isMate = false;
  try { isMate = game.isCheckmate(); } catch { /* malformed position */ }

  /* The event is read from the MOVE DATA, never from a badge or a popup:
     a promotion from the verbose move (or the "=" in its SAN), a mate from the
     position the move produced (or the "#" in its SAN), and a brilliant from
     the engine's own classification for this ply. */
  const san = String(move.san || '');
  const isPromotion = Boolean(move.promotion) || san.includes('=');
  const isCheckmate = isMate || san.endsWith('#');

  const type = isPromotion
    ? 'promotion'
    : (isCheckmate ? 'checkmate' : (isSigmaVerdict(verdict) ? 'brilliant' : null));

  if (!type) {
    logTrigger(source, moveIndex, 'nothing-to-play', 'skipped');
    clearMoveEffects(source);
    return null;
  }

  const captured = move.captured
    ? {
      square: move.flags && move.flags.includes('e') ? move.to[0] + move.from[1] : move.to,
      code: `${move.color === 'w' ? 'b' : 'w'}${String(move.captured).toUpperCase()}`,
    }
    : null;

  const request = playMoveEffect({
    type,
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: move.color,
    promotionPiece: move.promotion || (san.includes('=') ? san.split('=')[1] : null) || null,
    captured,
    sacrifice: Boolean(sacrifice),
    boardOrientation: orientation,
    boardId: boardId || undefined,
    source,
    moveIndex,
    fen: game.fen(),
  });

  logTrigger(source, moveIndex, type, request ? 'started' : 'skipped', request?.runId);
  return request;
}
