/* ──────────────────────────────────────────────────────────────────────────
 * Which move events are announced by their ANIMATION ALONE.
 *
 * Three events play on the board: a BRILLIANT move, a CHECKMATE and a
 * PROMOTION. Their animations stay — the ripple, the glow, the flying piece,
 * the king wobble, the promotion morph.
 *
 * The effect OVERLAY itself is quiet for these three: no seal badge, no label
 * pill, no sacrifice badge, no "Checkmate" bubble, no "PROMOTED" badge, and no
 * mate bubble in the puzzles. The rule lives in ONE module so every surface
 * asks the same question.
 *
 * THE BRILLIANT BADGE IS NOT AFFECTED. The "!!" coin is the BOARD's own
 * classification badge (components/MoveBadge.jsx) and it is shown for every
 * verdict, brilliant included: it sits on the top-right corner of the
 * destination square and follows the move being shown. Keeping the overlay's
 * seal quiet for the same three events is what stops two "!!" marks landing on
 * the same corner.
 *
 * Nothing here changes the CLASSIFICATION itself: a move is still recorded as
 * brilliant, still counted, still shown in the analysis.
 */

/** The move events whose effect overlay shows no badge and no text bubble. */
export const ANIMATION_ONLY_EVENTS = Object.freeze(['brilliant', 'checkmate', 'promotion']);

/**
 * Is this move event one of the animation-only ones?
 *
 * @param {string} type  an effect type ('brilliant'|'checkmate'|'promotion')
 *   or a review verdict ('brilliant'|'sigma'|'best'|'great'|…)
 * @returns {boolean}
 */
export function isQuietMoveEvent(type) {
  const t = String(type || '').toLowerCase();
  if (!t) return false;
  if (t === 'sigma') return true;
  return ANIMATION_ONLY_EVENTS.includes(t);
}
