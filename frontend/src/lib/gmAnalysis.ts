/* Automatic engine analysis for the GM game replay.
 *
 * A GM game is only different in its SOURCE, never in how its moves are
 * classified. The replay therefore runs the SAME canonical pipeline as Game
 * Review and Chess Profile — reviewGame() with the canonical engine config
 * (see utils/canonicalAnalysis.ts) — and consumes the SAME canonical rows.
 * There is no GM-specific classifier here: no local brilliant/sigma,
 * sacrifice, CPL/WPD, accuracy, mate or score logic. A GM game that contains
 * 25...Bxg3 classifies exactly the way the Review page classifies it.
 *
 * What this module DOES own is display adaptation only: narrowing a canonical
 * row to the fields the replay screen reads (white-perspective numbers for
 * the eval curve/bar, the engine's best move for the hint arrow), plus the
 * move-by-move commentary text. Classification inputs are never recomputed.
 */

import { analyzeCanonical, getCanonicalAnalysis } from '../utils/canonicalAnalysis';
import { reviewMetaFor } from '../utils/gameReview';
import { searchTopMoves } from '../utils/nnueEngine';
import { LIVE_ANALYSIS_DEPTH, LIVE_ANALYSIS_MULTIPV } from '../utils/reviewConfig';

/* One replay entry: the canonical review row, plus display-only derivations.
 * `evalAfter`/`mateAfter` are white-perspective numbers (mate collapsed into
 * comparable centipawns for the curve, distance kept separately for labels),
 * because the graph, the eval bar and formatEval all read White's point of
 * view. Every classification field (verdict, sigma, cpl, wpd, acc, scores,
 * forced, sacrifice, lines, …) is the canonical row untouched. */
export type GmPlyAnalysis = {
  ply: number;
  player: 'w' | 'b';
  san: string;
  uci: string;
  verdict: string;
  sigma: { type: string; label: string; piece: string | null; rank: number; fromSquare: string; toSquare: string } | null;
  forced: boolean;
  bestSan: string | null;
  sacrifice: boolean;
  sacrificeProtected: boolean;
  cpl: number;
  loss: number | null;
  swing: number | null;
  wpd: number | null;
  acc: number | null;
  best: number | null;
  played: number | null;
  bestUci: string | null;
  depth: number;
  lines: { uci: string; from: string | null; to: string | null; score: number | null; evaluation: unknown; mate: number | null }[];
  unanalysed?: boolean;
  /** Engine's preferred move in the position BEFORE this move. */
  bestFrom: string | null;
  bestTo: string | null;
  /** True when the move played was the engine's own first choice. */
  wasBest: boolean;
  /** Evaluation of the position AFTER this move, white-perspective cp. */
  evalAfter: number | null;
  /** White-perspective mate distance after this move, when mating. */
  mateAfter: number | null;
};

export type AnalysisProgress = { done: number; total: number; ply: number };

export type AnalyseOptions = {
  onProgress?: (p: AnalysisProgress) => void;
  /** Return true to abandon the run (used to cancel on unmount / game change). */
  shouldAbort?: () => boolean;
  /** Node-test hook, forwarded to reviewGame. Browser callers omit it. */
  engine?: unknown;
  /** Canonical game identity ({ gameSource, gameId }). When present the run
   *  goes through getCanonicalAnalysis, so a GM game analysed before is reused
   *  instead of re-searched, and concurrent requests collapse into one run. */
  gameRef?: { gameSource: string; gameId: string | number } | null;
  /** Optional persistent store for this game's analysis. */
  loadAnalysis?: ((gameId: string | number) => Promise<unknown>) | null;
  saveAnalysis?: ((gameId: string | number, entry: unknown) => Promise<unknown>) | null;
};

const MATE_CP = 100000;

/** Format a white-perspective score for display: "+1.4", "-0.3", "M4", "-M2". */
export function formatEval(score: number | null | undefined, mate: number | null | undefined): string {
  if (mate != null && Number.isFinite(mate)) return `${mate > 0 ? 'M' : '-M'}${Math.abs(mate)}`;
  if (score == null || !Number.isFinite(score)) return '—';
  /* Anything past a real mate distance is a mate in disguise; showing "M0" or
     "+99.9" for a forced mate reads as an engine glitch. */
  if (Math.abs(score) >= MATE_CP - 1000) return score > 0 ? 'M0' : '-M0';
  const pawns = score / 100;
  return `${pawns > 0 ? '+' : pawns < 0 ? '−' : ''}${Math.abs(pawns).toFixed(1)}`;
}

/* ── Canonical GM analysis ──────────────────────────────────────────────
 * The whole game through reviewGame with the canonical config, mapped to
 * replay entries. `sans` are the game's SAN moves in order, `initialFen`
 * its real starting position ('start' for a standard game). Progress and
 * cancellation forward to the caller's controls; a cancelled run resolves []
 * so the replay simply shows no verdicts yet. */
export async function analyzeGmGame(
  initialFen: string,
  sans: string[],
  options: AnalyseOptions = {}
): Promise<GmPlyAnalysis[]> {
  const { onProgress, shouldAbort, engine, gameRef = null, loadAnalysis = null, saveAnalysis = null } = options;
  if (!sans.length) return [];
  const res = await getCanonicalAnalysis(
    { ...(gameRef || {}), initialFen, moves: sans },
    {
      analyze: analyzeCanonical,
      loadAnalysis,
      saveAnalysis,
      onProgress: onProgress
        ? (done: number, total: number) => onProgress({ done, total, ply: done })
        : undefined,
      isCancelled: shouldAbort,
      engine,
    },
  );
  if (!res || !Array.isArray(res.moves)) return [];
  return res.moves.map((row) => {
    const played = row.played ?? null;
    const playedMate = row.playedMate ?? null;
    const negate = row.player === 'b';
    return {
      ...row,
      bestFrom: row.bestUci ? row.bestUci.slice(0, 2) : null,
      bestTo: row.bestUci ? row.bestUci.slice(2, 4) : null,
      wasBest: row.uci != null && row.bestUci != null && row.uci === row.bestUci,
      evalAfter: played == null ? null : negate ? -played : played,
      mateAfter: playedMate == null ? null : negate ? -playedMate : playedMate,
    };
  });
}

/* ── Move-by-move engine commentary ──────────────────────────────────────
 * The replay card explains each move with the engine's own verdict for the
 * position that was actually on the board: the canonical verdict label, what
 * the engine wanted instead, and where the evaluation ended up. Every branch
 * is driven by fields the canonical pipeline produced, so a position the
 * engine failed to score degrades to a plain statement instead of inventing
 * a number. */

/** A centipawn loss as a plain magnitude: "1.65", "0.40", "0.08".
 *
 *  Deliberately unsigned: this is how much a move GAVE AWAY, so a "+" here
 *  would read as a gain. `loss` can even be negative when a move improved on
 *  the engine's own pick, hence the abs(). */
function lossText(loss: number | null | undefined): string {
  if (loss == null || !Number.isFinite(loss)) return '—';
  return (Math.abs(loss) / 100).toFixed(2);
}

/** Canonical display label for a verdict key ('sigma' reads as Brilliant). */
export function verdictLabel(verdict: string | null | undefined): string {
  if (!verdict) return 'Good';
  try {
    return reviewMetaFor(verdict)?.label ?? verdict;
  } catch {
    return verdict;
  }
}

/** The engine's read-out for one move, as one or two sentences.
 *
 *  `a` is the entry for the move that was played; `color` only affects wording.
 *  `endedInMate` covers the one position the engine cannot score: after
 *  checkmate there are no legal moves, so the mating move arrives with no
 *  score of its own. The caller knows the result from the FEN and passes it in.
 */
export function describeAnalysis(
  a: GmPlyAnalysis | null | undefined,
  color: 'w' | 'b' = 'w',
  { endedInMate = false }: { endedInMate?: boolean } = {},
): string {
  if (!a) return 'The engine is still reading this position.';
  const side = color === 'w' ? 'White' : 'Black';
  const evalText = formatEval(a.evalAfter, a.mateAfter);
  const label = verdictLabel(a.verdict);

  /* The move decided the game, so the position after it has no legal reply. */
  if (endedInMate || (a.mateAfter != null && Math.abs(a.mateAfter) === 1)) {
    return `${side} mates. Checkmate — the game ends here, and the engine had no defence to find.`;
  }

  /* No score means the engine could not evaluate the move at all. */
  if (a.unanalysed || a.evalAfter == null) {
    return a.evalAfter == null && a.mateAfter == null
      ? `${side} plays on. The engine had no score for this position.`
      : `${side} plays on, and the engine puts the position at ${evalText}.`;
  }

  /* The protected-tactical-sacrifice path (and every other sacrifice) lands
     here with verdict 'sigma': material is genuinely given up and the play
     stays forcing, which is exactly what the badge says. */
  if (a.verdict === 'sigma') {
    return `Brilliant from ${side} — a genuine sacrifice, and the attack stays forcing all the way through. The evaluation settles at ${evalText}.`;
  }

  if (a.wasBest) {
    return a.loss != null && a.loss > 0
      ? `The engine's own first choice — ${side} plays the move it wanted, and the evaluation settles at ${evalText}.`
      : `The engine's first choice. Nothing is given away, and the position stays at ${evalText}.`;
  }

  /* Not the engine's pick, yet graded best: the played move improved on the
     engine's own line, so quoting a cost would be backwards. */
  if (a.verdict === 'best') {
    return a.bestSan
      ? `${side} goes beyond the engine's first choice (${a.bestSan}) and still holds the position at ${evalText}.`
      : `${side} holds the position at ${evalText}, and the engine has nothing to criticise.`;
  }

  const wanted = a.bestSan ? `the engine preferred ${a.bestSan}` : 'the engine had a different move in mind';
  switch (a.verdict) {
    case 'great':
      return `${side} finds a great move — ${wanted}, and the difference is only ${lossText(a.loss)} pawns. The position sits at ${evalText}.`;
    case 'excellent':
      return `${side} stays near the top of the list — ${wanted}, and the difference is only ${lossText(a.loss)} pawns. The position sits at ${evalText}.`;
    case 'good':
      return `${side} holds the position — ${wanted}, and the difference is only ${lossText(a.loss)} pawns. ${evalText} afterwards.`;
    case 'book':
      return `${side} follows known theory here, so the engine has nothing to criticise. The position sits at ${evalText}.`;
    case 'miss':
      return `${side} lets a forced win slip — ${wanted}, and the chance is gone. ${evalText} afterwards.`;
    case 'inaccuracy':
      return `${side} slips: ${wanted}, giving up ${lossText(a.loss)} pawns. The position drifts to ${evalText}.`;
    case 'mistake':
      return `A real error from ${side} — ${wanted}, and ${lossText(a.loss)} pawns go on the board. ${evalText} afterwards.`;
    case 'blunder':
      return `A blunder from ${side}: ${wanted}, and it costs ${lossText(a.loss)} pawns. The engine sees the position collapsing to ${evalText}.`;
    /* Unreachable: every verdict is handled above. Kept so an unhandled value
       degrades to a plain statement rather than a wrong verdict. */
    default:
      return `${side} plays ${label} — ${wanted}. The position sits at ${evalText}.`;
  }
}

/* ── On-demand PV enrichment for the explanation card ──────────────────
 * Canonical rows keep each candidate's uci + eval but DROP the principal
 * variation (buildLines in reviewClassify never stores it). The explainer
 * only quotes a PV when one is verified for this exact position, so the
 * card asks here — a single-position MultiPV search through the SAME NNUE
 * pool the canonical run used (utils/nnueEngine.js), at the live-analysis
 * config. Results cache by the FEN of the position BEFORE the move, and
 * concurrent requests for the same FEN share one search. A failure caches
 * as unavailable (null): hammering a broken engine on every ply would
 * just spin the card forever, so the card degrades to the canonical lines
 * instead of retrying. */

export type PositionLine = {
  uci: string;
  from: string | null;
  to: string | null;
  promotion: string | null;
  /** White-perspective centipawns for the position after this move. */
  score: number | null;
  mate: number | null;
  depth: number;
  /** Principal variation as UCI moves, in order, starting with this line's move. */
  pv: string[];
};

const lineCache = new Map<string, PositionLine[] | null>();
const lineInFlight = new Map<string, Promise<PositionLine[] | null>>();
const LINE_CACHE_MAX = 96;

/** Whatever is already known for a FEN: cached lines, cached-null, or
 *  undefined when nothing was ever asked about this position. */
export function cachedPositionLines(
  fen: string | null | undefined,
): PositionLine[] | null | undefined {
  const key = String(fen || '').trim();
  if (!key) return undefined;
  return lineCache.get(key);
}

export function lookupPositionLines(
  fen: string | null | undefined,
): Promise<PositionLine[] | null> {
  const key = String(fen || '').trim();
  /* The engine must never be handed the 'start' sentinel — only real FENs. */
  if (!key || key === 'start') return Promise.resolve(null);
  const cached = lineCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = lineInFlight.get(key);
  if (running) return running as Promise<PositionLine[] | null>;
  const run: Promise<PositionLine[] | null> = (async () => {
    let result: PositionLine[] | null = null;
    try {
      const tops = await searchTopMoves(key, {
        maxDepth: LIVE_ANALYSIS_DEPTH,
        multiPv: LIVE_ANALYSIS_MULTIPV,
      });
      if (Array.isArray(tops) && tops.length) {
        result = tops
          .slice(0, Math.max(1, LIVE_ANALYSIS_MULTIPV))
          .map((t: Record<string, unknown>) => ({
            uci: String(t.uci || ''),
            from: (t.from as string) ?? null,
            to: (t.to as string) ?? null,
            promotion: (t.promotion as string) ?? null,
            score: (t.score as number) ?? null,
            mate: (t.mate as number) ?? null,
            depth: (t.depth as number) || 0,
            pv: Array.isArray(t.pv) ? (t.pv as unknown[]).filter((x) => typeof x === 'string') as string[] : [],
          }))
          .filter((line) => line.uci.length >= 4);
      }
    } catch {
      result = null;
    }
    lineCache.set(key, result);
    while (lineCache.size > LINE_CACHE_MAX) {
      const oldest = lineCache.keys().next().value;
      if (oldest === undefined) break;
      lineCache.delete(oldest);
    }
    return result;
  })();
  lineInFlight.set(key, run);
  const settle = () => { lineInFlight.delete(key); };
  run.then(settle, settle);
  return run;
}
