import { Chess } from 'chess.js';
import api from '../services/api';
import { classifySigmaFromPly } from './sigmaType';
import { buildSigmaPayload } from './sigmaPayload';

/* The payload builder is pure and lives in its own module (sigmaPayload.js) so
   it can be read without a browser; it is re-exported here because this is the
   module the app has always imported it from. */
export { buildSigmaPayload };

/* ── Σ Sigma persistence ──────────────────────────────────────────────────────
   After a review finishes, its Sigma moves are POSTed so they can be listed
   across games and across all four places a game can come from (chess.com
   imports, coach games, computer games, tournaments).

   WHY THIS IS OPTIONAL AND SILENT
   A Sigma list is a nice-to-have next to the review itself, so a failed save
   must never interfere with the review the player is looking at. Everything
   here therefore resolves quietly: the caller gets a result, not a throw.

   WHY A GAME WITH NO SIGMA IS STILL POSTED
   The API replaces a game's whole set. If a game that used to have Sigmas is
   re-analysed (after a detector fix or a deeper engine) and now has none, the
   only way to clear the stale rows is to post an empty batch — and the
   controller explicitly allows that, having already ownership-checked the game.
   Without this, a move the current engine no longer considers brilliant would
   sit in the list forever. */

export const SIGMA_SOURCES = ['chess_profile', 'online', 'computer', 'tournament'];

/** FEN before each ply, replayed from the game — the review rows do not carry
 *  it, and a Sigma card needs it to draw the position the move was played in. */
function fenBeforePly(initialFen, moves, ply) {
  try {
    const g = new Chess(initialFen && initialFen !== 'start' ? initialFen : undefined);
    for (let i = 0; i < ply; i += 1) {
      /* strict:false — an imported PGN can contain SAN the current position
         makes ambiguous; skipping a move would silently shift every later
         FEN, so a failure returns null instead and the card is simply skipped. */
      if (!g.move(moves[i], { strict: false })) return null;
    }
    return g.fen();
  } catch {
    return null;
  }
}

/**
 * POST the Sigmas from a finished review.
 *
 * `playedAt` is when the GAME was played, not when it was reviewed — otherwise
 * reviewing an old game today would make it appear in the "last 7 days" filter.
 *
 * @param {object} args
 * @param {object} args.review     reviewGame() result
 * @param {string} args.gameSource one of SIGMA_SOURCES
 * @param {number} args.gameId     id in that source's table
 * @param {string} args.initialFen the game's starting position
 * @param {string[]} args.moves    the game's SAN moves
 * @param {object} [args.meta]     { playedAt, whiteName, blackName, whiteRating, blackRating }
 * @returns {Promise<{ok: boolean, saved?: number, error?: string}>}
 */
export async function persistSigmaMoves({
  review, gameSource, gameId, initialFen, moves, meta = {},
}) {
  if (!SIGMA_SOURCES.includes(gameSource)) {
    return { ok: false, error: `unknown game source '${gameSource}'` };
  }
  if (!Number.isInteger(Number(gameId)) || Number(gameId) <= 0) {
    return { ok: false, error: 'no game id to attach the moves to' };
  }

  const payload = buildSigmaPayload(review).map((m) => {
    const fenBefore = fenBeforePly(initialFen, moves || [], m.ply);
    /* Name the type when the review did not carry one. The review's rows only
       have a type when the geometry could read it off; a protected sacrifice
       (the piece stays defended) has none, and the move would then be missing
       from the list even though the review calls it brilliant. The type is
       re-derived from the SAME classifier the review used, so the list and the
       review can never disagree. */
    let sigmaType = m.sigmaType;
    let fromSquare = m.fromSquare;
    let toSquare = m.toSquare;
    if (!sigmaType && fenBefore && m.moveSan) {
      try {
        const named = classifySigmaFromPly({ fenBefore, moveSan: m.moveSan, isSigma: true });
        if (named) {
          sigmaType = named.type;
          fromSquare = fromSquare || named.fromSquare;
          toSquare = toSquare || named.toSquare;
        }
      } catch { /* cannot classify: the move is left unnamed and skipped below */ }
    }
    return {
      ...m,
      sigmaType,
      fromSquare,
      toSquare,
      gameSource,
      gameId: Number(gameId),
      fenBefore,
      playedAt: meta.playedAt || null,
      whiteName: meta.whiteName || null,
      blackName: meta.blackName || null,
      whiteRating: Number.isFinite(Number(meta.whiteRating)) ? Number(meta.whiteRating) : null,
      blackRating: Number.isFinite(Number(meta.blackRating)) ? Number(meta.blackRating) : null,
    };
  }).filter((m) => m.sigmaType);

  /* The game is named at the TOP LEVEL as well as on each move. An empty batch
     has no move to carry it, and it must still be able to say which game it is
     clearing — without that the API cannot tell which stale rows to remove. */
  try {
    const res = await api.post('/sigma/moves', {
      gameSource,
      gameId: Number(gameId),
      moves: payload,
    });
    return { ok: true, saved: Array.isArray(res.data?.saved) ? res.data.saved : payload.length };
  } catch (err) {
    const message = err && err.response && err.response.data && err.response.data.message
      ? err.response.data.message
      : (err && err.message) || 'save failed';
    /* eslint-disable no-console */
    console.warn('[sigma] could not save moves:', message);
    /* eslint-enable no-console */
    return { ok: false, error: message };
  }
}

/**
 * A game the user is looking at but that has no database id yet — a pasted PGN,
 * a shared link, a board they played out. Its Sigmas belong in the review panel
 * only; there is nothing to attach them to and inventing an id would either
 * collide with a real game's or write rows that belong to nobody.
 */
export function canPersist(gameSource, gameId) {
  return SIGMA_SOURCES.includes(gameSource) && Number.isInteger(Number(gameId)) && Number(gameId) > 0;
}