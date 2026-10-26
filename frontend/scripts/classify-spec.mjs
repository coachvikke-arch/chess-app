/* Classification spec conformance — every documented rule in reviewConfig.js,
   exercised directly against classifyMove. Run: node scripts/classify-spec.mjs

   Severity bands are WIN%-DROP based (chess.com): winPctDrop = winPercent(best)
   − winPercent(played), floored at 0 → Excellent ≤2 / Good ≤5 / Inaccuracy ≤10 /
   Mistake ≤20 / Blunder >20 (percentage points of win% lost). Brilliant and
   Great require the played move to be the engine's best OR NEAR-BEST (cpl ≤
   BRILLIANT_NEAR_BEST_CPL, 10cp) — chess.com's own "best or near-best" phrasing,
   so a rank-2 sacrifice separated from the top line by engine noise (2cp,
   e.g. 19.Bxd5) still gets "!!". */

import { classifyMove, moveMetrics, heuristicIsSacrifice, sacrificeCandidate, isQuietPosition, settledNetSacrifice, isErrorVerdict, winPercentDrop } from '../src/utils/reviewClassify.js';
import { Chess } from 'chess.js';
import { MATE_SCORE, MATE_SCORE_WINDOW, BOOK_MAX_MOVE_NUMBER } from '../src/utils/reviewConfig.js';

let pass = 0, fail = 0;
const ok = (name, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const c = (o) => classifyMove(o);
const bk = () => Math.min(BOOK_MAX_MOVE_NUMBER, 8); /* a book-eligible move number for tests */

/* no engine data → neutral (or book) */
ok('null evals → good', c({ bestM: null, playedM: null }), 'good');
ok('null evals book → book', c({ isBook: true, moveNumber: bk(), bestM: null, playedM: null }), 'book');

/* Best (the simplest reward) */
ok('best: played == top, cpl 0', c({ isBestMove: true, bestM: 20, playedM: 20, secondM: 0 }), 'best');

/* Only Move is GONE — the badge no longer exists. A forced move is never
   Brilliant by itself; Brilliant runs FIRST, so a forced move that is a
   GENUINE sacrifice is Brilliant (forced-sac gate was removed), while a
   forced NON-sacrifice best move lands on Best (Great requires not-forced,
   and there is no Only Move tier anymore). */
ok('forced non-sacrifice best → best (no Only Move tier)',
  c({ isBestMove: true, bestM: 20, playedM: 20, isForced: true, secondM: 0 }), 'best');
ok('forced single-legal SAC → brilliant (forced-sac still qualifies for Brilliant)',
  c({ isBestMove: true, sacrifice: true, bestM: 20, playedM: 20, isForced: true, secondM: 0 }), 'brilliant');

/* Brilliant — five-condition spec (chess.com):
   1) best move: played is the engine's best OR NEAR-best (within 10cp — a
      rank-2 sacrifice separated from the top line by engine noise like
      19.Bxd5's 2cp is still "best or near-best"); strict isBestMove is NOT
      required
   2) genuine material sacrifice — the offered piece is at least a MINOR
      (knight/bishop or greater; pure pawn sacrifices NEVER qualify → those
      fall through to Great Move or Best Move)
   3) justified — implied by (1): played ≈ best ⇒ eval_after ≈ eval_before
   4) the sacrifice survives the full forced exchange (net-trade guard)
   5) sane window: −600 < eval_before < 600 (dead-won/dead-lost never Brilliant)
   Forced sacrifices DO qualify — Brilliant runs FIRST and the forced-sac /
   safe-alternative gates were removed (a forced mate sac like Rxg6+ is the
   "!!", not the choice between alternatives).
   No shallow-probe disqualifier: poisoned-piece brilliancies (19.Bxd5) are the
   engine's best at every depth and STILL deserve "!!". */
ok('brilliant: sac best cpl0', c({ isBestMove: true, sacrifice: true, bestM: 0, playedM: 0, secondM: -200 }), 'brilliant');
ok('brilliant: rank-2 sac cpl10 (near-best) still "!!"',
  c({ isBestMove: false, sacrifice: true, bestM: 0, playedM: -10, secondM: -200 }), 'brilliant');
ok('brilliant: rank-2 sac within noise (cpl 2, 19.Bxd5-style) → brilliant',
  c({ isBestMove: false, sacrifice: true, bestM: 220, playedM: 218, secondM: -50 }), 'brilliant');
ok('brilliant: sac best near +600 bound (599)', c({ isBestMove: true, sacrifice: true, bestM: 599, playedM: 599, secondM: 300 }), 'brilliant');
ok('brilliant: sac best near -600 bound (−599)', c({ isBestMove: true, sacrifice: true, bestM: -599, playedM: -599, secondM: -800 }), 'brilliant');
ok('brilliant: sac best dead-won +700 → not brilliant (window caps), great runner-up gap', c({ isBestMove: true, sacrifice: true, bestM: 700, playedM: 700, secondM: 400 }), 'great');
ok('brilliant: sac best dead-won +700 small gap → best (window caps)', c({ isBestMove: true, sacrifice: true, bestM: 700, playedM: 700, secondM: 640 }), 'best');
ok('brilliant: sac best dead-lost -700 → best (window caps)', c({ isBestMove: true, sacrifice: true, bestM: -700, playedM: -700, secondM: -900 }), 'best');
ok('brilliant: sac best at -300 within window (Great keeps -300 gate, Brilliant uses -600)', c({ isBestMove: true, sacrifice: true, bestM: -300, playedM: -300, secondM: -500 }), 'brilliant');
/* Forced mating sac in an already-winning position stays Brilliant (RXG6+ rule):
   the major-piece upper-window exception — right side of the LEG-1 OR. A
   best/near-best ROOK/QUEEN sacrifice extends past BRILLIANT_EVAL_MAX (e.g.
   19.Rxg6+ with evalBefore ≈ +692 → mate) while a minor-piece sac above +600
   stays gated (no routine winning motifs). Rule pinned here per the
   Rubric-5 tension decision: forced mating sacs STAY Brilliant. */
ok('brilliant: rook sac dead-won +692 (Rxg6+ forced-mate) → brilliant (major-piece extends upper window)',
  c({ isBestMove: true, sacrifice: true, bestM: 692, playedM: 692, secondM: 400, sacMovedCp: 500 }), 'brilliant');
ok('brilliant: rook sac near-best cpl10 dead-won +692 → brilliant (major-piece exception, not strict-best)',
  c({ isBestMove: false, sacrifice: true, bestM: 692, playedM: 682, secondM: 400, sacMovedCp: 500 }), 'brilliant');
ok('brilliant: queen sac dead-won +900 → brilliant (major-piece exception)',
  c({ isBestMove: true, sacrifice: true, bestM: 900, playedM: 900, secondM: 400, sacMovedCp: 900 }), 'brilliant');
ok('brilliant: minor sac dead-won +692 → not brilliant (minor stays gated), great runner-up gap',
  c({ isBestMove: true, sacrifice: true, bestM: 692, playedM: 692, secondM: 400, sacMovedCp: 330 }), 'great');
ok('brilliant: rook sac dead-lost -700 → best (upper-bound-only exception; below MIN never Brilliant)',
  c({ isBestMove: true, sacrifice: true, bestM: -700, playedM: -700, secondM: -900, sacMovedCp: 500 }), 'best');
/* 12.Nxh7 case pinned: a MINOR-piece (knight, 320cp) sacrifice INSIDE the ±600
   window at ≈ +366 — already winning but NOT crushingly so — stays Brilliant
   (only minor sacs ABOVE +600 stay gated). Safe alternative c3 (+301) existed;
   the knight offer is a genuine attack sacrifice (Rubric decision: +3.66 keeps
   Brilliant, threshold is the +5.0 ceiling, not +3.0). */
ok('brilliant: knight sac +366 (12.Nxh7) inside window → brilliant (minor sac stays brilliant below +600)',
  c({ isBestMove: true, sacrifice: true, bestM: 366, playedM: 366, secondM: 301, sacMovedCp: 320 }), 'brilliant');
ok('brilliant: cpl 11 (just past near-best) → band', c({ isBestMove: false, sacrifice: true, bestM: 0, playedM: -11, secondM: -200 }), 'excellent');
ok('brilliant keeps despite no safe alternative (gate removed)', c({ isBestMove: true, sacrifice: true, bestM: 0, playedM: 0, secondM: -140, hasSafeAlternative: false }), 'brilliant');
ok('forced near-best sac → brilliant (forced-sac no longer blocks Brilliant)', c({ isBestMove: false, sacrifice: true, bestM: 0, playedM: -10, isForced: true, secondM: -700 }), 'brilliant');
ok('forced best sac → brilliant (was Only Move, now Brilliant)', c({ isBestMove: true, sacrifice: true, bestM: 0, playedM: 0, isForced: true, secondM: -700 }), 'brilliant');
ok('sac but not best → error band only', c({ isBestMove: false, sacrifice: true, bestM: 0, playedM: -90, secondM: -200 }), 'inaccuracy');

/* Pure pawn sacrifices NEVER qualify for Brilliant (spec: sacrifice must be a
   minor or greater) — they fall through to Great Move or Best Move. */
ok('pawn sac best with big runner-up gap → great (never brilliant)',
  c({ isBestMove: true, sacrifice: false, bestM: 0, playedM: 0, secondM: -200 }), 'great');
ok('pawn sac best with small gap → best (never brilliant)',
  c({ isBestMove: true, sacrifice: false, bestM: 0, playedM: 0, secondM: -120 }), 'best');
ok('pawn sac near-best rank-2 → excellent (no sacrifice, no great gap)',
  c({ isBestMove: false, sacrifice: false, bestM: 0, playedM: -10, secondM: -10 }), 'excellent');

/* Equal-exchange guard (Brilliant-2b): a sacrifice that the full forced
   exchange sequence refunds to equal/better is a TRADE, never Brilliant. */
ok('trade that nets even kills Brilliant → great (never brilliant)',
  c({ isBestMove: true, sacrifice: true, bestM: 0, playedM: 0, secondM: -200, hasNetSacrifice: false }), 'great');
ok('brilliant keeps net sacrifice by default (hasNetSacrifice true)',
  c({ isBestMove: true, sacrifice: true, bestM: 0, playedM: 0, secondM: -200 }), 'brilliant');

/* Great: played must BE the engine best + runner-up gap ≥ 150 (spec ">=";
   when the gap reaches FORCED_SECOND_LOSS_CP the move is FORCED — and a
   forced best move is never Great, it lands on Best). Phase is no longer a
   gate, and the optional sharpness gate is exercised further down. */
ok('great: gap 151 → great', c({ isBestMove: true, bestM: 0, playedM: 0, secondM: -151 }), 'great');
ok('great: gap exactly 150 → great (spec >= 150)', c({ isBestMove: true, bestM: 0, playedM: 0, secondM: -150 }), 'great');
ok('great: gap 151 in opening → great (phase removed)', c({ isBestMove: true, bestM: 0, playedM: 0, secondM: -151, phase: 'opening' }), 'great');
ok('great: gap 300 dead-won +700 → great (no upper cap)', c({ isBestMove: true, bestM: 700, playedM: 700, secondM: 400 }), 'great');
ok('great: near-best (cpl 10) with big gap → great (not best)',
  c({ isBestMove: false, bestM: 0, playedM: -10, secondM: -200 }), 'great');
ok('great small gap → best', c({ isBestMove: true, bestM: 0, playedM: 0, secondM: -140 }), 'best');

/* Forced strictness — no Only Move tier anymore. A forced SAC is Brilliant
   (Brilliant runs first); a forced near-best NON-sacrifice slips to the error
   bands; a forced engine-best non-sacrifice lands on Best (Great requires
   not-forced). */
ok('forced near-best cpl10 sac → brilliant (forced-sac qualifies)',
  c({ isBestMove: false, sacrifice: true, bestM: 0, playedM: -10, isForced: true, secondM: -700 }), 'brilliant');
ok('gap 300 + forced best non-sac → best (forced never Great, no Only Move tier)',
  c({ isBestMove: true, bestM: 700, playedM: 700, secondM: 400, isForced: true }), 'best');

/* Great sharpness gate (GREAT_NEEDS_SHARP_POSITION): a quiet position whose
   big gap just mirrors an opponent blunder gets no "!" — stays Best. */
ok('great suppressed in quiet position → best (sharp required)',
  c({ isBestMove: true, bestM: 0, playedM: 0, secondM: -200, isSharp: false }), 'best');
ok('great fires in sharp position (default isSharp = true)',
  c({ isBestMove: true, bestM: 0, playedM: 0, secondM: -200 }), 'great');

/* Book override (only within first BOOK_MAX_MOVE_NUMBER fullmoves). A book
   move escapes the label only when it is a real Mistake/Blunder — i.e. the
   win% lost exceeds the Inaccuracy band (10) — exactly the old cpl-100 bar
   moved onto the chess.com win%-drop scale. */
ok('book best → book', c({ isBook: true, moveNumber: bk(), isBestMove: true, bestM: 0, playedM: 0 }), 'book');
ok('book wpd 8.2 stays book (win% lost < 10)', c({ isBook: true, moveNumber: bk(), bestM: 0, playedM: -90, secondM: -5 }), 'book');
ok('book wpd 11.7 escaped (mistake band)', c({ isBook: true, moveNumber: bk(), bestM: 0, playedM: -130, secondM: -5 }), 'mistake');
ok('book wpd 21.5 escaped (blunder band)', c({ isBook: true, moveNumber: bk(), bestM: 0, playedM: -250, secondM: -5 }), 'blunder');
ok('book after move 15 → classified normally (excellent at 20cp swing)',
  c({ isBook: true, moveNumber: BOOK_MAX_MOVE_NUMBER + 1, bestM: 0, playedM: -20 }), 'excellent');
ok('book after move 15 → best when top', c({ isBook: true, moveNumber: BOOK_MAX_MOVE_NUMBER + 1, isBestMove: true, bestM: 0, playedM: 0 }), 'best');

/* Miss — forced win/mate was available, but the player let it slip */
ok('miss: matescore on board, cpl 300 → miss', c({ bestM: MATE_SCORE - 1, playedM: MATE_SCORE - 1 - 300 }), 'miss');
ok('miss: decisive win +1400, cpl 200 → miss', c({ bestM: 1400, playedM: 1200 }), 'miss');
ok('miss: win +1400 but only cpl 100 → not miss, trivial wpd → excellent (below MISS_MIN_LOSS_CP)', c({ bestM: 1400, playedM: 1300 }), 'excellent');
ok('miss NOT when win below MISS_WIN_CP (cpl 300) → inaccuracy by wpd 8.7', c({ bestM: 800, playedM: 500 }), 'inaccuracy');
ok('miss NOT when move is still engine best (cpl 0) → best', c({ isBestMove: true, bestM: MATE_SCORE - 1, playedM: MATE_SCORE - 1 }), 'best');

/* severity bands: pure win% loss (winPctDrop), first match wins.
   wpd under test: wp(best) − wp(played) with WIN_SIGMOID_K = 0.00368. */
ok('wpd 0.69 (10cp at 300) → excellent', c({ bestM: 301, playedM: 291 }), 'excellent');
ok('wpd 4.6 (50→0) → good', c({ bestM: 50, playedM: 0 }), 'good');
ok('wpd 7.3 (80→0) → inaccuracy', c({ bestM: 80, playedM: 0 }), 'inaccuracy');
ok('wpd 13.5 (150→0) → mistake', c({ bestM: 150, playedM: 0 }), 'mistake');
ok('wpd 50.2 (300→−300) → blunder', c({ bestM: 300, playedM: -300 }), 'blunder');

/* Blunder: handing the opponent a forced mate (playedM becomes a losing mate score) */
ok('blunder: played move lets opponent mate', c({ bestM: 0, playedM: -(MATE_SCORE - MATE_SCORE_WINDOW + 50) }), 'blunder');

/* equal-position wobble: no override anymore — pure winPctDrop bands apply */
ok('equal wobble wpd 5.5 (20→−40) → inaccuracy (no wobble cap)', c({ bestM: 20, playedM: -40 }), 'inaccuracy');
ok('equal wobble wpd 0.5 (10→5) → excellent', c({ bestM: 10, playedM: 5 }), 'excellent');

/* winPercentDrop sanity — the chess.com severity + accuracy metric */
ok('winPercentDrop exact zero when played == best', winPercentDrop(0, 0), 0);
ok('winPercentDrop clamped ≥ 0', winPercentDrop(-10, 10), 0);
ok('winPercentDrop positive when lagging', Math.abs(winPercentDrop(300, -300) - 50.2) < 0.3, true);

/* metrics maths */
const m1 = moveMetrics(50, 0);
ok('moveMetrics cpl 50 (best ahead)', m1.cpl, 50);
const m2 = moveMetrics(0, 50);
ok('moveMetrics played better than best → 0', m2.cpl, 0);
ok('moveMetrics non-negative', moveMetrics(-10, -80).cpl, 70);

/* error verdicts include the new Miss tier (trust floor must collapse it) */
ok('miss is an error verdict', isErrorVerdict('miss'), true);
ok('best is not an error verdict', isErrorVerdict('best'), false);

/* Sacrifice heuristic */
/* Recapture (opponent captured onto the same square last move) → NOT a sac:
   e.g. 17.Nxe3 retaking the e3 pawn black just grabbed via 16...fxe3. */
ok('recapture → not a sacrifice',
  heuristicIsSacrifice(
    'rnbqkbnr/pppp1ppp/8/8/3Pp3/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 4',
    { piece: 'n', captured: 'p', to: 'd4', from: 'f3', color: 'w', flags: 'c' },
    { to: 'd4', flags: 'c' },
  ),
  false);

/* Bxd5-style bishop-takes-pawn: dealt = 330−100 = 230 (spends net material,
   moved = 330 ≥ minor), the bishop stays capturable by the enemy queen on the
   landing square, and our defender (knight e3) is weaker than the bishop →
   a GENUINE minor-piece-for-pawn sacrifice → Brilliant. */
ok('Bxd5-style bishop-for-pawn (dealt 230) → sacrifice',
  heuristicIsSacrifice(
    'k7/ppp5/8/3p4/4q3/1B2N3/PP3P2/4K3 w - - 0 1',
    { piece: 'b', captured: 'p', to: 'd5', from: 'b3', color: 'w', flags: 'c' },
    { to: 'e4', flags: '' },
  ),
  true);

/* Two-Knights-style knight-for-pawn: Nxf7 (dealt = 320−100 = 220, moved =
   320 ≥ minor), the knight stays capturable (king e8 can take f7), nothing
   recaptures it → classical knight sac → Brilliant. */
ok('Nxf7-style knight-for-pawn (dealt 220) → sacrifice',
  heuristicIsSacrifice(
    'r1bqkb1r/ppp2ppp/2n5/3np1N1/2B5/8/PPPP1PPP/RNBQK2R w KQkq - 0 6',
    { piece: 'n', captured: 'p', to: 'f7', from: 'g5', color: 'w', flags: 'c' },
    null,
  ),
  true);

/* clear win, NOT a sac: bishop grabs a rook (dealt = 330−500 < 0) */
ok('free bigger piece (Bxd8-style, dealt < 0) → NOT a sacrifice',
  heuristicIsSacrifice(
    'r3k3/8/8/8/8/8/8/1B2K3 w - - 0 1',
    { piece: 'b', captured: 'r', to: 'a8', from: 'b1', color: 'w', flags: 'c' },
    null,
  ),
  false);

/* Queen-for-rook capture (dealt = 900−500 = 400 ≥ VAL.n) where the queen stays
   capturable (knight b6 attacks a8) and we have no equal defender → genuine
   exchange sacrifice. */
ok('queen-for-rook with capturable queen → sacrifice',
  heuristicIsSacrifice(
    'r6k/8/1n6/8/8/8/8/Q3K3 w - - 0 1',
    { piece: 'q', captured: 'r', to: 'a8', from: 'a1', color: 'w', flags: 'c' },
    null,
  ),
  true);

/* Bxf6-style trivial exchange: bishop (330) takes knight (320), dealt = 10 <
   VAL.p (100). The capture spends almost nothing net — a trivial even trade,
   not a sacrifice. The dealt ≥ VAL.p guard filters this out. */
ok('Bxf6 trivial exchange (dealt 10 < VAL.p) → NOT a sacrifice',
  heuristicIsSacrifice(
    'r1bqk2r/ppp1bppp/2n2n2/3pp3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 2 5',
    { piece: 'b', captured: 'n', to: 'f6', from: 'c4', color: 'w', flags: 'c' },
    { to: 'd5', flags: 'c' },
  ),
  false);

/* Same trivial exchange through sacrificeCandidate (the Brilliant pre-filter)
   — Bxf6 with dealt=10 must NOT register as a sacrifice candidate. */
ok('Bxf6 trivial exchange → NOT a sacrificeCandidate',
  sacrificeCandidate(
    'r1bqk2r/ppp1bppp/2n2n2/3pp3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 2 5',
    { piece: 'b', captured: 'n', to: 'f6', from: 'c4', color: 'w', flags: 'c' },
    { to: 'd5', flags: 'c' },
  ),
  false);

/* Bxc6-style after-position defense: bishop (330) captures pawn on g7 (dealt =
   230 ≥ VAL.p). Before the move, ourDef = 0 (queen a1's diagonal to g7 is
   blocked by the bishop on d4). After Bxg7, the bishop vacates d4 and the
   queen defends g7 through the opened diagonal (ourDef_after = 900 ≥ moved).
   A recapture on g7 would lose material → not a genuine sacrifice. */
ok('bishop-for-pawn with queen defense through vacated square → NOT a sacrifice',
  heuristicIsSacrifice(
    '6k1/6p1/8/8/3B4/8/8/Q5K1 w - - 0 1',
    { piece: 'b', captured: 'p', to: 'g7', from: 'd4', color: 'w', flags: 'c' },
    null,
  ),
  false);

ok('same after-position defense → NOT a sacrificeCandidate',
  sacrificeCandidate(
    '6k1/6p1/8/8/3B4/8/8/Q5K1 w - - 0 1',
    { piece: 'b', captured: 'p', to: 'g7', from: 'd4', color: 'w', flags: 'c' },
    null,
  ),
  false);

/* Chess.com king-zone exception: a ROOK capturing a pawn near the enemy king
   (within 2 squares) remains a sacrifice candidate even when the rook is
   defended after the move through the vacated square. The two rooks on the
   f-file model 20.Rxf6: Rf2 captures f6, Rf1 defends through vacated f2,
   but the enemy CAN capture with Nxf6 (knight d7) and the follow-up wins. */
ok('rook-for-pawn near enemy king (chess.com king-zone) → sacrificeCandidate (chess.com quirk)',
  sacrificeCandidate(
    '8/3n1k2/5p2/8/8/8/5R2/5R1K w - - 0 1',
    { piece: 'r', captured: 'p', to: 'f6', from: 'f2', color: 'w', flags: 'c' },
    null,
  ),
  true);

ok('same rook-for-pawn king-zone → heuristicIsSacrifice (chess.com quirk)',
  heuristicIsSacrifice(
    '8/3n1k2/5p2/8/8/8/5R2/5R1K w - - 0 1',
    { piece: 'r', captured: 'p', to: 'f6', from: 'f2', color: 'w', flags: 'c' },
    null,
  ),
  true);

/* Minor-piece offered loose under a real attack, weaker defender → sacrifice.
   Knight f2→d3 lands under the black pawn e4 (theirAtk = p), defended only by
   nothing (ourDef 0 < VAL.n) → genuine "take my piece" offer. */
ok('knight offered loose under pawn attack → sacrifice',
  heuristicIsSacrifice(
    '4k3/8/8/8/4p3/8/5N2/4K3 w - - 0 1',
    { piece: 'n', to: 'd3', from: 'f2', color: 'w', flags: 'n' },
    null,
  ),
  true);

/* sacrificeCandidate — the Brilliant pre-filter: same geometry as
   heuristicIsSacrifice — the offered piece must be at least a MINOR (spec:
   sacrifice_amount ≥ 3, pawn=1/minor=3/rook=5/queen=9). Pure pawn sacrifices
   NEVER qualify for Brilliant; they fall through to Great/Best. The
   Bxd5/Nxf7 positions are sacrifices under BOTH. */
ok('Bxd5 geometry → sacrificeCandidate', sacrificeCandidate(
  'k7/ppp5/8/3p4/4q3/1B2N3/PP3P2/4K3 w - - 0 1',
  { piece: 'b', captured: 'p', to: 'd5', from: 'b3', color: 'w', flags: 'c' },
  { to: 'e4', flags: '' },
), true);
ok('pawn loose offer is NOT a sacrificeCandidate (pawns never Brilliant)',
  sacrificeCandidate(
    '4k3/8/8/8/5p2/8/4P3/4K3 w - - 0 1',
    { piece: 'p', to: 'e3', from: 'e2', color: 'w', flags: 'n' },
    null,
  ),
  false);
ok('knight offered loose under pawn attack → sacrificeCandidate (minor+)',
  sacrificeCandidate(
    '4k3/8/8/8/4p3/8/5N2/4K3 w - - 0 1',
    { piece: 'n', to: 'd3', from: 'f2', color: 'w', flags: 'n' },
    null,
  ),
  true);
ok('pawn loose offer is NOT a sacrifice for heuristicIsSacrifice (minor-only)',
  heuristicIsSacrifice(
    '4k3/8/8/8/5p2/8/4P3/4K3 w - - 0 1',
    { piece: 'p', to: 'e3', from: 'e2', color: 'w', flags: 'n' },
    null,
  ),
  false);

/* classifyMove: recapturing best move must NOT be brilliant.
   Sacrifice flag is dropped on recaptures, so the best recapture is Best. */
ok('recapture best → best (never brilliant)', c({ isBestMove: true, sacrifice: false, bestM: 33, playedM: 33, secondM: 0 }), 'best');

/* isQuietPosition — Great's sharpness gate (no capture, no check ⇒ quiet) */
ok('kings + one pawn, no capture/check → quiet', isQuietPosition('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), true);
ok('kings + rook that can give Ra8+ → sharp', isQuietPosition('4k3/8/8/8/8/8/R7/4K3 w - - 0 1'), false);
ok('kings + pawn capture available (exd5) → sharp', isQuietPosition('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'), false);

/* settledNetSacrifice — Brilliant-2b net-trade guard. Replays the played move
   from fenBefore, then walks the forced captures/checks continuation (≤ maxPlies)
   and reports:
     netDown      = (value of OUR pieces the enemy captured) − (value of THEIR
                    pieces we captured) across the whole sequence. Positive =
                    still genuinely down (a real sacrifice); ≤ 0 = the line
                    refunded us to equal/better (a trade).
     offeredTaken = whether the opponent ever captured the very piece we moved.
                    If never taken, the invitation is still standing (a poisoned/
                    declined offer like 19.Bxd5 → Brilliant stays).
     pressed      = the mover had a follow-up capture/check in the forced line.
                    The walk only keeps captures/checks, so any mover ply past
                    the opponent's reply IS the attack continuing (e.g. Ng5+
                    after Kxh7). A quiet recapture trade stops at 1 ply and
                    pressed=false — that is what the callers strip. */
ok('rook-for-rook swap (no follow-up) → gained 500, offer untouched (pure trade)',
  JSON.stringify(settledNetSacrifice(
    'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'w', 'a1a8', [], 6,
  )), JSON.stringify({ netDown: -500, offeredTaken: false, pressed: false }));
ok('knight-for-pawn with forced Kxf7 (no follow-up) → netDown 220, offer taken, no press',
  JSON.stringify(settledNetSacrifice(
    '4k3/5p2/8/4N3/8/8/8/4K3 w - - 0 1', 'w', 'e5f7', ['e8f7'], 6,
  )), JSON.stringify({ netDown: 220, offeredTaken: true, pressed: false }));
ok('quiet follow-up stops the walk (captures/checks only)',
  JSON.stringify(settledNetSacrifice(
    '4k3/5p2/8/4N3/8/8/8/4K3 w - - 0 1', 'w', 'e5f7', ['e8f7', 'e1e2'], 6,
  )), JSON.stringify({ netDown: 220, offeredTaken: true, pressed: false }));
ok('bishop-for-pawn, forced Rxh6 (no follow-up) → netDown 230, offer taken, no press',
  JSON.stringify(settledNetSacrifice(
    '7k/7r/7p/8/8/8/8/2B1K3 w - - 0 1', 'w', 'c1h6', ['h7h6'], 6,
  )), JSON.stringify({ netDown: 230, offeredTaken: true, pressed: false }));
ok('declined poisoned bishop swap (Bxd5, enemy never takes) → offer untouched (keeps Brilliant)',
  JSON.stringify(settledNetSacrifice(
    'r3k3/8/8/3p4/2B5/8/8/4K3 w - - 0 1', 'w', 'c4d5', [], 6,
  )), JSON.stringify({ netDown: -100, offeredTaken: false, pressed: false }));

/* Bxc6-style: bishop (330) takes pawn (100), opponent recaptures on the same
   square (Nxc6) → offeredTaken = true, pressed = false (quiet recapture, the
   walk stops at the 1-ply reply) → the callers' trade guard strips Brilliant. */
ok('Bxc6 with forced recapture on same square → netDown 230, offer taken, no press (simple trade, not sac)',
  JSON.stringify(settledNetSacrifice(
    'r3k3/pp6/2p5/1B6/8/8/8/4K3 w - - 0 1', 'w', 'b5c6', ['b7c6'], 6,
  )), JSON.stringify({ netDown: 230, offeredTaken: true, pressed: false }));

/* Qxg8+ style: queen takes rook; Kxg8 forced recapture on same square → offer
   taken, no mover press. gameReview.js's forced-recapture filter (single legal
   reply captures on same square) ALSO catches this, rejecting it as a trade. */
ok('Qxg8+ with forced Kxg8 → netDown 400, offer taken, no press (forced recapture, not sac)',
  JSON.stringify(settledNetSacrifice(
    '5kr1/8/8/8/8/8/8/4K1Q1 w - - 0 1', 'w', 'g1g8', ['f8g8'], 6,
  )), JSON.stringify({ netDown: 400, offeredTaken: true, pressed: false }));

/* Greek-gift (Bxh7+ Kxh7 Ng5+): the offer IS taken but the mover keeps
   PRESSING — the walk accepts ply 2 (Ng5+, a check) so pressed=true → the
   callers' guard KEEPS the Brilliant (positional attack compensation), matching
   chess.com and the pinned Nxh7 verdict. */
ok('Bxh7+ Kxh7 Ng5+ (attack continues) → offer taken, pressed=true (keeps Brilliant)',
  JSON.stringify(settledNetSacrifice(
    'rnbq1rk1/pppppppp/8/4P3/8/3B1N2/PPP1QPPP/5RK1 w - - 0 1', 'w', 'd3h7', ['g8h7', 'f3g5', 'h7g8'], 6,
  )), JSON.stringify({ netDown: 230, offeredTaken: true, pressed: true }));

/* classifyMove-level pin of the caller contract (formula-independent): a
   sacrifice whose settled line the caller keeps (hasNetSacrifice true) is
   Brilliant; one the caller's trade guard strips (hasNetSacrifice false)
   degrades to great. */
ok('brilliant: sacrifice kept by trade guard (hasNetSacrifice true) survives Brilliant',
  c({ isBestMove: true, sacrifice: true, hasNetSacrifice: true, bestM: 112, playedM: 112, secondM: -255, sacMovedCp: 330 }), 'brilliant');
ok('sacrifice stripped by trade guard (hasNetSacrifice false) degrades to great',
  c({ isBestMove: true, sacrifice: true, hasNetSacrifice: false, bestM: 112, playedM: 112, secondM: -255, sacMovedCp: 330 }), 'great');

/* Side-line parity: classifySideMove used to omit sacMovedCp, so the
   out-of-window rook sac (20.Rxf6 style) could never be Brilliant there. The
   main pipeline passes sacMovedCp=500; without it the same move degrades. */
ok('out-of-window rook sac WITHOUT sacMovedCp (the side-line bug) → cannot be brilliant',
  c({ isBestMove: true, sacrifice: true, bestM: 624, playedM: 624, secondM: 400, moveNumber: 20 }), 'great');

console.log(`\n${pass}/${pass + fail} spec checks passed${fail ? ` — ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);