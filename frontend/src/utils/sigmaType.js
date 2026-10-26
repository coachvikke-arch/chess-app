import { Chess } from 'chess.js';

/**
 * Sigma move TYPES — the internal classification id.
 *
 * The verdict itself ("this is a brilliant move") is decided by
 * reviewClassify.classifyMove. This module does the second half: deciding WHICH
 * KIND of brilliant move it was, because a certificate of achievement has to say
 * something more interesting than "good move".
 *
 * "Sigma" is INTERNAL. The player-facing name for the top verdict is Brilliant —
 * the verdict id 'sigma' is an implementation detail and must never be rendered
 * (the label lives in REVIEW_META, gameReview.js). The labels defined here name
 * the piece that was given up, so they are independent of the verdict's own name.
 */

export const SIGMA_TYPE = {
  QUEEN: 'queen_sacrifice',
  ROOK: 'rook_sacrifice',
  BISHOP: 'bishop_sacrifice',
  KNIGHT: 'knight_sacrifice',
  UNDERPROMOTION: 'underpromotion',
};

/** Display metadata, highest-value piece first (that is also the filter order). */
export const SIGMA_TYPES_IN_PRIORITY_ORDER = [
  SIGMA_TYPE.QUEEN,
  SIGMA_TYPE.ROOK,
  SIGMA_TYPE.BISHOP,
  SIGMA_TYPE.KNIGHT,
  SIGMA_TYPE.UNDERPROMOTION,
];

export const SIGMA_TYPE_META = {
  [SIGMA_TYPE.QUEEN]: { label: 'Queen Sacrifice', piece: 'q', rank: 5 },
  [SIGMA_TYPE.ROOK]: { label: 'Rook Sacrifice', piece: 'r', rank: 4 },
  [SIGMA_TYPE.BISHOP]: { label: 'Bishop Sacrifice', piece: 'b', rank: 3 },
  [SIGMA_TYPE.KNIGHT]: { label: 'Knight Sacrifice', piece: 'n', rank: 2 },
  [SIGMA_TYPE.UNDERPROMOTION]: { label: 'Underpromotion', piece: 'P', rank: 1 },
};

/**
 * Material values, matching the review pipeline's own scale
 * (gameReview.js PIECE_VAL) so the two never disagree.
 *
 * Bishop (330) sits above knight (320) deliberately — the standard ordering, and
 * what decides which of the two is named when a move gives up both.
 */
const VALUE = { q: 900, r: 500, b: 330, n: 320, p: 100 };

const TYPE_BY_PIECE = {
  q: SIGMA_TYPE.QUEEN,
  r: SIGMA_TYPE.ROOK,
  b: SIGMA_TYPE.BISHOP,
  n: SIGMA_TYPE.KNIGHT,
};

/** Pawns (and anything cheaper) are never a sacrifice; only real pieces are. */
const MIN_SACRIFICE_VALUE = 100;

/* ── Legacy verdict id ────────────────────────────────────────────────────
   Analysis saved before this rename stored the verdict as 'brilliant'. Those rows
   must keep working, so 'brilliant' is read as a Sigma and normalised on the way
   in rather than being silently ignored (or worse, counted twice). */

export const SIGMA_VERDICT = 'sigma';
export const LEGACY_SIGMA_VERDICT = 'brilliant';

/** True for either spelling of the verdict. */
export function isSigmaVerdict(verdict) {
  return verdict === SIGMA_VERDICT || verdict === LEGACY_SIGMA_VERDICT;
}

/** Map a stored verdict onto the current spelling. */
export function normaliseVerdict(verdict) {
  return verdict === LEGACY_SIGMA_VERDICT ? SIGMA_VERDICT : verdict;
}

/* ── Display normalisation ────────────────────────────────────────────────
   THE ONE PLACE THE UI TRANSLATES THE VERDICT ID.

   Every visual component still keys off the 'brilliant' id: REVIEW_META,
   RANK_GLYPHS, the `.move-badge-dot--brilliant` CSS hook, the `is-brilliant`
   cell class, the summary-table row order. A row stored as 'sigma' therefore
   found no metadata and rendered nothing at all — no badge, no tint, no row,
   and (because the tally was keyed by the raw id) a Brilliant count of 0.

   getDisplayVerdict() is what a component calls on the way IN, so the stored
   verdict is untouched and only the rendering path is rewritten. It is the
   counterpart of isSigmaVerdict(): one answers "is this a Sigma?", the other
   "which legacy key do I draw it under". Both are needed — collapsing them into
   one would either lose the distinction or re-introduce the branch this
   replaced. */

export function getDisplayVerdict(verdict) {
  return isSigmaVerdict(verdict) ? LEGACY_SIGMA_VERDICT : verdict;
}

/* ── Detection ───────────────────────────────────────────────────────────*/

/**
 * Mover pieces left hanging after the move — the "or a piece it exposes" half of
 * the sacrifice rule.
 *
 * A piece counts as given away when the opponent can legally take it AND the
 * capture actually wins them material. Pawns and kings never qualify: trading a
 * pawn is not a sacrifice move, and a king is not a piece you hand over.
 *
 * "Wins them material" is the part that is easy to get wrong. A threshold on the
 * piece's own value is not enough — with the standard scale a knight (320) and a
 * bishop (330) sit above any such line, so a defended knight under attack would
 * score as a sacrifice while being perfectly defended. Instead the DEFENDER's
 * material is weighed against the piece: the capture is a sacrifice when the
 * defender is worth LESS than what is being taken, because the trade then loses
 * material even though nothing is left completely undefended.
 *
 * The comparison is `<`, matching reviewClassify's `ourDef < moved`, and the two
 * must agree — a move the verdict calls a sacrifice has to be nameable as one.
 * An earlier draft used "defender worth under HALF the piece", which is a unit
 * too strict in the worst direction: a queen covered by a single rook scored as
 * safe, even though taking it costs only a rook. That silently refused to name
 * two of the three real brilliant moves in the stored reviews (Qxf2 defended by
 * a rook, Rxc6 defended by a bishop).
 *
 * Note this is deliberately conservative. Whether a move is a Sigma AT ALL is
 * reviewClassify's job, and it weighs the resulting position properly; this only
 * names which piece, so it under-claims rather than inventing sacrifices.
 *
 * @param {string} fenAfter position AFTER the move
 * @param {'w'|'b'} moverColor
 * @returns {string[]} piece letters, most valuable first
 */
export function collectExposedPieces(fenAfter, moverColor) {
  const out = [];
  let g;
  try {
    g = new Chess(fenAfter);
  } catch {
    return out;
  }
  const them = moverColor === 'w' ? 'b' : 'w';

  for (const row of g.board()) {
    for (const cell of row) {
      /* chess.js spells the piece letter "type" here, not "piece". */
      if (!cell || cell.color !== moverColor) continue;
      const value = VALUE[cell.type];
      if (value == null || value <= MIN_SACRIFICE_VALUE) continue;

      const attackers = g.attackers(cell.square, them);
      if (attackers.length === 0) continue;

      /* If the defender recaptures and comes out ahead, the piece was never
         really given away. NOTE attackers() yields SQUARES, so each defender's
         piece letter has to be looked up on the board before it can be valued. */
      const defenders = g.attackers(cell.square, moverColor);
      const defenceValue = defenders.reduce((sum, square) => {
        const d = g.get(square);
        return sum + (d && VALUE[d.type] ? VALUE[d.type] : 0);
      }, 0);
      if (defenceValue >= value) continue;

      out.push(cell.type);
    }
  }

  /* Most valuable first, so a caller taking [0] gets the right answer. */
  return out.sort((a, b) => VALUE[b] - VALUE[a]);
}

/**
 * Classify WHICH kind of Sigma move this was. Exactly one type per move.
 *
 * THE CANDIDATE SET IS "PIECES ACTUALLY GIVEN AWAY", NOT "PIECES THAT MOVED".
 * That distinction is the whole point. An earlier draft added the moved piece
 * unconditionally, which labelled a plain recapture (Nxe5 taking a pawn and simply
 * standing there) as a Knight Sacrifice. Only a piece the opponent can profitably
 * take afterwards counts — which is what `exposed` reports.
 *
 * Underpromotion is a category of its own rather than a "which piece" question: a
 * pawn promoting to a rook, bishop or knight. It qualifies when the promoted piece
 * is itself given away, or when the pawn takes something worth more than the piece
 * it promotes to — the classic trade-up that a queen promotion would miss.
 * Promoting to a QUEEN is the obvious move and is never an underpromotion.
 *
 * When several pieces are given away the highest-value one names the move, which
 * puts queen above all of them by construction.
 *
 * @param {object} args
 * @param {object} args.move    chess.js verbose Move that was played
 * @param {string[]} [args.exposed]  from collectExposedPieces(), post-move
 * @returns {string|null} a SIGMA_TYPE, or null when the move gives nothing away
 */
export function classifySigmaType({ move, exposed = [] } = {}) {
  if (!move) return null;

  /* Only pieces the opponent can profitably take are candidates. */
  const candidates = new Set();
  for (const p of exposed) if (VALUE[p] != null) candidates.add(p);

  if (move.promotion && move.promotion !== 'q') {
    const promoValue = VALUE[move.promotion] ?? 0;
    const tookMore = move.captured ? (VALUE[move.captured] ?? 0) > promoValue : false;
    return (candidates.has(move.promotion) || tookMore)
      ? SIGMA_TYPE.UNDERPROMOTION
      : null;
  }

  let best = null;
  for (const p of candidates) {
    if (best === null || VALUE[p] > VALUE[best]) best = p;
  }
  return best ? TYPE_BY_PIECE[best] : null;
}

/**
 * The name for a brilliant move whose piece could not be read off the geometry.
 *
 * `classifySigmaType` names the piece the opponent can PROFITABLY take — which
 * is the piece "given away". A PROTECTED sacrifice is the case where that is
 * not true: the piece stays defended (the classifier blessed the move on the
 * continuation, not on the geometry — see reviewClassify's protected-sacrifice
 * path), so nothing looks given away and the type comes back null.
 *
 * That null is not a reason to lose the move: the review already called it
 * brilliant, and the list is the BRILLIANT list. The move's own piece is the
 * piece that was offered, so it is the best name available — and an
 * underpromotion is an underpromotion by definition.
 *
 * @param {object} move  chess.js verbose move
 * @returns {string|null} a SIGMA_TYPE, or null when even this cannot name it
 */
export function fallbackSigmaType(move) {
  if (!move) return null;
  if (move.promotion && move.promotion !== 'q') return SIGMA_TYPE.UNDERPROMOTION;
  if (move.piece && TYPE_BY_PIECE[move.piece]) return TYPE_BY_PIECE[move.piece];
  return null;
}

/**
 * The full classification for one reviewed move, given the ply's context.
 *
 * Deliberately does NOT re-run the brilliant verdict: classifyMove() has already
 * decided the move is a Sigma, and re-deriving that here would give two places
 * that can drift apart. This only answers "which type".
 *
 * @param {object} args
 * @param {string} args.fenBefore
 * @param {string} args.moveSan
 * @param {boolean} args.isSigma  the verdict from classifyMove()
 * @returns {{type: string, fromSquare: string, toSquare: string}|null}
 */
export function classifySigmaFromPly({ fenBefore, moveSan, isSigma } = {}) {
  if (!isSigma || !fenBefore || !moveSan) return null;

  let g;
  try {
    g = new Chess(fenBefore);
  } catch {
    return null;
  }

  /* chess.js throws on an illegal or ambiguous SAN, and a review can be handed a
     truncated PGN, so a failure here means "cannot classify", never "crash". */
  let move;
  try {
    move = g.move(moveSan);
  } catch {
    return null;
  }
  if (!move) return null;

  const exposed = collectExposedPieces(g.fen(), g.turn() === 'w' ? 'b' : 'w');
  const type = classifySigmaType({ move, exposed })
    /* The geometry may name nothing (a protected sacrifice). The move is still
       brilliant, so it is named by the piece it offered. */
    || fallbackSigmaType(move);
  if (!type) return null;

  return { type, fromSquare: move.from, toSquare: move.to };
}

export { VALUE as PIECE_VALUE, MIN_SACRIFICE_VALUE };