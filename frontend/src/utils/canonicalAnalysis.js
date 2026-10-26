/* Canonical game-analysis entry point.
 *
 * ONE engine-analysis pipeline, ONE metrics implementation, ONE classification
 * implementation, MULTIPLE consumers:
 *
 *   Game Review    → reviewRunner.startReview → reviewGame (defaults)
 *   Chess Profile  → analyzeCanonical (below)
 *   GM Game        → analyzeGmGame (lib/gmAnalysis.ts) → analyzeCanonical
 *
 * `reviewGame()` (utils/gameReview.js) is the canonical source of truth for
 * move classification. Every surface calls it with the SAME engine
 * configuration (CANONICAL_ENGINE_OVERRIDES) and the SAME initial-FEN
 * precedence (resolveInitialFen), so the same game + same config produces the
 * same verdicts, CPL, WPD, accuracy, Sigma status and engine lines everywhere.
 * No surface may pass its own depth/multiPv overrides for move-review
 * classification, and no surface may reimplement brilliant/sigma/sacrifice
 * detection, CPL/WPD bands, accuracy, mate handling or score normalization.
 */

import { Chess } from 'chess.js';
import { reviewGame } from './gameReview.js';
import {
  REVIEW_DEPTH,
  REVIEW_MULTIPV,
  REVIEW_ENGINE_VERSION,
  REVIEW_LOGIC_VERSION,
} from './reviewConfig.js';

/* The engine configuration every analysis surface must use. These are
 * reviewGame's own defaults, passed explicitly so a signature-default change
 * can never silently split the surfaces apart. */
export const CANONICAL_ENGINE_OVERRIDES = Object.freeze({
  depth: REVIEW_DEPTH,
  multiPv: REVIEW_MULTIPV,
});

/* THE ONE VERSION STAMP. Fingerprints EVERY input that can change a verdict:
 *   - the engine build / NNUE network  (REVIEW_ENGINE_VERSION)
 *   - the search shape                 (depth, multiPv)
 *   - the ANALYSIS LOGIC               (REVIEW_LOGIC_VERSION)
 *
 * REVIEW_LOGIC_VERSION is bumped by hand when classification changes — a new
 * brilliant/sacrifice gate, a CPL or accuracy formula, the protected-sacrifice
 * path, the Sigma conversion. Without it a new classifier would silently keep
 * serving results produced by the old one, which is precisely the "forever
 * trust an old result" failure this stamp exists to prevent. It is a segment of
 * the EXISTING version, not a second version system. */
export const CANONICAL_ANALYSIS_VERSION =
  `${REVIEW_ENGINE_VERSION}+d${REVIEW_DEPTH}m${REVIEW_MULTIPV}r${REVIEW_LOGIC_VERSION}`;

/** Version of the PERSISTED ENVELOPE below (not of the analysis itself).
 *  Bumped when the shape of what we store changes, so old envelopes are read as
 *  a miss instead of being mis-parsed. Deliberately separate from
 *  CANONICAL_ANALYSIS_VERSION: one describes the analysis, this describes the
 *  container. */
export const ANALYSIS_SCHEMA_VERSION = 1;

/* ── canonical analysis identity ────────────────────────────────────────────
 * A game is identified by (gameSource, gameId) — the app's canonical identity,
 * the same pair sigma rows are filed under. NEVER by the sigma record id, a
 * player name, a date, a SAN or a move number, and NEVER by the ply: two
 * brilliant moves in one game are ONE analysis at two different positions. */
export function canonicalAnalysisKey(game) {
  const source = game?.gameSource;
  const id = game?.gameId;
  if (source == null || id == null || String(source) === '' || String(id) === '') return null;
  /* The source is part of the key, so online:42 / chess_profile:42 /
     computer:42 are three different analyses and can never collide. */
  return `${source}:${id}`;
}

/* ── the game's CONTENT, not just its length ─────────────────────────────────
   A re-synced game can have the SAME number of moves and different ones, so a
   move count alone is not enough to say "this is still the same game".

   The stored analysis carries the SAN of every move it graded, so the two move
   lists can be compared directly — no extra column, and the games that are
   already stored stay valid (their SAN lists are exactly the game's).

   FNV-1a over the SAN strings: no crypto, no dependencies, and it only has to
   notice that something CHANGED. */
export function movesFingerprint(moves) {
  if (!Array.isArray(moves)) return null;
  let h = 0x811c9dc5;
  for (const m of moves) {
    const s = typeof m === 'string' ? m : String(m ?? '');
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    /* A separator, so ['ab', 'c'] and ['a', 'bc'] are different games. */
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${moves.length}:${h.toString(16)}`;
}

/** The SAN list of a move array, or null when it is not a SAN list at all. */
function sanList(moves) {
  if (!Array.isArray(moves)) return null;
  for (const m of moves) {
    if (typeof m !== 'string') return null;
  }
  return moves;
}

/* ── one authoritative validity check ───────────────────────────────────────
 * Every "may I reuse this?" question in the app funnels through here. There is
 * no second check anywhere, so a stale rule cannot be applied in one place and
 * forgotten in another.
 *
 * An entry is reusable ONLY when:
 *   - it exists and is well formed,
 *   - its analysis version is the CURRENT one (engine, depth, multiPv, logic),
 *   - its envelope schema version is the CURRENT one,
 *   - it names the same game we are being asked about,
 *   - it was produced from the same starting position and move count — so a
 *     re-synced or edited game can never be handed the old game's verdicts,
 *   - its move list is the SAME move list (not merely the same length),
 *   - its rows actually look like analysis rows. */
export function isValidCanonicalAnalysis(entry, game) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.analysisVersion !== CANONICAL_ANALYSIS_VERSION) return false;
  if (entry.schemaVersion !== ANALYSIS_SCHEMA_VERSION) return false;
  if (game) {
    if (canonicalAnalysisKey(entry) !== canonicalAnalysisKey(game)) return false;
    /* Identity is not enough: the game's CONTENT must match too. */
    const wantFen = String(game.initialFen || 'start');
    if (entry.initialFen && String(entry.initialFen) !== wantFen) return false;
    const wantCount = Array.isArray(game.moves) ? game.moves.length : null;
    if (wantCount != null && entry.moveCount != null && entry.moveCount !== wantCount) return false;
    /* The move LIST itself, not just its length: a game whose moves changed
       must not be served the old game's verdicts. */
    const wantSans = sanList(game.moves);
    const haveSans = sanList(Array.isArray(entry.analysis?.moves) ? entry.analysis.moves.map((r) => r.san) : null);
    if (wantSans && haveSans) {
      if (haveSans.length !== wantSans.length) return false;
      if (movesFingerprint(haveSans) !== movesFingerprint(wantSans)) return false;
    }
  }
  return hasAnalysisShape(entry.analysis);
}

/** Structural check that the payload is a finished canonical review.
 *
 *  IT CHECKS FIELD PRESENCE, NOT NUMERIC VALUE. A canonical row legitimately
 *  carries `null` in several numeric fields:
 *    - `acc`  is null for a book move (moveAccuracy returns null for 'book',
 *            because theory is scored 100 by the aggregator, not per row), and
 *            null whenever there is no win%-drop to score;
 *    - `loss`/`swing`/`wpd`/`best`/`played` are null when the engine produced no
 *      score for the position.
 *  Requiring `typeof acc === 'number'` therefore rejected EVERY game that opens
 *  in book theory — i.e. almost every real game — as "malformed", so it was
 *  never cached and the engine re-ran on every single open. That check has to
 *  distinguish "the field is absent" (corrupt) from "the field is null" (valid).
 */
export function hasAnalysisShape(analysis) {
  if (!analysis || typeof analysis !== 'object') return false;
  if (!Array.isArray(analysis.moves) || analysis.moves.length === 0) return false;
  for (const side of ['white', 'black']) {
    const s = analysis[side];
    if (!s || typeof s !== 'object') return false;
    if (!('accuracy' in s)) return false;
    if (s.accuracy != null && typeof s.accuracy !== 'number') return false;
  }
  /* These identify a row as a classified move. Their absence means the payload
     is not a canonical review at all. */
  const IDENTIFYING = ['san', 'uci', 'verdict', 'player'];
  /* These are the metrics the UI reads. They must EXIST; null is fine. */
  const NUMERIC = ['cpl', 'loss', 'swing', 'wpd', 'acc', 'best', 'played'];
  for (const row of analysis.moves) {
    if (!row || typeof row !== 'object') return false;
    for (const key of IDENTIFYING) {
      if (typeof row[key] !== 'string' || row[key] === '') return false;
    }
    if (row.player !== 'w' && row.player !== 'b') return false;
    for (const key of NUMERIC) {
      if (!(key in row)) return false;
      if (row[key] != null && typeof row[key] !== 'number') return false;
    }
    /* bestUci and the Sigma payload are optional in shape (an unscored row has
       no best line), but must not be malformed when present. */
    if (row.bestUci != null && typeof row.bestUci !== 'string') return false;
    if (row.sigma != null && typeof row.sigma !== 'object') return false;
    if (row.lines != null && !Array.isArray(row.lines)) return false;
  }
  return true;
}

/** Backwards-compatible predicate: is a stored payload from another version?
 *  Delegates to the single authoritative check above. */
export function isStaleAnalysis(payload) {
  return !isValidCanonicalAnalysis(payload, null);
}

/**
 * Is `fen` something we can actually hand to `new Chess(...)`?
 *
 * chess.js THROWS on a malformed FEN rather than returning null, and it throws on
 * the most common authoring mistake: a FEN written with fewer than the six
 * space-delimited fields it requires (people omit the halfmove/fullmove counters,
 * or copy a four-field "position only" string). An unvalidated FEN from a PGN tag
 * or a database row therefore crashed whatever board rendered it — the whole
 * page went down rather than one panel degrading.
 *
 * So a FEN is only accepted when it is a real six-field FEN *and* chess.js can
 * actually load it. `'start'` is the app's sentinel for the standard position.
 */
export function isUsableFen(fen) {
  const trimmed = String(fen || '').trim();
  if (!trimmed || trimmed === 'start') return false;
  /* chess.js wants exactly six fields; count before parsing so the common
     truncated case is rejected cheaply and with a clearer reason. */
  if (trimmed.split(/\s+/).length !== 6) return false;
  try {
    new Chess(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** The [FEN "..."] tag of a PGN, if it has a VALID one (mirrors the backend gameLoader). */
export function extractPgnFen(pgnText) {
  const fen = (String(pgnText || '').match(/\[FEN\s+"([^"]+)"/i) || [])[1];
  if (!fen) return null;
  const trimmed = fen.trim();
  /* A malformed tag is treated as no tag at all, so the caller falls back to the
     standard position instead of crashing on it. */
  if (!trimmed || trimmed === 'start' || !isUsableFen(trimmed)) return null;
  return trimmed;
}

/* Canonical initial-position precedence (same as the backend gameLoader):
 *   PGN [FEN]  →  supplied FEN (row.fen / caller FEN)  →  standard startpos.
 * No surface may silently assume the standard position when a custom FEN exists —
 * but an INVALID custom FEN is no better than none, so it is discarded too. */
export function resolveInitialFen({ pgnText = null, suppliedFen = null } = {}) {
  const tagFen = extractPgnFen(pgnText);
  if (tagFen) return tagFen;
  const supplied = String(suppliedFen || '').trim();
  if (supplied && supplied !== 'start' && isUsableFen(supplied)) return supplied;
  return 'start';
}

/* Run the canonical pipeline. `engine` is the Node-test hook (reviewGame's own
 *  `{ engine }` option); browser callers omit it and get the full NNUE pool. */
export async function analyzeCanonical(initialFen, moves, { onProgress, isCancelled, engine } = {}) {
  return reviewGame(initialFen, moves, {
    engineOverrides: { ...CANONICAL_ENGINE_OVERRIDES },
    onProgress,
    isCancelled,
    engine,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * getCanonicalAnalysis() — the ONE place a game gets analysed, and the ONE
 * place a stored analysis is trusted.
 *
 *   getCanonicalAnalysis(game)
 *        ↓  identity = gameSource:gameId
 *        ↓  valid HIT  → return instantly, NO engine
 *        ↓  MISS/STALE → reviewGame() → validate → store → return
 *
 * No UI component decides whether to call the engine; it asks here. That is what
 * makes "analyse once, reuse forever" true across Game Review, Chess Profile,
 * GM Game and every Brilliant-move click.
 *
 * Storage is a BOUNDED in-memory LRU in front of whatever persistent store the
 * caller injects. Bounded on purpose: an unbounded result map would grow for the
 * lifetime of the tab and is exactly the "permanent cache" this design avoids.
 */
const MEMORY_MAX_ENTRIES = 24;

/** insertion-ordered; the first key is the oldest (the LRU victim) */
const memory = new Map();
/** active analyses, keyed by identity+version, so one game runs once */
const inFlight = new Map();

let loggingOverride = null;
function devLogEnabled() {
  if (loggingOverride != null) return loggingOverride;
  try {
    if (import.meta && import.meta.env && import.meta.env.DEV) return true;
  } catch { /* not a vite context */ }
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') return true;
  } catch { /* browser without process */ }
  return false;
}
export function setCanonicalAnalysisLogging(on) { loggingOverride = on == null ? null : Boolean(on); }

/* Never logs PGNs or the analysis body — identity and version only. */
function trace(event, game, extra) {
  if (!devLogEnabled()) return;
  const key = canonicalAnalysisKey(game);
  const version = CANONICAL_ANALYSIS_VERSION;
  // eslint-disable-next-line no-console
  console.debug(`[CanonicalAnalysis] ${event}`, { key, version, ...extra });
}

function readMemory(game) {
  const key = canonicalAnalysisKey(game);
  if (!key) return null;
  const entry = memory.get(key);
  if (!entry) return null;
  /* Re-validate on EVERY read. This is the difference between a cache and a
     trap: an entry is trusted only while it still matches the current
     configuration and the game it is being served for. */
  if (!isValidCanonicalAnalysis(entry, game)) {
    memory.delete(key);
    trace('CACHE INVALID', game);
    return null;
  }
  /* refresh recency */
  memory.delete(key);
  memory.set(key, entry);
  trace('CACHE HIT', game);
  return entry.analysis;
}

function writeMemory(game, analysis) {
  const key = canonicalAnalysisKey(game);
  if (!key) return;
  const entry = {
    gameSource: String(game.gameSource),
    gameId: game.gameId,
    initialFen: String(game.initialFen || 'start'),
    moveCount: Array.isArray(game.moves) ? game.moves.length : null,
    analysisVersion: CANONICAL_ANALYSIS_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analysis,
  };
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
}

/** Drop cached analyses. `game` omitted → all (used when the version changes,
 *  and by tests). */
export function clearCanonicalAnalysisCache(game) {
  const key = game ? canonicalAnalysisKey(game) : null;
  if (key) memory.delete(key);
  else memory.clear();
}

export function getCanonicalAnalysisCacheSize() { return memory.size; }
export function getCanonicalAnalysisInFlightCount() { return inFlight.size; }
/** Test/diagnostic: is this identity currently resident in the memory LRU? */
export function isCanonicalAnalysisInMemory(game) {
  const key = canonicalAnalysisKey(game);
  return !!key && memory.has(key);
}

/**
 * Analyse a game once; reuse that result until its inputs change.
 *
 * @param {object} game
 * @param {string} game.gameSource  canonical source ('chess_profile', 'online', …)
 * @param {number|string} game.gameId  canonical id within that source
 * @param {string} game.initialFen  the game's real origin ('start' allowed)
 * @param {string[]} game.moves  the SAN moves
 * @param {object} [opts]
 * @param {Function} [opts.analyze]  override the pipeline (tests)
 * @param {Function} [opts.loadAnalysis]  async (gameId) => stored envelope|null
 * @param {Function} [opts.saveAnalysis]  async (gameId, envelope) => void
 * @param {boolean} [opts.force]  explicit user re-analyze — bypasses the cache
 * @param {boolean} [opts.reuseOnly]  return a valid stored analysis or null;
 *   NEVER start an engine run. This is what a card does when it OPENS, so an
 *   already-analysed game appears instantly while a first-time game still waits
 *   for the user to ask for analysis.
 * @param {Function} [opts.onProgress] [opts.isCancelled] [opts.engine]
 * @returns {Promise<object|null>} the canonical review result, or null in
 *   reuseOnly when nothing valid is stored.
 */
export async function getCanonicalAnalysis(game, opts = {}) {
  const {
    analyze = analyzeCanonical,
    loadAnalysis = null,
    saveAnalysis = null,
    force = false,
    reuseOnly = false,
    onProgress,
    isCancelled,
    engine,
  } = opts;

  const key = canonicalAnalysisKey(game);
  const moves = Array.isArray(game?.moves) ? game.moves : [];
  const initialFen = game?.initialFen || 'start';

  /* No identity (a pasted PGN, a hand-played board): there is nothing safe to
     key a cache on, so run the pipeline directly. Still canonical, just not
     cached — better than inventing an identity that could collide. */
  if (!key) {
    if (reuseOnly) return null;
    trace('ANALYSIS START', game, { reason: 'no-identity' });
    const res = await analyze(initialFen, moves, { onProgress, isCancelled, engine });
    return res;
  }

  const flightKey = `${key}@${CANONICAL_ANALYSIS_VERSION}`;

  if (!force) {
    /* 1 — memory */
    const hit = readMemory(game);
    if (hit) return hit;

    /* 2 — persistent store, validated the same way. A stale or corrupt payload
           is treated as a MISS, never as an answer. */
    if (loadAnalysis) {
      try {
        const stored = await loadAnalysis(game.gameId);
        if (stored) {
          if (isValidCanonicalAnalysis(stored, game)) {
            writeMemory(game, stored.analysis);
            trace('CACHE HIT', game, { tier: 'persistent' });
            return stored.analysis;
          }
          trace('CACHE STALE', game, { tier: 'persistent' });
        }
      } catch (err) {
        /* A broken store must never break the app; fall through to analysis. */
        trace('CACHE INVALID', game, { tier: 'persistent', error: String(err?.message || err) });
      }
    }
  }

  /* 3 — in-flight dedup. Two surfaces asking for the same game at once must
        produce ONE engine run; the second awaits the first's promise. */
  const running = inFlight.get(flightKey);
  if (running && !force) {
    trace('IN-FLIGHT REUSE', game);
    return running;
  }

  /* reuseOnly never reaches here with a live analysis: joining an in-flight run
     is free (no engine work by this caller), but STARTING one is not. */
  if (reuseOnly) {
    trace('CACHE MISS', game);
    return null;
  }

  trace('ANALYSIS START', game, { force: Boolean(force) });
  const promise = (async () => {
    const res = await analyze(initialFen, moves, { onProgress, isCancelled, engine });
    /* reviewGame resolves null on cancellation, and a partially-built result is
       not an analysis. Neither is ever stored: a cancelled or failed run must
       leave the cache exactly as it found it so the next request can retry. */
    if (!hasAnalysisShape(res)) {
      trace('ANALYSIS INVALID', game, { reason: res == null ? 'cancelled-or-empty' : 'malformed' });
      if (res == null && isCancelled) return res;
      if (!res) return res;
      /* Malformed but non-null: still not cacheable. */
      return res;
    }
    const entry = {
      gameSource: String(game.gameSource),
      gameId: game.gameId,
      initialFen: String(initialFen),
      moveCount: moves.length,
      analysisVersion: CANONICAL_ANALYSIS_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      analysis: res,
    };
    writeMemory(game, res);
    trace('ANALYSIS COMPLETE', game, { moves: moves.length });
    if (saveAnalysis) {
      try {
        await saveAnalysis(game.gameId, entry);
      } catch (err) {
        /* Persistence is best-effort: a failed write leaves a usable memory
           entry, and the analysis still returns to the caller. */
        trace('CACHE INVALID', game, { tier: 'persist-write', error: String(err?.message || err) });
      }
    }
    return res;
  })();

  inFlight.set(flightKey, promise);
  /* Always clear, on success AND failure — a rejected promise left behind would
     poison every later request for this game with the same error. */
  const settle = () => { if (inFlight.get(flightKey) === promise) inFlight.delete(flightKey); };
  promise.then(settle, settle);
  return promise;
}
