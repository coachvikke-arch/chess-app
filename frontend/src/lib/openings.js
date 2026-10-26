/* Openings module — data access + chess helpers.

   The curated library (src/data/openingsLibrary.json) is the SOURCE OF TRUTH
   and the app works fully offline against it. The Lichess Opening Explorer is
   treated as a progressive enhancement: when it answers, we overlay live move
   stats (popularity %, game counts, win rates) on top of the curated lines;
   when it is down or rate-limited we simply show the curated numbers.

   Every helper here is pure and synchronous (no network) so the pages stay
   simple and testable — the explorer lives in ./lichessExplorer.js.
*/

import { Chess } from 'chess.js';
import library from '../data/openingsLibrary.json';
import gambits from '../data/gambitsLibrary.json';

/* The base library stays focused on core openings; the gambit expansion is
   curated separately so its accepted/declined classification and aliases do
   not clutter the original records. Both are merged into one runtime list, so
   every existing page, filter, progress key and practice flow treats a gambit
   exactly like any other opening. */
export const BASE_OPENINGS = library.openings || [];
export const GAMBIT_OPENINGS = gambits.openings || [];
export const OPENINGS = [...BASE_OPENINGS, ...GAMBIT_OPENINGS];
export const LIBRARY_VERSION = library.version || 1;
export const GAMBITS = OPENINGS.filter((o) => (o.style || []).includes('Gambit'));
export const isGambit = (opening) => Boolean(opening && (opening.style || []).includes('Gambit'));

/* Canonical filter vocabularies, derived from the data so they can never drift. */
export const STYLES = ['Aggressive', 'Positional', 'Solid', 'Gambit'];
export const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];
export const SIDES = ['white', 'black'];

const DIFFICULTY_ORDER = { Beginner: 0, Intermediate: 1, Advanced: 2 };

/* ──────────────────────────── lookups ──────────────────────────── */

const BY_SLUG = new Map(OPENINGS.map((o) => [o.slug, o]));

export function getOpening(slug) {
  return BY_SLUG.get(slug) || null;
}

export function listFamilies() {
  const counts = new Map();
  for (const o of OPENINGS) counts.set(o.family, (counts.get(o.family) || 0) + 1);
  return [...counts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

export function familySlugs(family) {
  return OPENINGS.filter((o) => o.family === family).map((o) => o.slug);
}

/* ──────────────────────────── filtering ─────────────────────────── */

/** Popularity filter buckets — matches the "Popular / Common / Rare" UI. */
export const POPULARITY_TIERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'top', label: 'Popular', test: (o) => (o.popularity || 0) >= 60 },
  { key: 'mid', label: 'Common', test: (o) => (o.popularity || 0) >= 30 && (o.popularity || 0) < 60 },
  { key: 'low', label: 'Rare', test: (o) => (o.popularity || 0) < 30 },
];

/**
 * Filter + search + sort the library.
 *
 * @param {object}  opts
 * @param {string}  opts.search      free text over name / eco / family / moves
 * @param {string}  opts.side        'white' | 'black' | '' (any)
 * @param {string[]}opts.styles      any-of style filter ([] = any)
 * @param {string}  opts.difficulty  '' = any
 * @param {string}  opts.popularity  tier key from POPULARITY_TIERS
 * @param {string}  opts.family      '' = any
 * @param {string}  opts.sort        'popularity' | 'name' | 'difficulty' | 'eco'
 */
export function filterOpenings(opts = {}) {
  const {
    search = '',
    side = '',
    styles = [],
    difficulty = '',
    popularity = 'all',
    family = '',
    sort = 'popularity',
  } = opts;

  const q = search.trim().toLowerCase();
  const tier = POPULARITY_TIERS.find((t) => t.key === popularity) || POPULARITY_TIERS[0];

  let list = OPENINGS.filter((o) => {
    if (side && o.side !== side) return false;
    if (difficulty && o.difficulty !== difficulty) return false;
    if (family && o.family !== family) return false;
    if (styles.length && !styles.some((s) => (o.style || []).includes(s))) return false;
    if (!tier.test(o)) return false;

    if (q) {
      const hay = [
        o.name,
        o.eco,
        o.family,
        o.description,
        (o.aliases || []).join(' '),
        (o.keyIdeas || []).join(' '),
        (o.moves || []).join(' '),
        /* Variation names are searchable too, so "Fried Liver" or "Saemisch"
           finds the opening that contains them. */
        (o.variations || []).map((v) => `${v.name} ${(v.moves || []).join(' ')}`).join(' '),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    eco: (a, b) => (a.eco || '').localeCompare(b.eco || '') || a.name.localeCompare(b.name),
    difficulty: (a, b) =>
      (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9) ||
      a.name.localeCompare(b.name),
    popularity: (a, b) => (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name),
  };
  return list.slice().sort(by[sort] || by.popularity);
}

/* ──────────────────────────── chess helpers ─────────────────────────── */

/**
 * Replay an opening's SAN list and return one entry per ply.
 *
 * Each entry: { ply, san, uci, from, to, fen, color, moveNumber, capture, check }
 * `fen` is the position AFTER that move, so index 0 is the start position and
 * the last element is the final position of the line.
 *
 * The opening is validated as it is replayed: if a move is illegal the replay
 * stops there and the remaining entries are omitted, so a bad line can never
 * crash the UI or produce a bogus position.
 */
export function buildLine(opening) {
  if (!opening?.moves?.length) return { startFen: null, plies: [] };
  const game = new Chess();
  const startFen = game.fen();
  const plies = [{ ply: 0, san: null, uci: null, from: null, to: null, fen: startFen, color: 'w' }];

  for (const san of opening.moves) {
    let mv;
    try {
      mv = game.move(san);
    } catch {
      break; // illegal line — stop cleanly, keeping what we validated
    }
    if (!mv) break;
    plies.push({
      ply: plies.length,
      san: mv.san,
      uci: `${mv.from}${mv.to}${mv.promotion || ''}`,
      from: mv.from,
      to: mv.to,
      fen: game.fen(),
      color: mv.color,
      moveNumber: game.moveNumber(),
      capture: Boolean(mv.captured),
      check: Boolean(mv.san.includes('+') || mv.san.includes('#')),
    });
  }
  return { startFen, plies };
}

/** FEN after `n` plies of an opening's main line (0 = start position). */
export function fenAfterPly(opening, n) {
  const { plies } = buildLine(opening);
  if (plies.length === 0) return null;
  const idx = Math.max(0, Math.min(n, plies.length - 1));
  return plies[idx].fen;
}

/** The last fully-validated ply count (a malformed line ends early). */
export function lineLength(opening) {
  return Math.max(0, buildLine(opening).plies.length - 1);
}

/** True when ply index `n` (0-based, 0 = before any move) belongs to `side`. */
export function isSidePly(opening, n) {
  const side = opening?.side === 'black' ? 'b' : 'w';
  return n % 2 === (side === 'w' ? 0 : 1);
}

/** Human move number for a ply index, for the "Move 3…" labels. */
export function plyMoveNumber(n) {
  return Math.floor(n / 2) + 1;
}

/** The SAN the learner is expected to play at ply index `n` (null when done). */
export function expectedSan(opening, n) {
  const { plies } = buildLine(opening);
  return plies[n + 1]?.san || null;
}

/** Compact one-line move text, e.g. "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5". */
export function lineToString(opening) {
  if (!opening?.moves?.length) return '';
  return opening.moves.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}

/* ──────────────────────────── variations ──────────────────────────────── */

/**
 * Every line an opening can be studied or practised as: the main line first,
 * then its variations.
 *
 * A variation is a COMPLETE line from move 1 (not a suffix), so anything that
 * takes a line — buildLine, expectedSan, isSidePly, the practice drill — works
 * on a variation exactly as it does on the opening itself. Each entry is
 * returned in the same shape as an opening (`moves`, `notes`, `side`, …) with
 * the variation's own `id`/`name` and `isMain`, so callers never have to branch
 * on which kind of line they were handed.
 *
 * An unknown or missing id falls back to the main line, so a stale ?v= URL in
 * a bookmark can never render a blank page.
 */
export function listLines(opening) {
  if (!opening) return [];
  const main = {
    id: 'main',
    name: 'Main line',
    slug: opening.slug,
    side: opening.side,
    moves: opening.moves || [],
    notes: opening.notes || {},
    isMain: true,
    variationId: null,
  };
  const variations = (opening.variations || []).map((v) => ({
    id: v.id,
    name: v.name,
    slug: opening.slug,
    /* A variation is always played by the same side as its parent opening. */
    side: opening.side,
    moves: v.moves || [],
    notes: v.notes || {},
    isMain: false,
    variationId: v.id,
  }));
  return [main, ...variations];
}

/** One line by id, defaulting to the main line. */
export function getLine(opening, variationId) {
  const lines = listLines(opening);
  if (!variationId) return lines[0] || null;
  return lines.find((l) => l.id === variationId) || lines[0] || null;
}

/**
 * The ply at which a variation first departs from the main line.
 *
 * 0 means the variation is identical to the main line for its whole length, and
 * null means the line IS the main line. The study view uses this to mark the
 * shared moves as common ground and highlight only the new ones.
 */
export function branchPly(opening, line) {
  if (!opening || !line || line.isMain) return null;
  const main = opening.moves || [];
  const other = line.moves || [];
  const n = Math.min(main.length, other.length);
  for (let i = 0; i < n; i += 1) {
    if (main[i] !== other[i]) return i;
  }
  return main.length === other.length ? 0 : main.length;
}

/** How many lines an opening offers in total (main line included). */
export function lineCount(opening) {
  return 1 + (opening?.variations?.length || 0);
}

/** Free-text search also covers variation names, so "Fried Liver" finds it. */
export function variationNames(opening) {
  return (opening?.variations || []).map((v) => v.name).join(' ');
}
