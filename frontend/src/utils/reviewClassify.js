import { normalizeScore, comparableScore, centipawnLoss } from './engineScore.js';
import { Chess } from 'chess.js';
import {
  MATE_SCORE,
  WIN_SIGMOID_K,
  WPD_EXCELLENT_MAX,
  WPD_GOOD_MAX,
  WPD_INACCURACY_MAX,
  WPD_MISTAKE_MAX,
  ACC_MAX,
  ACC_DECAY,
  ACC_FLOOR,
  GREAT_MIN_GAP_CP,
  LOST_POSITION_CP,
  GREAT_NEEDS_SHARP_POSITION,
  BRILLIANT_NEAR_BEST_CPL,
  BRILLIANT_SAC_CPL_MAX,
  BRILLIANT_PLAYED_WIN_CP,
  BRILLIANT_EVAL_MIN,
  BRILLIANT_EVAL_MAX,
  BOOK_MAX_MOVE_NUMBER,
  MISS_WIN_CP,
  MISS_MIN_LOSS_CP,
  MATE_SCORE_WINDOW,
  ACCURACY_CPL_CAP,
} from './reviewConfig.js';

/* ---------------------------------------------------------------
 * win% conversion — the win-percentage formula used by the review:
 *
 *     winPercent(cp) = 100 / (1 + e^(−WIN_SIGMOID_K · cp))
 *
 * which is exactly the spec's
 *     winPercent = 50 + 50 · (2/(1 + e^(−0.00368·cp)) − 1)
 * (sigmoid ↔ tanh identity), returning expected points as a percentage.
 * cp is measured from the SIDE TO MOVE's perspective.
 * --------------------------------------------------------------- */
export function winPct(cp) {
  const score = normalizeScore(cp);
  if (!score) return 0.5;
  if (score.type === 'mate') return score.winner > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-WIN_SIGMOID_K * score.value));
}

/* win% as a 0–100 number (the "win_percent_swing" unit) */
export function winPercent(cp) {
  return winPct(cp) * 100;
}

/* expected points lost by playing `playedM` instead of `bestM` (0..1) —
   still exported for the legacy/instant-analysis pipeline (gameAnalysis.js) */
export function winPctLoss(bestM, playedM) {
  return Math.max(0, winPct(bestM) - winPct(playedM));
}

/* absolute win% swing caused by a move, rounded to one decimal */
export function winPercentSwing(bestM, playedM) {
  return Math.round(Math.abs(winPercent(bestM) - winPercent(playedM)) * 10) / 10;
}

/* the chess.com severity + accuracy metric: win PERCENTAGE dropped by playing
   `playedM` instead of `bestM` (winPercent returns 0–100), floored at 0. This
   single number drives the error bands and the per-move accuracy score. */
export function winPercentDrop(bestM, playedM) {
  if (bestM == null || playedM == null) return null;
  return Math.max(0, winPercent(bestM) - winPercent(playedM));
}

/* per-move classification metrics, rounded per the review spec:
   cpl    = round(best − played), clamped ≥ 0
   swing  = round(|winPercent(best) − winPercent(played)|) to int  */
export function moveMetrics(bestM, playedM) {
  const cpl = centipawnLoss(bestM, playedM);
  const swing = Math.round(Math.abs(winPercent(bestM) - winPercent(playedM)));
  return { cpl, swing };
}

/* ---------------------------------------------------------------
 * Brilliant-ATTRIBUTION (spec §5 / §13 / §14).
 *
 * `sacrificeCandidate` looks at the position AFTER the move, so it cannot tell a
 * deliberate sacrifice from a piece that was ALREADY loose and merely walked into
 * the same fate. Nothing in the after-position geometry distinguishes them:
 *
 *      before   white knight on d4 is already hanging (attacked, undefended)
 *      play     white plays an unrelated strong move
 *      after    the knight is on an attacked square, under-defended  ⇒ geometry
 *               reports a sacrifice, and the Knight Sacrifice card is filed
 *
 * The move did not create that concession — it merely failed to save it. Passing
 * such a move off as a deliberate sacrifice is the single easiest false positive
 * to produce, so Brilliant asks this question separately: was the piece already
 * free material BEFORE the move?
 *
 * Conservative by construction. It returns false (reject) ONLY in the clear-cut
 * case — attacked, not king-covered, not properly defended, and the enemy can
 * collect it for a net gain — which is precisely "already hanging". A piece that
 * was merely contested (defended), attacked by something cheap and therefore not
 * worth taking, or completely untouched, returns true and the verdict is decided
 * by the remaining gates.
 *
 * A pawn-level offer returns true: pawn giveaways are never Brilliant anyway
 * (the sacrifice detectors require a minor piece or better), so there is nothing
 * for this gate to protect, and refusing to judge keeps it out of the pawn path.
 *
 * @param {string} fenBefore position BEFORE the move (mover to move)
 * @param {object} mv        chess.js verbose move
 * @returns {boolean} true when the move can be credited with creating the offer
 * --------------------------------------------------------------- */
export function sacrificeAttribution(fenBefore, mv) {
  if (!fenBefore || !mv || !mv.piece) return true;
  const moved = VAL[mv.piece] || 0;
  if (moved < VAL.n) return true;

  let g;
  try {
    g = new Chess(fenBefore);
  } catch {
    return true; // unreadable position: defer to the remaining gates, never accuse
  }
  /* The caller must hand us the position the move was played FROM. If it does not
     match, every geometry answer below would be about a different game, so the
     gate stands down rather than answering nonsense. */
  if (g.turn() !== mv.color) return true;

  const enemy = mv.color === 'w' ? 'b' : 'w';

  if (attackValueBy(g, mv.from, enemy) <= 0) return true;      // untouched: this move made the offer
  if (kingAdjacent(g, mv.from, mv.color)) return true;         // our king covered it
  if (attackValueBy(g, mv.from, mv.color) >= moved) return true; // properly defended too

  /* Attacked, uncovered and undefended. If the cheapest piece able to take it is
     worth MORE than the piece, taking is a bad trade for the enemy and the piece
     was not really loose — so it was merely contested, not already hanging. */
  const cheapest = attackValueBy(g, mv.from, enemy, null, 'min');
  return !(moved > cheapest);
}

/* ---------------------------------------------------------------
 * Brilliant ATTACKING gate (spec §27G).
 *
 * A sacrifice only counts if it ACHIEVES something. Handing over a rook or queen
 * while taking a pawn, with no attack and nothing won, is not a brilliancy — it is
 * a routine capture that happens to hang the capturing piece, or a plain blunder.
 *
 *      46.Rxc6   takes a pawn on c6, hangs the rook to Bd5, attacks nothing
 *      28.Qxf2   takes a pawn on f2, hangs the queen to Qe3, attacks nothing
 *
 * Both were cpl 0 and engine-best, so gates A-C and G all waved them through: the
 * engine genuinely preferred them. But "the engine likes it" is not "it is
 * brilliant" — a move can be the best available and still be uninteresting. Neither
 * move gave check, neither came near the enemy king, and each took a PAWN while
 * hanging something far better. They were winning-ish captures, not sacrifices.
 *
 * So the move must do one of three things:
 *
 *   1. give check,
 *   2. bring the enemy king under a real attack (two or more attackers), or
 *   3. capture real material — a minor piece or better, not merely a pawn.
 *
 * Leg 3 measures the piece TAKEN, not the trade: a rook sacrifice that wins a knight
 * is a genuine grab even though it is down 180 on paper, which is what a sacrifice is
 * for. What disqualifies a move is scooping up a pawn and nothing else, as both
 * reported cases did.
 *
 * Gate G and this one are complementary, and each catches reported rows the other
 * misses. Bxb7 is a real giveaway but takes a pawn, checks nothing (the black king
 * on b8 is not attacked by a bishop on b7), and so fails this gate. Qxg6 wins a
 * bishop and therefore CLEARS this gate — it is stopped only by gate G, for the
 * better pawn capture. Qxf2 and Rxc6 take pawns like Bxb7 and fail here.
 *
 * Pure geometry — no extra engine call, deterministic, and it moves no threshold.
 *
 * @param {string} fenBefore position BEFORE the move (mover to move)
 * @param {object} mv        chess.js verbose move
 * @returns {boolean} true when the move gives check, attacks, or wins material
 * --------------------------------------------------------------- */
export function attackingSacrifice(fenBefore, mv) {
  if (!fenBefore || !mv || !mv.piece) return true;
  const offered = VAL[mv.promotion ?? mv.piece] || 0;
  /* Pawns are never Brilliant anyway; leave them to the other gates. */
  if (offered < VAL.n) return true;

  let g;
  try {
    g = new Chess(fenBefore);
  } catch {
    return true; // unreadable position: defer rather than accuse
  }
  if (g.turn() !== mv.color) return true;
  try {
    g.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  } catch {
    return true; // the caller's move does not belong to this position
  }

  /* 1. It gives check. After the move the opponent is to move, so a true here is
     exactly "the move checks". */
  if (g.isCheck()) return true;

  /* 2. The enemy king comes under a combined attack — a discovered or doubled
     strike, which is what most non-checking sacrifices are actually for. */
  const enemy = g.turn();
  const kingSq = (g.board() || []).find((p) => p && p.type === 'k' && p.color === enemy);
  if (kingSq && g.attackers(kingSq.square, enemy).length >= 2) return true;

  /* 3. It wins real material — a minor piece or better. The measure is the piece
     TAKEN, not the net trade: a rook given up for a knight is exactly what a
     sacrifice is for. Scooping up a pawn and nothing else is what disqualifies a
     move here, since 46.Rxc6 and 28.Qxf2 both did precisely that. */
  return (VAL[mv.captured] || 0) >= VAL.n;
}

/* ---------------------------------------------------------------
 * Brilliant free-positive filter (spec §22 / §27E, and the gap that let
 * 22.Qxg6 through).
 *
 * `cpl <= 10` is the engine's NOISE floor, not proof of a good move: two lines
 * 9cp apart are indistinguishable to a fixed-depth search. When a line that is
 * genuinely BETTER existed and was not a sacrifice, the mover did not find a
 * brilliant sacrifice — they declined a free piece and paid for the privilege.
 *
 *      22...Qxg6   engine best  22...f7g6   −193   (a plain pawn capture)
 *                  played       22...Qxg6   −184   (a queen giveaway)  cpl 9
 *
 * Both fit "best or near-best", so the sac collected a "!!". It should not have:
 * the move was 9cp WORSE than taking the bishop with a pawn.
 *
 * The gate is deliberately narrow — it needs a strictly better line that WINS
 * MATERIAL and is NOT itself a sacrifice. When the better lines are also
 * sacrifices (a poisoned piece where recapturing costs more), the mover chose the
 * best of several sacrifices and that is exactly the classic brilliancy this badge
 * is for. When the better line merely captures nothing, the engine preferred a
 * quieter route within its own noise floor and the gate stands down — otherwise it
 * would contradict gate A, which already treats cpl <= 10 as good enough.
 *
 * Pure geometry on the recorded MultiPV lines — no extra engine call, and no
 * threshold moves: it reuses sacrificeCandidate as the single definition of
 * "this line gave something up".
 *
 * @param {string} fenBefore position the candidate moves are played from
 * @param {object} prevMv    previous move (recapture detection)
 * @param {Array<{uci:string,score:number}>} tops MultiPV lines, WHITE perspective
 * @param {'w'|'b'} mover
 * @param {number} playedM   eval of the played move, MOVER perspective
 * @returns {boolean} true when a strictly better non-sacrificing move existed
 * --------------------------------------------------------------- */
export function betterNonSacrificialLine(fenBefore, prevMv, tops, mover, playedM) {
  if (!fenBefore || !Array.isArray(tops) || playedM == null) return false;
  let g;
  try {
    g = new Chess(fenBefore);
  } catch {
    return false;
  }
  for (const t of tops) {
    if (!t || typeof t.uci !== 'string' || t.uci.length < 4 || t.score == null) continue;
    /* Strictly better only. An equal-eval line is the engine calling both moves
       the same, and the played line itself reappears in `tops` as rank 1. */
    const lineM = mover === 'w' ? t.score : -t.score;
    if (!(lineM > playedM)) continue;
    let mv = null;
    try {
      mv = g.move({
        from: t.uci.slice(0, 2),
        to: t.uci.slice(2, 4),
        promotion: t.uci.length > 4 ? t.uci[4] : undefined,
      });
    } catch { continue; }
    if (!mv) continue;
    /* WHAT is strictly better matters, not merely THAT it is. A better line that
       takes nothing is not a declined sacrifice — it is the engine preferring a
       quieter route, and inside the noise floor those two are the same move. A
       better line that CAPTURES material is different in kind: it is a free piece
       the mover walked past.
         22...f7g6   takes a BISHOP with a pawn  -> a declined free piece
         9...Ng5-e6  a quiet knight move, takes nothing -> just engine preference
       Rejecting the second kind would contradict gate A, which already declares
       cpl <= BRILLIANT_NEAR_BEST_CPL to be good enough; a 9cp "improvement" is
       noise, not evidence, and 9.Qxf6 measured exactly that against 9.Ne6. */
    const winsMaterial = Boolean(mv.captured) && (VAL[mv.captured] || 0) > 0;
    g.undo();
    if (winsMaterial && !sacrificeCandidate(fenBefore, mv, prevMv)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------
 * The Brilliant decision, as one inspectable gate table (spec §24 / §30).
 *
 *   A  moveQuality        cpl <= BRILLIANT_NEAR_BEST_CPL (or the grand-sac bar)
 *   B  genuineSacrifice   a real piece giveaway — minors and up, never a pawn
 *   C  netSacrifice       the forced exchange leaves the mover genuinely down
 *   D  causedByMove       the move created the concession (sacrificeAttribution)
 *   E  evaluationContext  inside the eval window, or a major-piece sac outside
 *                         it (FORCED, or the RXG6+ upper-window exception whose
 *                         margin to the runner-up stays inside the window)
 *   F  compensation       the engine confirms the sacrifice holds / wins
 *   G  falsePositive      no strictly better non-sacrificing move was available
 *
 * Every gate is ANDed. Sacrifice alone is not Brilliant, cpl alone is not
 * Brilliant, and a lost piece alone is not Brilliant.
 *
 * DETERMINISTIC: pure arithmetic over values the caller already holds. No clock,
 * no randomness, no I/O — calling it twice with the same inputs gives the same
 * answer, which is what lets the review stay reproducible.
 *
 * Exported (not inlined) so tests can assert the gates individually and so the
 * review pipeline can report WHY a candidate was rejected without adding a log
 * statement to the production path.
 * --------------------------------------------------------------- */
export function brilliantGates({
  sacrifice = false,
  hasNetSacrifice = true,
  sacrificeAttributed = true,
  betterNonSacLine = false,
  attackingSac = true,
  forcedSac = false,
  sacMovedCp = null,
  cpl = null,
  bestM = null,
  playedM = null,
  connectedTacticalSacrifice = false,
  forcedMate = false,
  bestScore = null,
  playedScore = null,
  isForced = false,
  secondM = null,
} = {}) {
  /* A. move quality — "best or near-best". 10cp is the engine's noise floor, so
     on its own it proves nothing; it only keeps ordinary moves out. */
  const nearBest = cpl != null && cpl <= BRILLIANT_NEAR_BEST_CPL;
  const grandSacCpl = cpl != null && cpl <= BRILLIANT_SAC_CPL_MAX;

  /* B/C/D — the "was it really a sacrifice" half. All three must hold. */
  const genuineSacrifice = sacrifice === true;
  const netSacrifice = hasNetSacrifice === true;
  const causedByMove = sacrificeAttributed === true;

  /* E. evaluation context. Three ways in: the normal ±600 window, the FORCED
     major-piece exception, and the RXG6+ upper-window exception.

     forcedOutsideWindow — the old code let ANY major-piece sacrifice ignore the
     upper bound, on the theory that a forced mate is worth flagging even when the
     position is already won. That made 46.Rxc6 (black +5.84, a routine winning
     capture that happens to hang a rook) a "!!" purely for being a rook capture.
     This leg requires evidence that the sacrifice was FORCED — there was no
     alternative to play — instead of merely being a queen or rook.

     majorOutsideWindow — the upper-window half of the same exception (19.Rxg6+
     at evalBefore ≈ +692 → mate): a best/near-best MAJOR-piece sacrifice that is
     not forced still keeps Brilliant past BRILLIANT_EVAL_MAX, but only while the
     eval's margin over the runner-up stays inside the SAME sane window
     (bestM − secondM ≤ BRILLIANT_EVAL_MAX). A dead-won eval that runs away from
     every alternative line by more than the window is the "already winning" shape
     the window exists to exclude, and a missing runner-up line gives no evidence
     either way. Below BRILLIANT_EVAL_MIN nothing is ever rescued. */
  const majorSac = sacMovedCp != null && sacMovedCp >= VAL.r;
  const before = normalizeScore(bestScore ?? bestM);
  const after = normalizeScore(playedScore ?? playedM);
  const notDeadLost = before != null && (before.type === 'mate' ? before.winner > 0 : before.value > BRILLIANT_EVAL_MIN);
  const inWindow = before?.type === 'cp' && notDeadLost && before.value < BRILLIANT_EVAL_MAX;
  const mateContext = before?.type === 'mate' && before.winner > 0
    && after?.type === 'mate' && after.winner > 0 && connectedTacticalSacrifice && forcedMate;
  const forcedOutsideWindow = forcedSac === true && majorSac && isForced === true && notDeadLost;
  const majorOutsideWindow = majorSac && notDeadLost && secondM != null
    && bestM != null && (bestM - secondM) <= BRILLIANT_EVAL_MAX;
  const evaluationContext = inWindow || forcedOutsideWindow || majorOutsideWindow || mateContext;

  /* F. compensation. Either the move is effectively the engine's choice (leg 1), or
     it gives up a major piece, still wins the position outright, and is not a
     blunder (leg 2 — the grand sacrifice). */
  const nearBestCompensation = nearBest;
  const grandSacCompensation = majorSac
    && grandSacCpl
    && playedM != null
    && playedM >= BRILLIANT_PLAYED_WIN_CP;
  const compensation = evaluationContext && (nearBestCompensation || grandSacCompensation);

  /* G. false positives. */
  const gratuitousSac = betterNonSacLine === true;
  const falsePositive = gratuitousSac;

  /* H. the sacrifice must actually achieve something — check, attack, or a real
     material gain. Without this, 46.Rxc6 and 28.Qxf2 both passed: cpl 0, a genuine
     piece giveaway, engine-best, no better line. They merely took a pawn while
     hanging the capturing piece and attacked nothing. */
  const achievesSomething = attackingSac === true || connectedTacticalSacrifice === true;

  return {
    moveQuality: nearBest || grandSacCpl,
    nearBest,
    genuineSacrifice,
    netSacrifice,
    causedByMove,
    evaluationContext,
    inWindow,
    forcedOutsideWindow,
    majorOutsideWindow,
    compensation,
    falsePositive,
    gratuitousSac,
    achievesSomething,
    majorSac,
    cpl,
    sacMovedCp,
    pass: genuineSacrifice
      && netSacrifice
      && causedByMove
      && evaluationContext
      && compensation
      && achievesSomething
      && !falsePositive,
  };
}

/* ---------------------------------------------------------------
 * Per-move accuracy (0–100) — the chess.com win%-drop score.
 *
 * A move's single quality number comes from the win PERCENTAGE it dropped:
 *
 *     acc(i) = ACC_MAX · e^(−ACC_DECAY · winPctDrop) − ACC_FLOOR
 *
 * where winPctDrop = winPercent(best) − winPercent(played) (0–100 pp, floored
 * at 0) and ACC_MAX/ACC_DECAY/ACC_FLOOR are the reverse-engineered chess.com
 * CAPS constants (103.1668 / 0.04354 / 3.1669), clamped to 0..100. A perfect
 * move (winPctDrop 0) lands on exactly 100.
 *
 * Perfect verdicts (best / brilliant / great) have winPctDrop 0
 * and sit at exactly 100; book moves return null (opening theory never bends
 * the score); rows without engine data also return null.
 * --------------------------------------------------------------- */
export const PERFECT_VERDICTS = ['brilliant', 'great', 'best'];

/* The single 1-decimal rounding used at EVERY numeric output step — per-move
   accuracy, game accuracy, avg CPL. One definition, so rounding can never
   drift between stages/runs. */
export const round1 = (x) => Math.round(x * 10) / 10;

/* error verdicts — the ones a too-shallow search is never allowed to output.
   Miss counts too: a wrongly-claimed "Miss" is just as accusing as a mistake. */
export function isErrorVerdict(v) {
  return v === 'inaccuracy' || v === 'mistake' || v === 'blunder' || v === 'miss';
}

/* Trust floor: when the engine data behind a verdict is untrusted (a cold
   first review's shallow search), error labels collapse to the quiet "good"
   row rather than accusing a move of mistake/blunder. Non-error verdicts
   (best/great/book…) are kept — they are the conservative, favourable read. */
export function withTrustFloor(verdict, trusted) {
  return !trusted && isErrorVerdict(verdict) ? 'good' : verdict;
}

export function moveAccuracy(bestM, playedM, verdict = null) {
  if (verdict === 'book') return null;
  if (verdict && PERFECT_VERDICTS.includes(verdict)) return 100;
  const wpd = winPercentDrop(bestM, playedM);
  if (wpd == null) return null;
  const acc = ACC_MAX * Math.exp(-ACC_DECAY * wpd) - ACC_FLOOR;
  return Math.max(0, Math.min(100, round1(acc)));
}

/* ---------------------------------------------------------------
 * Pure verdict decision — NO engine, NO I/O, importable anywhere
 * (browser review, live analysis, node validation scripts).
 *
 * Inputs are all engine evals in MOVER perspective (cp):
 *   bestM       eval of the best move before the played one (eval_before)
 *   playedM     eval of the position after the played move (eval_after)
 *   secondM     runner-up eval (for "Great"/forced); may be null
 *   isBestMove  played move == engine's best move (strict)
 *   sacrifice   played move is a genuine piece sacrifice (see sacrificeCandidate)
 *   isForced    only one legal reasonable move existed (single legal move, or
 *               every alternative ≥ FORCED_SECOND_LOSS_CP worse — derived from
 *               the MultiPV runner-up gap, never an evaluate-all-legals loop)
 *   hasSafeAlternative  another MultiPV line is not a disaster ⇒ not forced (Brilliant spec 4)
 *   hasNetSacrifice     the sacrifice survives the FULL forced exchange sequence
 *                       (settledNetSacrifice: the enemy never took the offered
 *                       piece, or the line still leaves us net-down — not a
 *                       trade) [Brilliant 2b]
 *   isSharp     position is not "quiet" (a real check or capture of our side was
 *               available) — Great's optional sharpness gate
 *   isBook      move inside opening theory
 *   moveNumber  fullmove number (1-based); "book" applies only while
 *               moveNumber ≤ BOOK_MAX_MOVE_NUMBER.
 *
 * The effective metrics:
 *   winPctDrop  = winPercent(best) − winPercent(played) (mover perspective,
 *                 floored at 0) — the chess.com severity metric that drives
 *                 the error bands: Excellent ≤2 / Good ≤5 / Inaccuracy ≤10 /
 *                 Mistake ≤20 / Blunder >20 (points of win% dropped).
 *   evalLoss    = evalAfterBestMove − evalAfterPlayedMove (≥ 0) — kept for the
 *                 per-move CPL column and the Miss rule.
 *   isAlreadyLosing = evalBefore ≤ LOST_POSITION_CP (−300) — kills Great.
 *   isTopEngineMove = isBestMove (engine's #1).
 *
 * Rules are evaluated top-to-bottom, first match wins, exactly as
 * documented in reviewConfig.js in the fixed SPECIAL VERDICT ORDER:
 *   1 Brilliant → 2 Great → 3 Best → 4 Excellent →
 *   5 Good → 6 Inaccuracy → 7 Mistake → 8 Blunder (Book → Miss run first,
 *   above the badges).
 * Brilliant runs FIRST so a forced sacrifice (e.g. Rxg6+ leading to mate)
 * is Brilliant. Brilliant requires: best/near-best (cpl ≤
 * BRILLIANT_NEAR_BEST_CPL), a genuine material sacrifice of a minor or
 * greater that SURVIVES the full forced exchange sequence (not a trade),
 * −600..600 eval window. A FORCED move that is NOT a sacrifice can never be
 * Great (Great requires not-forced); when it is also the engine's #1 choice
 * it falls through to Best.
 * Great is the "only clearly-good option": played is best/near-best + runner-up ≥
 * GREAT_MIN_GAP_CP worse (but < FORCED_SECOND_LOSS_CP), not forced, not an
 * already-lost position, and (optionally) in a sharp position. Brilliant is
 * checked first, so a qualifying sacrifice is Brilliant, never Great.
 * --------------------------------------------------------------- */
export function classifyMove({
  isBook = false,
  isBestMove = false,
  sacrifice = false,
  hasSafeAlternative = true,
  isSharp = true,
  hasNetSacrifice = true,
  bestM = null,
  playedM = null,
  secondM = null,
  isForced = false,
  moveNumber = BOOK_MAX_MOVE_NUMBER,
  sacMovedCp = null,
  sacrificeAttributed = true,
  betterNonSacLine = false,
  attackingSac = true,
  forcedSac = false,
  connectedTacticalSacrifice = false,
  forcedMate = false,
  bestScore = null,
  playedScore = null,
}) {
if (bestM == null || playedM == null) return isBook ? 'book' : 'good'; // no engine data → neutral

  const before = normalizeScore(bestScore ?? bestM);
  const after = normalizeScore(playedScore ?? playedM);
  const { cpl } = moveMetrics(before, after);
  const wpd = winPercentDrop(bestM, playedM);
  const evalBefore = bestM;
  const isAlreadyLosing = evalBefore <= LOST_POSITION_CP;
  const isTopBest = cpl <= BRILLIANT_NEAR_BEST_CPL; // compatibility: played within 10cp of best
  /* The Brilliant evaluation window now lives in brilliantGates() as gate E, next
     to the forced-major-sac exception that qualifies for going outside it. */

  /* ── 1. Book — opening theory, only within the first 15 fullmoves ──
     After move 15 the opening phase is over and the move is classified
     normally. A book move that is still a real Mistake/Blunder (winPctDrop >
     WPD_INACCURACY_MAX) escapes the label — theory that loses material stays
     flagged. */
  if (isBook && moveNumber <= BOOK_MAX_MOVE_NUMBER) {
    return wpd > WPD_MISTAKE_MAX ? 'blunder'
      : wpd > WPD_INACCURACY_MAX ? 'mistake'
      : 'book';
  }

  /* ── 2. Miss — a forced win/mate was available, but the player missed it ──
     A "forced win on the board" shows up as a mate score (near MATE_SCORE)
     or a decisive win (≥ MISS_WIN_CP). Playing a move that loses at least
     MISS_MIN_LOSS_CP from there means the win was allowed to slip. */
  const hadForcedWin = (before?.type === 'mate' && before.winner > 0)
    || (before?.type === 'cp' && before.value >= MISS_WIN_CP);
  if (hadForcedWin && cpl >= MISS_MIN_LOSS_CP) return 'miss';

  /* ── SPECIAL VERDICTS — fixed order: Brilliant → Great → Best ── */

/* 1. Brilliant — see brilliantGates() for the full gate table (A–G).
      A move must be best/near-best AND a genuine net sacrifice that THIS move
      created, inside a sane evaluation window (or a major-piece sac outside it),
      with
      engine-confirmed compensation, and with no better non-sacrificing move left
      on the board.
      Runs FIRST so a forced brilliant-looking sac is Brilliant, never Best.
      Chess.com marks forced sacrifices (queen sacs, rook sacs leading to mate)
      as brilliant — the sacrifice IS the brilliant find, not the choice vs
      alternatives.
      LEG 1 (classical): played is best/near-best (cpl ≤ BRILLIANT_NEAR_BEST_CPL).
      LEG 2 (grand sacrifice): the played piece being sacrificed is a MAJOR piece
      (rook/queen, sacMovedCp ≥ VAL.r) that ACTUALLY gets given up — the engine
      found a slightly-better line, but the major sacrifice still clearly wins:
      cpl ≤ BRILLIANT_SAC_CPL_MAX AND playedM (mover perspective) ≥
      BRILLIANT_PLAYED_WIN_CP afterwards. The major-piece floor keeps a mere
      bishop-for-knight recapture (Bxc6) from ever becoming Brilliant; a hanging
      queen / losing sac leaves playedM low or negative and can never pass.
      WINDOW: Brilliant normally requires Brilliant-EVAL_MIN < bestM <
      BRILLIANT_EVAL_MAX. The ways outside that are all MAJOR-piece: a FORCED
      major-piece sacrifice (forcedSac && isForced), or the RXG6+ upper-window
      exception (majorOutsideWindow — a best/near-best rook/queen sac whose
      margin over the runner-up stays inside BRILLIANT_EVAL_MAX). Being a queen
      or rook sac no longer bypasses the window on its own. Nothing below
      BRILLIANT_EVAL_MIN (dead-lost) is ever Brilliant.
      FREE-POSITIVE FILTER: cpl ≤ 10 is engine noise, so a sacrifice that was
      measurably WORSE than an available non-sacrificing move (22...Qxg6 losing
      to 22...f7g6 by 9cp) is rejected — see betterNonSacrificialLine(). */
  if (brilliantGates({
    sacrifice,
    hasNetSacrifice,
    sacrificeAttributed,
    betterNonSacLine,
    attackingSac,
    connectedTacticalSacrifice,
    forcedMate,
      bestScore: before,
      playedScore: after,
      forcedSac,
      sacMovedCp,
      cpl,
      bestM,
      playedM,
      secondM,
      isForced,
    }).pass) {
    return 'brilliant';
  }

  /* 2. Great — the ONLY clearly-good option (critical find): played is the
     engine's best or near-best (within BRILLIANT_NEAR_BEST_CPL) AND
     runner-up ≥ GREAT_MIN_GAP_CP worse (gap < FORCED_SECOND_LOSS_CP ⇒ not
     forced, which would be Best — a forced move is never Great), never in an
     already-lost position, and — when GREAT_NEEDS_SHARP_POSITION — in a
     tactically-dense position, so a big gap that just reflects an opponent
     blunder handed to a quiet move stays Best. Brilliant already won if a
     sacrifice qualified. */
  if (
    isTopBest &&
    !isForced &&
    !isAlreadyLosing &&
    secondM != null &&
    bestM - secondM >= GREAT_MIN_GAP_CP &&
    (!GREAT_NEEDS_SHARP_POSITION || isSharp)
  ) {
    return 'great';
  }

  /* 3. Best — played IS the engine's best move (a forced best move — single
     legal move, or every alternative ≥ FORCED_SECOND_LOSS_CP worse — lands
     here too, since Brilliant required a sacrifice and Great requires
     not-forced). */
  if (isBestMove) return 'best';

  /* ── 10. Blunder — the move hands the opponent a forced mate ── */
  if (after?.type === 'mate' && after.winner < 0) return 'blunder';

  /* ── 6–10. error bands — pure win% loss (winPctDrop), first match wins ── */
  if (wpd <= WPD_EXCELLENT_MAX) return 'excellent';
  if (wpd <= WPD_GOOD_MAX) return 'good';
  if (wpd <= WPD_INACCURACY_MAX) return 'inaccuracy';
  if (wpd <= WPD_MISTAKE_MAX) return 'mistake';
  return 'blunder';
}

/* ---------------------------------------------------------------
 * Sacrifice detection (shared by review + validation).
 * Does `mv` (a verbose chess.js move from position `fen`) give up material
 * on purpose? Used to award Brilliant to an otherwise-best move.
 *
 * A sacrifice is GENUINE when — not a trade, not a free win:
 *   (1) a piece of ANY value is offered on an enemy-attacked, own-defended-
 *       loosely square (typical "take my piece" idea in an attack) — including
 *       offers punishable only by the enemy king (Nxf7 Kxf7 forks) — with NO
 *       equal-or-better recapture of our own (an equal trade is not a sac), or
 *   (2) a capture that gives up material (moved ≥ minor, dealt > 0 — this covers
 *       the classical minor-piece-for-pawn sacs Nxf7/Bxh7/Bxd5 as well as
 *       mate-netting rook/queen sacs), still lets the enemy take the piece
 *       (destination capturable, no equal-or-better recapture of our own).
 *
 * Kings count as recapture threats too (a lone king often IS the only way to
 * take a sacrificed piece), but a free capture of a *bigger* piece (Bxd8
 * winning a queen) has dealt < 0 and is never flagged — that's a win, not a
 * sacrifice.
 *
 * WHY GEOMETRY, NOT THE ENGINE'S BEST REPLY: the Brilliant spec (v2) measured
 * the sacrifice with a best-reply material simulation — material_before minus
 * material_after(the opponent's single best reply). That formula silently
 * rejects the most famous brilliancies: a poisoned piece (e.g. 19.Bxd5, where
 * Qxd5 blunders the queen to Nxd5) is NEVER the opponent's best reply, so the
 * simulated material stays flat → "no sacrifice". The material actually given
 * up is what the opponent CAN capture — the piece's value minus what we gained
 * (deal), exactly what the geometry below measures. Geometry is also pure (no
 * extra engine call), so it keeps the review fully deterministic.
 * --------------------------------------------------------------- */
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/* Does `color`'s king stand within one square of `sq`? Pure geometry, no legality —
   the same test the kingCanTake and ourKingDef scans have always used, factored out
   so the attribution probe below cannot drift from the sacrifice detectors it sits
   next to. The question is never "may the king legally step there" but "is the
   square king-covered", which is why legality is deliberately not consulted. */
function kingAdjacent(g, sq, color) {
  const tf = sq.charCodeAt(0) - 97;
  const tr = Number(sq[1]) - 1;
  for (const row of g.board()) {
    for (const p of row) {
      if (!p || p.type !== 'k' || p.color !== color) continue;
      const df = Math.abs(p.square.charCodeAt(0) - 97 - tf);
      const dr = Math.abs(Number(p.square[1]) - 1 - tr);
      if (df <= 1 && dr <= 1) return true;
    }
  }
  return false;
}

/* does the `color` camp (geometrically) attack square `sq`? returns the value
   of its most valuable attacking piece (kings excluded), 0 = unattacked; pass
   mode='min' to get the CHEAPEST attacker instead (what the enemy would really
   risk to take an offered piece). `skipSquare` (optional) is excluded from the
   scan — used to measure how strongly a square is defended AFTER a piece leaves
   it, so a mover's own pre-move attack on its destination isn't counted as a
   defender. Pure geometry + blockers: turn / legality are irrelevant for this
   scan. */
export function attackValueBy(g, sq, color, skipSquare = null, mode = 'max') {
  const board = g.board(); // board()[0] is RANK 8, board()[7] is RANK 1
  const rowOf = (s) => 8 - Number(s[1]);
  const [tf, tr] = [sq.charCodeAt(0) - 97, rowOf(sq)];
  const clearRay = (f0, r0, f1, r1) => {
    const sf = Math.sign(f1 - f0), sr = Math.sign(r1 - r0);
    let f = f0 + sf, r = r0 + sr;
    while (!(f === f1 && r === r1)) {
      if (r < 0 || r > 7 || f < 0 || f > 7 || board[r][f]) return false;
      f += sf; r += sr;
    }
    return true;
  };
  let best = 0;
  for (const row of board) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === 'k') continue;
      if (skipSquare && p.square === skipSquare) continue;
      const [ff, r0] = [p.square.charCodeAt(0) - 97, rowOf(p.square)];
      if (ff === tf && r0 === tr) continue; // a piece does not "attack" its own square
      const dx = Math.abs(tf - ff), dy = Math.abs(tr - r0);
      let hit = false;
      if (p.type === 'n') hit = (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
      else if (p.type === 'p') hit = dx === 1 && (tr - r0) === (color === 'w' ? -1 : 1);
      else if (p.type === 'b') hit = dx === dy && clearRay(ff, r0, tf, tr);
      else if (p.type === 'r') hit = (dx === 0 || dy === 0) && clearRay(ff, r0, tf, tr);
      else if (p.type === 'q') hit = (dx === dy || dx === 0 || dy === 0) && clearRay(ff, r0, tf, tr);
      if (hit) {
        best = mode === 'min'
          ? (best === 0 ? VAL[p.type] : Math.min(best, VAL[p.type]))
          : Math.max(best, VAL[p.type]);
      }
    }
  }
  return best;
}

/* shared geometry facts about `mv` from `fen` that every sacrifice detector
   needs. Returns null for non-moves, otherwise:
     recapture      the move retakes onto the enemy's last-captured square
     moved          value of the moved piece (cp)
     gained         value of whatever was captured (incl. en passant)
     dealt          moved − gained (net material spent)
     theirAtk       enemy attack value on the landing square (max attacker)
     theirCheapest  enemy attack value on the landing square (CHEAPEST attacker
                    — the piece the enemy would actually risk to win an offer)
     ourDef         our defence value on the landing square AFTER we leave `from`
     ourKingDef     whether OUR king defends the landing square (a king is a
                    real defender: the enemy can't collect an offer the mover's
                    own king can recapture — mirrors canBeTaken's king scan)
     canBeTaken     enemy can capture the landing square (king included) */
export function sacrificeCore(fen, mv, prevMv) {
  if (!fen || !mv || !mv.piece) return null;

  /* A recapture — retaking the piece the opponent just captured onto the SAME
     square (prevMv.to) — simply restores material parity. Even when it is the
     engine's top move, it is not a sacrifice (e.g. 17.Nxe3 retaking on e3
     after 16...fxe3 is Best, not Brilliant). */
  const recapture = Boolean(
    prevMv &&
    prevMv.to === mv.to &&
    prevMv.flags &&
    (prevMv.flags.includes('c') || prevMv.flags.includes('e'))
  );

  const g = (() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  })();
  if (!g) return null;
  const enemy = mv.color === 'w' ? 'b' : 'w';
  const gained = mv.captured ? VAL[mv.captured] : mv.flags && mv.flags.includes('e') ? VAL.p : 0;
  const moved = VAL[mv.piece] || 0;
  const [tf, tr] = [mv.to.charCodeAt(0) - 97, Number(mv.to[1]) - 1];

  const theirAtk = attackValueBy(g, mv.to, enemy);
  const theirCheapest = attackValueBy(g, mv.to, enemy, null, 'min');
  const ourDef = attackValueBy(g, mv.to, mv.color, mv.from);

  /* can the enemy take the landing square at all (king included)?
     A KING recapture is only legal if the landing square is NOT defended by
     our side (a king cannot trade — stepping onto a defended square is moving
     into check). Probe with chess.js (pins included): apply the sacrifice onto
     a scratch board, then try to move the enemy king onto the landing square.
     When our side defends `to` (e.g. Rxg6+ where the bishop on d3 covers g6),
     the "sacrifice" can never actually be collected → not a real sacrifice. */
  let kingCanTake = false;
  for (const row of g.board()) {
    for (const p of row) {
      if (p && p.type === 'k' && p.color === enemy) {
        const df = Math.abs(p.square.charCodeAt(0) - 97 - tf);
        const dr = Math.abs(Number(p.square[1]) - 1 - tr);
        if (df <= 1 && dr <= 1) {
          let probe = null;
          try {
            probe = new Chess(fen);
          } catch { probe = null; }
          if (!probe) break;
          try {
            probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
            probe.move({ from: p.square, to: mv.to });
            kingCanTake = true;
          } catch { kingCanTake = false; }
          break;
        }
      }
    }
    if (kingCanTake) break;
  }
  const canBeTaken = theirAtk > 0 || kingCanTake;
  const dealt = moved - gained;

  /* can OUR king defend the landing square? same adjacency scan as kingCanTake,
     for the mover's own camp. Without it, a knight that lands on a square the
     enemy "attacks" with a piece it can never collect (e.g. 6...Nf6 under Qf3,
     where the g7 king punishes Qxf6+? Kxf6) reads as an undefended hanging
     piece → false Brilliant. */
  const ourKingDef = kingAdjacent(g, mv.to, mv.color);

  return {
    recapture, moved, gained, dealt,
    theirAtk, theirCheapest, ourDef, ourKingDef, canBeTaken,
  };
}

export function heuristicIsSacrifice(fen, mv, prevMv) {
  const c = sacrificeCore(fen, mv, prevMv);
  if (!c || c.recapture) return false;

  /* (1) a genuine "take my piece" offer: a piece lands loose under enemy fire
      AND the enemy can actually COLLECT — the mover's own king does not cover
      the landing square, and capturing it wins real material (no equal/better
      defender refunds the take: when we DO have a defender, the cheapest piece
      able to capture must be worth less than the offered piece). A move that
      merely lands next to the mover's king (6...Nf6 under Qf3) or that only
      offers an even trade (23...Qe8, where the enemy queen retakes = swap) is
      a quiet move, NOT a sacrifice — it reads as Brilliant today only because
      the king was counted as no defender at all. */
  const profitableTake = c.ourDef > 0 ? c.moved > c.theirCheapest : c.moved > 0;
  const offeredLoose = !mv.captured
    && c.moved >= VAL.n
    && c.canBeTaken
    && c.theirAtk >= VAL.p
    && c.ourDef < c.moved
    && !c.ourKingDef
    && profitableTake;

/* (2) a CAPTURE that gives up a minor piece or better (moved ≥ VAL.n, gained > 0 —
      only captures actually spend a full piece-for-pawn deal) and still SPENDS
      meaningful net material (dealt ≥ VAL.p — at least a pawn's worth, filtering
      trivial even trades like Bxf6 where bishop−knight ≈ 0) while staying
      capturable, with no equal-or-better recapture of our own (a trade back
      would just restore material; the sacrificed piece must actually stay
      capturable). This is the classical minor-piece-for-pawn sacrifice —
      knight for pawn (Nxf7), bishop for pawn (Greek-gift Bxh7, Bxd5) — as
      well as the bigger mate-netting rook/queen sacs. A free win (Bxd8,
      dealt < 0) is never a sac. */
  const exchangeSac = c.moved >= VAL.n
    && c.gained > 0
    && c.dealt >= VAL.p
    && c.canBeTaken
    && c.ourDef < c.moved
    && !c.ourKingDef;

  /* After-position defense guard: the BEFORE position may show the landing
     square as undefended (ourDef < moved), but the capture itself vacates the
     from-square, which can open a sliding-piece diagonal/rank/file that NOW
     defends the landing square (e.g. Bxc6: queen on g2 defends c6 through the
     vacated e4). When the moved piece is well-defended on its landing square
     in the AFTER position, a recapture is unfavorable → this is a favorable
     trade, NOT a genuine sacrifice.
     Chess.com king-zone exception: a MAJOR piece (rook/queen, moved ≥ VAL.r)
     capturing near the enemy king (within 2 squares) still counts as a
     sacrifice even when it proves defensible — the piece is genuinely on offer
     in the king zone (e.g. Rxf6 where a rook is defended by the other rook
     through the vacated f-file, but the enemy CAN capture it and the follow-up
     is crushing). Minor pieces stay correctly gated by the guard (Bxc6/Bxg7). */
  if (exchangeSac) {
    try {
      const after = new Chess(fen);
      after.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      if (attackValueBy(after, mv.to, mv.color) >= c.moved) {
        const enemy = mv.color === 'w' ? 'b' : 'w';
        let ek = null;
        for (const row of after.board()) {
          for (const p of row) {
            if (p && p.type === 'k' && p.color === enemy) { ek = p; break; }
          }
          if (ek) break;
        }
        if (c.moved >= VAL.r && ek && c.canBeTaken && !c.ourKingDef && c.dealt > 0) {
          const kf = Math.abs(mv.to.charCodeAt(0) - ek.square.charCodeAt(0));
          const kr = Math.abs(Number(mv.to[1]) - Number(ek.square[1]));
          if (kf <= 2 && kr <= 2) return offeredLoose || exchangeSac;
        }
        return offeredLoose || false;
      }
    } catch { /* move failed on board — keep current result */ }
  }

  return offeredLoose || exchangeSac;
}

/* Brilliant's sacrifice pre-filter: the same "real sacrifice, not a trade"
   geometry as heuristicIsSacrifice, with the spec's MINIMUM threshold of a
   MINOR piece (sacrifice_amount ≥ 3 on the pawn=1/minor=3/rook=5/queen=9
   scale — i.e. the offered piece must be knight/bishop or higher). Pure pawn
   sacrifices never qualify for Brilliant and fall through to Great/Best.
   The review pipeline computes this BEFORE calling classifyMove, so the
   "sacrifice" flag Brilliant sees is always minor-or-greater. */
export function sacrificeCandidate(fen, mv, prevMv) {
  const c = sacrificeCore(fen, mv, prevMv);
  if (!c || c.recapture) return false;
  const profitableTake = c.ourDef > 0 ? c.moved > c.theirCheapest : c.moved > 0;
  const looseOffer = !mv.captured
    && c.moved >= VAL.n
    && c.canBeTaken
    && c.theirAtk >= VAL.p
    && c.ourDef < c.moved
    && !c.ourKingDef
    && profitableTake;
  const exchangeSac = c.moved >= VAL.n
    && c.gained > 0
    && c.dealt >= VAL.p
    && c.canBeTaken
    && c.ourDef < c.moved
    && !c.ourKingDef;
  if (exchangeSac) {
    try {
      const after = new Chess(fen);
      after.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      if (attackValueBy(after, mv.to, mv.color) >= c.moved) {
        const enemy = mv.color === 'w' ? 'b' : 'w';
        let ek = null;
        for (const row of after.board()) {
          for (const p of row) {
            if (p && p.type === 'k' && p.color === enemy) { ek = p; break; }
          }
          if (ek) break;
        }
        if (c.moved >= VAL.r && ek && c.canBeTaken && !c.ourKingDef && c.dealt > 0) {
          const kf = Math.abs(mv.to.charCodeAt(0) - ek.square.charCodeAt(0));
          const kr = Math.abs(Number(mv.to[1]) - Number(ek.square[1]));
          if (kf <= 2 && kr <= 2) return looseOffer || exchangeSac;
        }
        return looseOffer || false;
      }
    } catch { /* move failed on board — keep current result */ }
  }
  return looseOffer || exchangeSac;
}

/* ---------------------------------------------------------------
 * Protected tactical-sacrifice GEOMETRY (path C).
 *
 * The loose path above (sacrificeCandidate) demands `ourDef < moved`: the
 * offer must land loose. That correctly rejects even trades, but it also
 * rejects genuine tactical sacrifices whose piece stays defended — e.g.
 * 25...Bxg3, where the bishop lands on g3 under fire from the f-pawn yet
 * defended by the g4 rook. A defended offer is usually an even trade, so this
 * geometry alone can NEVER bless a move: it only opens the door to
 * post-continuation validation (D), which demands real tactical evidence from
 * the existing settlement machinery. Without that evidence the move dies
 * exactly where a hanging defended piece should.
 *
 * Shape (all cheap, pure board logic, no engine call):
 *   - not a recapture, moved piece minor-or-better, real material spent
 *     (dealt ≥ pawn — a non-spending offer is merely contested, and a free
 *     winning capture is a win, not a sacrifice);
 *   - the enemy genuinely attacks the landing square and can collect (a pinned
 *     or otherwise illegal take is found by the accept-capture search, not here);
 *   - THE protected marker: our own non-king defence covers the landing square
 *     at least as well as the piece is worth (ourDef ≥ moved);
 *   - not king-covered (a king "defender" means the offer cannot be collected,
 *     same rule as the loose path);
 *   - the take itself wins real material (moved > theirCheapest).
 *
 * Deliberately NO after-position defence guard here (the Bxc6 guard of the
 * loose path): a defended offer is EXPECTED to stay defended. What replaces
 * that guard is the continuation evidence in D.
 * --------------------------------------------------------------- */
export function protectedSacrificeGeometry(fen, mv, prevMv) {
  const c = sacrificeCore(fen, mv, prevMv);
  if (!c || c.recapture) return false;
  if (c.moved < VAL.n) return false;
  if (c.dealt < VAL.p) return false;
  if (!c.canBeTaken) return false;
  if (c.theirAtk < VAL.p) return false;
  if (c.ourDef < c.moved) return false;
  if (c.ourKingDef) return false;
  if (!(c.moved > c.theirCheapest)) return false;
  return true;
}

/* ---------------------------------------------------------------
 * Post-continuation tactical validation (path D).
 *
 * Decides a protected-shape offer using ONLY pre-existing settlement evidence
 * — no new scoring, no new thresholds. Each accepted signal already means the
 * line produced something real:
 *   - connectedTacticalSacrifice: the offer was taken AND pressed with checks,
 *     material or mate behind it;
 *   - forcedMate: the accepted line mates;
 *   - materialWinning: the accepted line recovers more than was given.
 * A defended hanging piece (taken quietly, nothing behind it) fails all three.
 * --------------------------------------------------------------- */
export function protectedSacrificeValidated(settled) {
  if (!settled) return false;
  return settled.connectedTacticalSacrifice === true
    || settled.forcedMate === true
    || settled.materialWinning === true;
}

/* ---------------------------------------------------------------
 * Legal captures of the square `mv` just landed on, cheapest attacker first.
 *
 * The accept line is what tests a defended offer: the opponent collects with
 * the piece they would actually risk, and the engine's reply from there shows
 * whether the sacrifice has compensation or was just hanging material. Only
 * LEGAL captures are listed (a pinned "attacker" from the geometry cannot
 * collect, so it can never be the accept line). Deterministic: attackers are
 * ordered by ascending piece value, then square name.
 *
 * @param {string} fenAfter position AFTER the move (opponent to move)
 * @param {string} square   the landing square being offered
 * @param {'w'|'b'} mover   the side that made the offer (for piece values)
 * @returns {string[]} UCI strings (with promotion suffix where applicable)
 * --------------------------------------------------------------- */
export function acceptCaptureUcis(fenAfter, square, mover) {
  let g = null;
  try {
    g = new Chess(fenAfter);
  } catch {
    return [];
  }
  const taker = mover === 'w' ? 'b' : 'w';
  if (g.turn() !== taker) return [];
  const found = [];
  let moves = [];
  try {
    moves = g.moves({ verbose: true });
  } catch {
    return [];
  }
  for (const m of moves) {
    if (!m || m.to !== square || !m.captured) continue;
    found.push({
      uci: `${m.from}${m.to}${m.promotion || ''}`,
      cost: VAL[m.piece] || 0,
      from: m.from,
    });
  }
  found.sort((a, b) => (a.cost - b.cost) || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return found.map((f) => f.uci);
}

/* ---------------------------------------------------------------
 * Great's optional sharpness gate (GREAT_NEEDS_SHARP_POSITION).
 * A position is "quiet" when the side to move has NO legal capture and NO
 * checking move. A big eval gap in a quiet position usually reflects a
 * previous opponent blunder (their move hung something for free), so the
 * "only clearly-good option" is not a tactical find → no "!". A single crude
 * engine-free geometry probe (chess.js move generation), fully deterministic.
 * Returns true = quiet (would suppress Great), false = sharp.
 * --------------------------------------------------------------- */
export function isQuietPosition(fen) {
  let g = null;
  try {
    g = new Chess(fen);
  } catch { return true; }
  const moves = g.moves({ verbose: true });
  if (!moves.length) return true;
  for (const mv of moves) {
    if (mv.flags && (mv.flags.includes('c') || mv.flags.includes('e'))) return false;
  }
  /* Replay each candidate on ONE instance and undo, instead of rebuilding the
     whole position from the FEN for every legal move. Same checks, same order,
     same answers — a position with 40 legal moves used to construct 40 Chess
     objects (each re-deriving move generation from scratch) and this runs on
     the main thread inside the review loop. `undo()` restores the pre-move
     state, so the next probe starts from the identical position. */
  let probe = null;
  try {
    probe = new Chess(fen);
  } catch { return true; }
  for (const mv of moves) {
    try {
      const made = probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      if (made && probe.inCheck()) { probe.undo(); return false; }
      if (made) probe.undo();
    } catch { /* keep scanning */ }
  }
  return true;
}

/* ---------------------------------------------------------------
 * Brilliant-2b net-trade guard.
 *
 * sumMaterialFor   — the `mover` camp's remaining material in `fen` (cp).
 *
 * settledNetSacrifice — resolve the FULL forced exchange sequence (not just
 * the opponent's first reply) and decide whether the "sacrifice" is still a
 * real one or was just a trade. Replay `playedUci` from `fenBefore`, then
 * walk the engine's best continuation (`pv` uci moves) for up to `maxPlies`,
 * following only moves that are tactically CONNECTED to the offer: a capture,
 * a check, or the opponent's forced reply to a check. The walk stops at the
 * first quiet move nobody was forced to play, so unrelated later pawn grabs
 * are never counted as compensation.
 *
* The forced-reply rule is what makes a real sequence settle correctly. In the
 * reproduction game the recovery happens two plies after the last capture, and
 * the ply that carries it is a king move nobody chose to make:
 *
 *      9.Qxf6   white gives up the queen and wins the knight on f6
 *      9...Bxf6  black collects the queen        (offeredTaken = true)
 *     10.Nf7+   a CHECK — not a capture, and it earns nothing on its own
 *     10...Kg8  the forced reply: no capture, no check of its own
 *     11.Nxd8   the knight takes the QUEEN on d8  <-- the actual compensation
 *
 * Stopping at 10...Kg8 (it is neither a capture nor a check) read the sequence as
 * "queen given, knight taken, nothing won" — netDown 580 — which read as a bare
 * giveaway. Following the forced reply reaches Nxd8 and settles the true net: 900
 * given, 320 + 900 won, netDown −320. The negative figure is the correct answer,
 * not an error: the offer was repaid with interest, which is what makes a queen
 * sacrifice brilliant rather than merely a loss.
 *
 * Returns { netDown, offeredTaken }:
 *   netDown      = (value of the MOVER's pieces captured during the played
 *                  move + forced line) − (value of the OPPONENT's pieces the
 *                  mover captured there). POSITIVE = mover ends genuinely DOWN
 *                  (a real sacrifice), ≤ 0 = the line refunded it to equal or
 *                  better (a trade — never Brilliant).
 *   offeredTaken = whether the OPPONENT ever captured the very piece the mover
 *                  just played (on its landing square) in that sequence. If the
 *                  offered piece is never taken, the invite is still standing
 *                  (a poisoned/declined offer like 19.Bxd5 — Brilliant stays).
 *
 * Pure chess.js replay; the only engine input is the PV itself. The board
 * canNOT measure a trade directly (captures never add to the captor's own sum),
 * so both directions of the exchange are tracked to get the true net material
 * change — exactly what "resolve the full forced exchange, compare NET at the
 * end" means.
 * --------------------------------------------------------------- */
export function sumMaterialFor(fen, color) {
  try {
    const g = new Chess(fen);
    let total = 0;
    for (const row of g.board()) {
      for (const p of row) if (p && p.color === color) total += VAL[p.type] || 0;
    }
    return total;
  } catch { return null; }
}

export function isConnectedTacticalSacrifice(settled) {
  return Boolean(settled && settled.offeredTaken && settled.pressed
    && (settled.checksInContinuation >= 1 || settled.materialWinning || settled.forcedMate));
}

export function hasSettledSacrifice(settled) {
  return !settled || !settled.offeredTaken || settled.pressed
    || settled.materialWinning || settled.forcedMate;
}

export function settledNetSacrifice(fenBefore, mover, playedUci, continuation, maxPlies, engineEvaluation = null) {
  if (!fenBefore || !playedUci) return null;
  let g = null;
  try {
    g = new Chess(fenBefore);
  } catch { return null; }
  let played;
  try {
    played = g.move({
      from: playedUci.slice(0, 2),
      to: playedUci.slice(2, 4),
      promotion: playedUci.length > 4 ? playedUci[4] : undefined,
    });
  } catch { return null; }
  if (!played) return null;

let netDown = 0;
  /* Both sides of the exchange, tracked separately so the settlement can say WHAT
     was given and WHAT came back rather than only the difference. `given` is the
     mover's material the opponent collected; `recovered` is the opponent's
     material the mover collected. netDown === given − recovered. */
  let given = 0;
  let recovered = 0;
  const sequence = [];
  let forcing = false;
  let checksInContinuation = 0;
  const forcingMoves = [];
  let quietBridges = 0;
  let matingContinuation = false;
  if (played.captured) {
    const won = VAL[played.captured] || VAL.p;
    netDown -= won;
    /* The candidate move's own capture is part of the recovery too — without it
       here, netDown ≠ given − recovered. */
    recovered += won;
  }
  const offeredTo = playedUci.slice(2, 4);
  const offeredType = played.piece;
  let offeredTaken = false;
  let ourTurn = false; // after the played move it is the opponent's turn
  let moverPressPlies = 0; // accepted walk plies played by the mover (captures/checks/forced only)
  let plies = 0;
  const limit = Math.max(1, Number.isFinite(maxPlies) ? maxPlies : 1);
  if (Array.isArray(continuation)) {
    for (const [index, uci] of continuation.entries()) {
      if (plies >= limit) break;
      /* The side to move may be in CHECK, which forces their reply: it is the
         continuation of a tactical sequence whether or not it captures anything.
         Read BEFORE the move, since "is this side in check" is a property of the
         position being escaped, not of the reply itself. */
      const replyIsForced = g.isCheck();
      let mv;
      try {
        mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
      } catch { break; }
      if (!mv) break;
      const isCapture = Boolean(mv.captured) || (mv.flags && mv.flags.includes('e'));
      /* After the move: did it give check? `g.inCheck()` asks about the side now to
         move, i.e. the opponent — true exactly when this move checks. */
      const givesCheck = g.isCheck();
      /* Walk on for a capture, for a check, or for a reply we had no choice about.
         Anything else is a quiet move the sequence has no reason to follow, so stop
         rather than counting unrelated pawn grabs as compensation. */
      if (!isCapture && !givesCheck && !replyIsForced) {
        // At most two quiet PV threat/defence plies may bridge an active king
        // attack. Demand a capture/check in the next two plies, not later mate.
        let connectedThreat = false;
        if (offeredTaken && checksInContinuation > 0 && quietBridges < 2) {
          const probe = new Chess(g.fen());
          try {
            for (const next of continuation.slice(index + 1, Math.min(index + 3, limit))) {
              const reply = probe.move({ from: next.slice(0, 2), to: next.slice(2, 4), promotion: next[4] });
              if (probe.isCheck() || (reply.captured && (reply.to === mv.to || probe.isAttacked(reply.to, mover)))) {
                connectedThreat = true;
                break;
              }
            }
          } catch { /* illegal PV cannot justify a bridge */ }
        }
        if (!connectedThreat) { g.undo(); break; }
        quietBridges++;
      }
      if (ourTurn && givesCheck) checksInContinuation++;
      if (givesCheck || replyIsForced || isCapture) forcingMoves.push(mv.san);
      matingContinuation = g.isCheckmate() && ourTurn;
      forcing = forcing || isCapture || givesCheck || replyIsForced;
      sequence.push(mv.san);
      if (isCapture) {
        const val = VAL[mv.captured] || VAL.p;
        if (ourTurn) {
          netDown -= val;                                   // the mover captured → gain
          recovered += val;
        } else {
          netDown += val;                                   // the opponent captured OUR piece
          given += val;
          if (mv.to === offeredTo && mv.captured === offeredType) offeredTaken = true;
        }
      }
      if (ourTurn) moverPressPlies++;                       // mover follow-up (capture/check/forced)
      plies++;
      ourTurn = !ourTurn;
    }
  }
  const evaluation = normalizeScore(engineEvaluation);
  const winningMate = evaluation?.type === 'mate' && evaluation.winner === (mover === 'w' ? 1 : -1);
  // An observed game/PV mate alone does not prove that other defences lose.
  const forcedMate = Boolean(winningMate && offeredTaken && checksInContinuation > 0
    && (matingContinuation || 2 * Math.abs(evaluation.value) <= limit + 1));
  /* The settlement CONTRACT is the three fields every caller branches on, in
     this order: { netDown, offeredTaken, pressed }. The rest of the analysis —
     what was given and recovered, the walk, the mate flags — stays attached as
     ordinary properties, but NON-ENUMERABLE: JSON.stringify, object spread and
     deepEqual then see exactly the three contract fields, while the review
     pipeline, the side lines and the debug helpers keep reading the diagnostics. */
  const pressed = moverPressPlies >= 1;
  const settled = { netDown, offeredTaken, pressed };
  const diagnostics = {
    given, recovered, sequence, forcing, checksInContinuation, forcingMoves,
    materialWinning: offeredTaken && recovered > given,
    matingContinuation, forcedMate,
    mateDistance: forcedMate ? Math.abs(evaluation.value) : null,
  };
  for (const [key, value] of Object.entries(diagnostics)) {
    Object.defineProperty(settled, key, { value, enumerable: false, writable: true, configurable: true });
  }
  Object.defineProperty(settled, 'connectedTacticalSacrifice', {
    value: isConnectedTacticalSacrifice(settled), enumerable: false, writable: true, configurable: true,
  });
  return settled;
}

/* ---------------------------------------------------------------
 * Development-only view of one candidate move (spec 20).
 *
 * Answers "why is / isn't this Brilliant?" without a log statement on the
 * production path: nothing in reviewGame calls it. It assembles the debug object
 * from the SAME helpers the verdict uses — settlement, geometry gates, and the
 * gate table — so it can never drift from the real decision.
 *
 * @param {object}  o
 * @param {string}  o.san            the move as printed
 * @param {object}  o.mv             chess.js verbose move for the candidate
 * @param {number}  o.cpl            mover-perspective centipawn loss
 * @param {number}  o.bestM          mover-perspective eval before the move
 * @param {number}  o.playedM        mover-perspective eval after the move
 * @param {object}  o.settled        result of settledNetSacrifice for this move
 * @param {Array}   o.tops           MultiPV lines from fenBefore
 * @param {string}  o.fenBefore      position the move was played from
 * @param {object}  o.prevMv         previous move, for recapture detection
 * @param {'w'|'b'} o.mover
 * @param {string}  o.verdict        the verdict classifyMove returned
 * @returns {object} debug object
 * --------------------------------------------------------------- */
export function describeSacrifice({ san, mv, cpl, bestM, playedM, settled, tops, fenBefore, prevMv, mover, verdict }) {
  const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
  /* Same two-path decision as the production pipeline: the loose geometry, or
     a protected-shape offer (path C) promoted ONLY by pre-existing settlement
     evidence (path D). The `settled` here is whichever continuation the caller
     settled — the declined-line settlement for loose offers, the accept-line
     settlement for protected ones — so diagnostics can never drift from the
     pipeline's final decision. */
  const looseDetected = sacrificeCandidate(fenBefore, mv, prevMv);
  let protectedShape = false;
  try { protectedShape = !looseDetected && protectedSacrificeGeometry(fenBefore, mv, prevMv); } catch { protectedShape = false; }
  const sacrificeDetected = looseDetected
    || (protectedShape && protectedSacrificeValidated(settled));
  const gates = brilliantGates({
    sacrifice: sacrificeDetected,
    hasNetSacrifice: settled ? (!settled.offeredTaken || settled.pressed) : true,
    sacrificeAttributed: sacrificeAttribution(fenBefore, mv),
    betterNonSacLine: sacrificeDetected && playedM != null
      ? betterNonSacrificialLine(fenBefore, prevMv, tops, mover, playedM)
      : false,
    attackingSac: attackingSacrifice(fenBefore, mv),
    connectedTacticalSacrifice: settled?.connectedTacticalSacrifice === true,
    forcedMate: settled?.forcedMate === true,
    forcedSac: Boolean(mv && (VAL[mv.promotion ?? mv.piece] || 0) >= VAL.r),
    sacMovedCp: mv ? VAL[mv.promotion ?? mv.piece] : null,
    cpl, bestM, playedM,
    isForced: false,
  });

  const seq = settled ? settled.sequence : [];
  return {
    move: san,
    cpl,
    evalBefore: bestM,
    evalAfter: playedM,
    sacrificeDetected,
    protectedShape,
    sacrificedPiece: mv ? (NAMES[mv.promotion ?? mv.piece] || mv.piece) : null,
    sacrificedValue: mv ? VAL[mv.promotion ?? mv.piece] : null,
    immediateResponse: seq[0] || null,
    continuation: seq,
    materialGiven: settled ? settled.given : null,
    materialRecovered: settled ? settled.recovered : null,
    netSacrifice: settled ? settled.netDown : null,
    hasNetSacrifice: settled ? (!settled.offeredTaken || settled.pressed) : true,
    offerTaken: settled ? settled.offeredTaken : null,
    sacrificeCausedByMove: gates.causedByMove,
    tacticalContinuation: Boolean(settled && settled.forcing),
    forcedSequence: Boolean(settled && settled.pressed),
    forcingMoves: settled?.forcingMoves || [],
    checksInContinuation: settled?.checksInContinuation || 0,
    connectedTacticalSacrifice: settled?.connectedTacticalSacrifice === true,
    forcedMate: settled?.forcedMate === true,
    mateDistance: settled?.mateDistance ?? null,
    evaluationWindowPassed: gates.evaluationContext,
    gates,
    finalVerdict: verdict,
  };
}