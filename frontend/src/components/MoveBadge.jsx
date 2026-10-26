/* Move classification badge — the coin-style rank icon that sits CENTERED on
   the top-right corner point of the destination square (see ChessBoard + CSS).

   The outer <span class="move-badge-dot"> is the sized circle (diameter from
   --mb-size, set by the board = 60% of a square) and is centred on the corner
   point by CSS transform: translate(-50%, -50%). The coin face + gradient +
   minted edge are drawn by the shared RankIcon (components/RankBadges.jsx) so
   the board overlay, move list and legend all share one visual identity.

   Props:
     verdict — 'brilliant'|'great'|'best'|'excellent'|'good'|'book'|'inaccuracy'|'mistake'|'miss'|'blunder'
                ('sigma' is accepted too and drawn as the same badge — see below)

   `good` (Ok) deliberately shows NO badge on the board — a dot on every solid
   quiet move would be noise; it still appears in the legend and sheet.

   THE VERDICT IS NORMALISED HERE, ONCE. The classification layer writes the
   Sigma verdict as 'sigma' while this badge, RANK_GLYPHS, the CSS hook and the
   review rows written before the rename all key off 'brilliant'. Normalising at
   this single boundary means every board caller — GameReview, the profile
   viewer, the replay and the analysis board — is covered without each of them
   having to remember, and the stored verdict is never rewritten. */

import { REVIEW_META } from '../utils/gameReview';
import { getDisplayVerdict } from '../utils/sigmaType';
import { RankIcon } from './RankBadges';

export default function MoveBadge({ verdict }) {
  const shown = getDisplayVerdict(verdict);
  const meta = REVIEW_META[shown];
  if (!meta || shown === 'good') return null;
  /* The badge is shown for EVERY verdict, brilliant included: the "!!" coin is
     the app's own classification badge, it sits on the top-right corner of the
     destination square, and it follows the move being shown (so it is gone on
     the next move and back on undo/redo).

     The effect OVERLAY stays quiet for the three special events (brilliant,
     checkmate, promotion) — see utils/moveFeedback.js — so the overlay's own
     seal never lands on the same corner as this badge. */
  return (
    <span
      className={`move-badge-dot${shown === 'brilliant' ? ' move-badge-dot--brilliant' : ''}`}
      role="img"
      aria-label={meta.label}
      title={meta.label}
    >
      <RankIcon verdict={shown} size="100%" ariaHidden />
    </span>
  );
}