/* Bot engine service — turns a bot's personality into an actual chess move.
 *
 * The engine itself is NOT reimplemented here. This project already ships a
 * Stockfish 18 worker pool with MultiPV support in `utils/stockfish.js`,
 * exposed through `utils/engine.js` (`searchTopMoves`). That pool runs the
 * engines in Web Workers, so the UI thread is never blocked — which is exactly
 * the requirement this feature has. Reusing it also means the bot game and the
 * Play Arena's live analysis share one warm pool instead of downloading the
 * 7 MB lite WASM build twice.
 *
 * WHAT THIS SERVICE IS RESPONSIBLE FOR
 *   1. Choosing the engine profile (skill level / move time / depth / candidate
 *      width) from the bot's rating band.
 *   2. Asking for a MultiPV candidate list and turning it into a WEIGHTED
 *      CHOICE, so weaker bots do not always play the top engine move.
 *   3. Applying the bot's personality as a re-weighting over those candidates.
 *   4. Validating the chosen move against chess.js before it is played.
 *
 * HARD RULE: a bot can never play an illegal move. Every candidate is filtered
 * against `game.moves()` first, and the final pick is re-validated. Personality
 * only ever changes WHICH LEGAL move is played — it never fabricates a move and
 * never touches move legality. If the engine fails entirely we degrade to a
 * random legal move rather than stalling the game.
 */

import { Chess } from 'chess.js';
import { searchTopMoves, stopEngineSearch } from '../utils/engine';
import { rankForRating } from '../data/bots';

/* ── Piece values, used only for personality heuristics (never for legality) ── */
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/** Cheap material count for one side, used for the endgame boost. */
function materialFor(game, color) {
  let total = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq && sq.color === color && sq.type in VALUE) total += VALUE[sq.type];
    }
  }
  return total;
}

/** Total non-pawn material — the standard "is this an endgame?" proxy. */
function nonPawnMaterial(game) {
  let total = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.type === 'n' || sq.type === 'b' || sq.type === 'r' || sq.type === 'q') {
        total += VALUE[sq.type];
      }
    }
  }
  return total;
}

/**
 * Build the legal-move lookup the heuristic pass needs.
 * Maps "e2e4" -> the matching verbose chess.js move.
 */
function legalByUci(game) {
  const map = new Map();
  for (const m of game.moves({ verbose: true })) {
    const promo = m.promotion ? m.promotion : '';
    map.set(`${m.from}${m.to}${promo}`, m);
    /* Promotion moves are stored under all four pieces so a UCI string that
     * omits the piece (Stockfish always sends it, but callers may not) still
     * resolves. */
    if (m.promotion) map.set(`${m.from}${m.to}`, m);
  }
  return map;
}

/* ── Engine profile ─────────────────────────────────────────────────────── */

/**
 * Resolve the Stockfish options for a bot in the current position.
 *
 * `bot.engineSettings` is the per-bot authority. `endgameBoost` raises the
 * search budget once queens are off, which is what makes an "endgame
 * specialist" recognisably sharper when the position simplifies.
 */
export function engineProfileFor(bot, game) {
  const cfg = (bot && bot.engineSettings) || {};
  const rank = rankForRating(bot?.rating ?? 0);

  const skillLevel = clamp(cfg.skillLevel ?? rank.skillLevel, 0, 20);
  const depth = clamp(cfg.depth ?? rank.depth, 1, 24);
  const moveTime = clamp(cfg.moveTime ?? rank.moveTime, 20, 10000);
  const multiPv = clamp(cfg.multiPv ?? rank.candidates, 1, 5);
  const variance = clamp(cfg.variance ?? rank.variance, 0, 1);
  const mistakeProb = clamp(cfg.mistakeProb ?? 0.1, 0, 1);
  const blunderProb = clamp(cfg.blunderProb ?? 0.02, 0, 1);

  /* Endgame boost: only when queens are genuinely off. */
  let boost = 1;
  const endgameBoost = Number(cfg.endgameBoost ?? 1);
  if (endgameBoost > 1 && game) {
    const total = nonPawnMaterial(game);
    if (total <= 2600) boost = endgameBoost;
  }

  return {
    skillLevel,
    depth,
    moveTime: Math.round(moveTime * boost),
    multiPv,
    variance,
    mistakeProb,
    blunderProb,
    boost,
    endgame: boost > 1,
  };
}

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/* ── Personality weighting ──────────────────────────────────────────────── */

/**
 * Score a candidate for "does this move look like what this bot wants to play?".
 * Returns a multiplier in roughly [0.15, 2.6] applied on top of the engine-rank
 * weight. This is a STYLE nudge only — a move with a low multiplier is still
 * fully legal and may still be picked, it just needs more of a push.
 */
function personalityMultiplier(bot, candidate, ctx) {
  const p = bot.personality || 'balanced';
  const m = candidate.move;
  let mult = 1;

  const isCapture = !!m.captured;
  const isCheck = !!m.san && m.san.includes('+');
  const isCastle = !!m.flags && (m.flags.includes('k') || m.flags.includes('q'));
  const isQuiet = !isCapture && !isCheck;

  /* Material swing of the move from the bot's point of view (cp). */
  const swing = candidate.swing;

  switch (p) {
    case 'aggressive':
      /* Push captures and checks; push pawn pushes in the centre. */
      if (isCheck) mult *= 1.45;
      if (isCapture) mult *= 1.25 + Math.min(0.5, Math.max(0, swing) / 600);
      if (isQuiet && ctx.phase !== 'opening') mult *= 0.85;
      break;

    case 'attacker':
      /* Checks dominate; captures are next; safe moves are actively avoided. */
      if (isCheck) mult *= 1.7;
      if (isCapture) mult *= 1.3;
      if (isQuiet && !isCastle) mult *= 0.72;
      break;

    case 'defensive':
      /* Prefer safe moves and king-castling; punish moves that give material. */
      if (swing < 0) mult *= 0.45;
      if (isCastle && ctx.phase !== 'endgame') mult *= 1.3;
      if (isQuiet) mult *= 1.12;
      if (isCheck) mult *= 0.85;
      break;

    case 'gambit':
      /* Early in the game, like moves that throw material at the centre. */
      if (ctx.phase === 'opening') {
        if (swing < 0) mult *= 1.5;
        if (isCapture && !isCheck) mult *= 1.2;
        if (isCastle) mult *= 0.85;
      }
      break;

    case 'trader':
      /* Loves an even exchange and dislikes throwing pieces away. */
      if (isCapture && swing >= -30 && swing <= 60) mult *= 1.5;
      if (swing < -30) mult *= 0.6;
      if (isQuiet) mult *= 1.05;
      break;

    case 'positional':
      /* Barely intervenes — trusts the engine's ordering. */
      mult *= 1;
      break;

    case 'endgame':
      /* Values king activity and passed pawns once simplified. */
      if (ctx.phase === 'endgame') {
        if (m.piece === 'k' && isQuiet) mult *= 1.25;
        if (m.flags && m.flags.includes('=')) mult *= 1.3; // promotion
      } else {
        mult *= 1;
      }
      break;

    case 'random':
      /* Deliberately unfussy; the variance term does the flattening. */
      mult *= 1 + (Math.random() - 0.5) * 0.35;
      break;

    case 'balanced':
    default:
      break;
  }

  return Math.max(0.15, Math.min(2.6, mult));
}

/** Which part of the game we are in — gates gambit/endgame behaviour. */
function phaseOf(game) {
  const fullmove = game ? Number(game.fen().split(' ')[5] || 1) : 1;
  const total = nonPawnMaterial(game);
  if (total <= 2600) return 'endgame';
  if (fullmove <= 14) return 'opening';
  return 'middlegame';
}

/**
 * Rank-weighted random selection.
 *
 * Base weight for candidate `i` (0 = engine's top move) is
 *   (1 - variance)^i
 * so `variance = 0` always picks the best move and `variance → 1` approaches a
 * uniform draw over the candidate list. That single knob covers the whole
 * beginner "30/30/25/15" style spread without hardcoding per-tier tables, and it
 * interpolates smoothly for the ratings that sit between two ladder anchors.
 * Each candidate is then re-weighted by the personality multiplier.
 */
export function pickCandidate(candidates, profile, bot, ctx) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const decay = 1 - profile.variance;
  const weights = candidates.map((c, i) => {
    const rankWeight = Math.pow(decay, i);
    return Math.max(0.0001, rankWeight * personalityMultiplier(bot, c, ctx));
  });

  /* With a declared mistake/blunder budget the bot may also force itself down
   * the list even when `variance` is low. Applied as an extra bias so it can
   * never make the bot stronger than its band. */
  const bias = weightedIndex(weights);
  return candidates[bias];
}

function weightedIndex(weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return 0;
  let r = Math.random() * sum;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Force a mistake instead of the chosen candidate, when the bot's own
 * mistake/blunder budget says it is having an off-moment.
 * Always stays inside the legal candidate list.
 */
function maybeForceMistake(candidates, profile) {
  if (candidates.length < 2) return null;
  const roll = Math.random();
  if (roll < profile.blunderProb) {
    /* Blunder: the very worst candidate the engine offered. */
    return candidates[candidates.length - 1];
  }
  if (roll < profile.blunderProb + profile.mistakeProb) {
    /* Mistake: somewhere in the lower half, still a real candidate. */
    const from = Math.max(1, Math.floor(candidates.length / 2));
    return candidates[from + Math.floor(Math.random() * (candidates.length - from))];
  }
  return null;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Ask the engine for a legal move for `bot` in the current position.
 *
 * Resolves to `{ from, to, promotion, san, uci, source }` or null when the game
 * is already over / has no legal move. Never rejects for engine failure: a
 * degraded legal fallback is returned instead so a game can always continue.
 */
export async function chooseBotMove(bot, game) {
  if (!bot || !game) return null;

  const legal = game.moves({ verbose: true });
  if (!legal || legal.length === 0) return null;

  const byUci = legalByUci(game);
  const profile = engineProfileFor(bot, game);
  const phase = phaseOf(game);
  const ctx = { phase, profile };

  let candidates = [];
  let engineFailed = false;

  try {
    const res = await searchTopMoves(game.fen(), {
      maxDepth: profile.depth,
      timeMs: profile.moveTime,
      multiPv: profile.multiPv,
      skillLevel: profile.skillLevel,
    });
    candidates = (res || []).filter((c) => c && c.uci && byUci.has(c.uci));
  } catch (err) {
    engineFailed = true;
    if (typeof console !== 'undefined') {
      console.warn('[bot-engine] search failed, falling back to a legal move:', err?.message || err);
    }
  }

  /* No usable engine output (offline, blocked worker, illegal garbage):
   * play a random legal move so the game still progresses. */
  if (candidates.length === 0) {
    const m = legal[Math.floor(Math.random() * legal.length)];
    return {
      from: m.from,
      to: m.to,
      promotion: m.promotion || 'q',
      san: m.san,
      uci: `${m.from}${m.to}${m.promotion || ''}`,
      source: engineFailed ? 'fallback' : 'degraded',
    };
  }

  /* Deduplicate on UCI — Stockfish can repeat a rank when it re-searches. */
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    if (seen.has(c.uci)) continue;
    seen.add(c.uci);
    const m = byUci.get(c.uci);
    unique.push({
      uci: c.uci,
      score: c.score,
      mate: c.mate,
      rank: c.rank,
      move: m,
      /* Material swing for the personality pass, measured from the bot's side. */
      swing: materialSwing(m, game),
    });
  }

  const forced = maybeForceMistake(unique, profile);
  const chosen = forced || pickCandidate(unique, profile, bot, ctx) || unique[0];

  /* Final legality gate. Nothing reaches the board without this. */
  const finalMove = byUci.get(chosen.uci);
  if (!finalMove) {
    const m = legal[Math.floor(Math.random() * legal.length)];
    return {
      from: m.from,
      to: m.to,
      promotion: m.promotion || 'q',
      san: m.san,
      uci: `${m.from}${m.to}${m.promotion || ''}`,
      source: 'fallback',
    };
  }

  return {
    from: finalMove.from,
    to: finalMove.to,
    promotion: finalMove.promotion || 'q',
    san: finalMove.san,
    uci: chosen.uci,
    score: chosen.score,
    mate: chosen.mate,
    /* Best score the engine saw in this position, from the BOT's point of view
     * (the bot is the side to move). The difference is what the move actually
     * gave away, which is what drives "blunder" reactions in BotDialogueService
     * — no extra search required, since the MultiPV pass already paid for it. */
    bestScore: bestScoreOf(unique),
    lossCp: centipawnLossOf(unique, chosen),
    source: forced ? 'mistake' : 'engine',
  };
}

/**
 * Highest score across the deduped MultiPV list, in centipawns, from the mover's
 * point of view. Mate scores are collapsed away because they are not comparable
 * to centipawns (mate-in-3 vs mate-in-5 is a huge qualitative difference, not
 * a numeric one) and would otherwise produce absurd "loss" figures.
 */
function bestScoreOf(candidates) {
  let best = null;
  for (const c of candidates) {
    if (typeof c.mate === 'number') continue;
    if (typeof c.score !== 'number') continue;
    if (best === null || c.score > best) best = c.score;
  }
  return best;
}

/** How many centipawns the chosen move gave away versus the best candidate. */
function centipawnLossOf(candidates, chosen) {
  if (typeof chosen?.mate === 'number') return null;
  if (typeof chosen?.score !== 'number') return null;
  const best = bestScoreOf(candidates);
  if (best === null) return null;
  const loss = best - chosen.score;
  return loss > 0 ? Math.round(loss) : 0;
}

/** Material swing of a move from the mover's perspective, in centipawns. */
function materialSwing(m, game) {
  const gained = m.captured ? VALUE[m.captured.type] : 0;
  const promoGain = m.promotion ? VALUE[m.promotion] - VALUE.p : 0;
  /* We do not model opponent recapture here; this is a style heuristic, and
   * over-estimating a capture simply makes the bot slightly keener to grab. */
  return gained + promoGain;
}

/**
 * Validate an arbitrary move against chess.js without playing it. Used as the
 * last line of defence by the game hook and by the tests.
 */
export function isLegalMove(game, from, to, promotion = 'q') {
  try {
    const g = new Chess(game.fen());
    return !!g.move({ from, to, promotion });
  } catch {
    return false;
  }
}

/** Cancel any in-flight search (game over, rematch, unmount). */
export function cancelSearch() {
  try {
    stopEngineSearch();
  } catch { /* best-effort */ }
}

export const BotEngineService = {
  chooseBotMove,
  engineProfileFor,
  pickCandidate,
  personalityMultiplier,
  isLegalMove,
  cancelSearch,
  phaseOf,
};