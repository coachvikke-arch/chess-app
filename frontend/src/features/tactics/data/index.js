/**
 * Tactics data — the single source of truth for the Chess Tactics section.
 *
 * This file is DATA, not logic. `tactics.json` holds all 45 tactics and is
 * imported as-is; every screen (list, card, replay) reads from here, so a
 * new tactic is one JSON object and nothing else.
 *
 * Why JSON and not a JS module: the same slugs are reused as theme tags by the
 * puzzle and game-analysis screens, so the data has to be readable without
 * running any of the app's code — `scripts/tactics-data.test.mjs` loads it
 * straight into chess.js and checks every FEN and every solution move.
 *
 * THE SCHEMA (per entry):
 *   id            1..45, stable — progress is stored against it.
 *   slug          URL segment (`/student/tactics/:slug`) and theme tag.
 *   category      one of the four groups the list screen renders.
 *   title         shown after the word "The".
 *   tags          the tactical theme this teaches, reusable elsewhere.
 *   fen           the position BEFORE the key move. The side to move is whoever
 *                 plays the solution (always white except Fool's Mate).
 *   highlights    squares to tint: red = target, orange = key square,
 *                 green = the piece that moves.
 *   arrows        from/to pairs. The first one is the key move itself.
 *   caption       "Nf7+ one piece, two targets" — the move plus a phrase.
 *   whatItIs / whyItWins / doThis   the three teaching blocks, ≤25 words each.
 *   solution      WHITE's moves only, in order, as SAN.
 *   opponentReplies  BLACK's answer to each white move in turn, as SAN. A
 *                 two-step idea (take the defender, then the piece) needs one
 *                 entry here, because the black reply sits between them.
 */

import raw from './tactics.json';
import sampleRaw from './samples.json';

export const TACTIC_CATEGORIES = [
  'Basic Tactics',
  'Forcing Moves',
  'Mating Patterns',
  'Endgame Tactics',
  'Other',
];

/** Tactics in curriculum order. Frozen so no screen can reorder the source. */
export const TACTICS = Object.freeze(raw.map((entry) => Object.freeze(entry)));

export const TACTIC_COUNT = TACTICS.length;

/** Categories in display order, each with its tactics. */
export function tacticsByCategory() {
  return TACTIC_CATEGORIES
    .map((name) => ({ name, items: TACTICS.filter((t) => t.category === name) }))
    .filter((group) => group.items.length > 0);
}

export function findTactic(slug) {
  return TACTICS.find((t) => t.slug === slug) || null;
}

/** Slug of the tactic before/after this one, for the Prev/Next buttons. */
export function neighbours(tactic) {
  if (!tactic) return { prev: null, next: null };
  const i = TACTICS.findIndex((t) => t.slug === tactic.slug);
  return {
    prev: i > 0 ? TACTICS[i - 1] : null,
    next: i >= 0 && i < TACTICS.length - 1 ? TACTICS[i + 1] : null,
  };
}

/** Free-text filter over title, slug, category and tags. */
export function searchTactics(query, list = TACTICS) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((t) => [t.title, t.slug, t.category, ...(t.tags || [])]
    .join(' ')
    .toLowerCase()
    .includes(q));
}

/** Every distinct tag across the dataset, alphabetically. */
export function allTacticTags(list = TACTICS) {
  return [...new Set(list.flatMap((t) => t.tags || []))].sort();
}

/* ── practice puzzles ─────────────────────────────────────────────────────
 *
 * These are REAL positions from the Lichess puzzle database (CC0), not the
 * hand-authored diagrams above. Two differences matter to anything reading
 * them:
 *
 *   fen        the position AFTER the opponent's blunder (`trigger`), so the
 *              reader is the side to move. Lichess ships the position BEFORE
 *              it — scripts/build_tactics_samples.mjs advances the trigger and
 *              drops it from the solution.
 *   solution   the solver's moves as SAN, with the opponent's answers in
 *              `opponentReplies` — the same contract TACTIC_CARDS use.
 *
 * `themes` is the raw Lichess theme list (kept for search/filtering); `line` is
 * a numbered SAN string for display only.
 */
export const SAMPLE_SOURCE = Object.freeze(sampleRaw.source);

export const SAMPLE_TOPICS = Object.freeze(sampleRaw.topics.map((topic) => Object.freeze({
  ...topic,
  puzzles: Object.freeze(topic.puzzles.map((puzzle) => Object.freeze(puzzle))),
})));

export const SAMPLE_COUNT = SAMPLE_TOPICS.reduce((n, topic) => n + topic.puzzles.length, 0);