/* Opening book for the game-review classifier.
   TWO tiers:

   1. LOCAL CURATED BOOK (SAN lines, no external API) — the classic offline
      fallback and the source of the "opening tag" header label. Matching is
      prefix-based against the game's SAN history.

   2. LIVE LICHEss EXPLORER BOOK ("Book" badge, chess.com-style) — an async
      lookup against the masters database, gated by a "sufficient game
      frequency" rule (the position and the exact played move must both appear
      often enough in the DB). Used FIRST by the review pipeline; when the
      network lookup fails (offline / rate-limited / position not in the DB),
      the pipeline falls back to tier 1. Lookups are cached per position and
      deduplicated in flight, so a whole game costs at most one request per
      distinct position.

   Only the first BOOK_MAX_MOVE_NUMBER fullmoves are ever classified as
   book, so "book" stops applying once the players leave theory.

   The SAN strings must match chess.js canonical output exactly (parse them
   with a Chess instance, replaying each line, in the test that ships below).
*/

import {
  BOOK_EXPLORER_ENDPOINT,
  BOOK_MAX_MOVE_NUMBER,
  BOOK_MIN_POSITION_GAMES,
  BOOK_MIN_MOVE_GAMES,
  BOOK_MIN_MOVE_SHARE,
} from './reviewConfig.js';
import { APP_NAME } from '../config/brand';

export const BOOK_MAX_MOVES = 12;

export const openings = [
  { name: 'Italian Game: Giuoco Piano', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
  { name: 'Italian Game: Giuoco Pianissimo', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3', 'O-O'] },
  { name: 'Italian Game: Pianissimo Manoeuvre', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3', 'd6'] },
  { name: 'Italian Game: 4.c3', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4'] },
  { name: 'Two Knights Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { name: 'Evans Gambit', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4'] },
  { name: 'Ruy Lopez: Berlin Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6', 'Bxc6', 'dxc6'] },
  { name: 'Ruy Lopez: Closed, Main Line', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'O-O', 'c3', 'd6'] },
  { name: 'Ruy Lopez: Morphy Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'] },
  { name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nc3', 'Bb4'] },
  { name: 'Petrov Defense: Classical Attack', moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5', 'Bd3'] },
  { name: 'Philidor Defense', moves: ['e4', 'e5', 'Nf3', 'd6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nc3', 'Be7'] },
  { name: 'Four Knights Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'Bb5', 'Bb4', 'O-O', 'O-O', 'd3', 'd6'] },
  { name: 'Vienna Game', moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5'] },
  { name: "King's Gambit Accepted", moves: ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'g5'] },
  { name: 'Sicilian Defense: Najdorf Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { name: 'Sicilian Defense: Dragon Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'] },
  { name: 'Sicilian Defense: Classical Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6'] },
  { name: 'Sicilian Defense: Sveshnikov Variation', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5'] },
  { name: 'Sicilian Defense: Scheveningen', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e6'] },
  { name: 'Sicilian Defense: Taimanov Variation', moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6'] },
  { name: 'Sicilian Defense: Kan Variation', moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'a6'] },
  { name: 'Sicilian Defense: Closed', moves: ['e4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7'] },
  { name: 'Sicilian Defense: Grand Prix Attack', moves: ['e4', 'c5', 'Nc3', 'Nc6', 'f4'] },
  { name: 'Sicilian Defense: Alapin Variation', moves: ['e4', 'c5', 'c3', 'Nf6', 'e5', 'Nd5'] },
  { name: 'Sicilian Defense: Smith-Morra Gambit', moves: ['e4', 'c5', 'd4', 'cxd4', 'c3'] },
  { name: 'French Defense: Advance Variation', moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6'] },
  { name: 'French Defense: Tarrasch Variation', moves: ['e4', 'e6', 'd4', 'd5', 'Nd2', 'c5', 'exd5', 'exd5'] },
  { name: 'French Defense: Winawer Variation', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5'] },
  { name: 'French Defense: Classical Variation', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7'] },
  { name: 'Caro-Kann Defense: Advance Variation', moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'] },
  { name: 'Caro-Kann Defense: Classical Variation', moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'] },
  { name: 'Caro-Kann Defense: Exchange Variation', moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'] },
  { name: 'Scandinavian Defense', moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'] },
  { name: 'Pirc Defense', moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6'] },
  { name: 'Modern Defense', moves: ['e4', 'g6', 'd4', 'Bg7', 'Nc3', 'd6'] },
  { name: "Alekhine's Defense", moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6'] },
  { name: 'Queen\'s Gambit Declined: Orthodox', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7'] },
  { name: 'Queen\'s Gambit Declined: Lasker', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6'] },
  { name: 'Semi-Slav Defense', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'c6'] },
  { name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4'] },
  { name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6'] },
  { name: "Grünfeld Defense", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
  { name: "King's Indian Defense: Classical", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O'] },
  { name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { name: 'Queen\'s Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'] },
  { name: 'Bogo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'Bb4+'] },
  { name: 'Benoni Defense', moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6'] },
  { name: 'Benko Gambit', moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'b5'] },
  { name: 'Catalan Opening: Closed', moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O'] },
  { name: 'London System', moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'c5', 'e3', 'Nc6'] },
  { name: 'Colle System', moves: ['d4', 'd5', 'Nf3', 'Nf6', 'e3', 'e6', 'Bd3'] },
  { name: 'Trompowsky Attack', moves: ['d4', 'Nf6', 'Bg5'] },
  { name: 'Torre Attack', moves: ['d4', 'Nf6', 'Nf3', 'e6', 'Bg5'] },
  { name: 'English Opening: Reversed Sicilian', moves: ['c4', 'e5', 'Nc3', 'Nf6', 'g3', 'd5', 'cxd5', 'Nxd5', 'Bg2'] },
  { name: 'English Opening: Symmetrical', moves: ['c4', 'c5', 'Nf3', 'Nf6', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7'] },
  { name: 'Réti Opening', moves: ['Nf3', 'd5', 'c4', 'e6', 'g3', 'Nf6', 'Bg2', 'Be7'] },
  { name: 'King\'s Indian Attack', moves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2', 'c6', 'O-O', 'Bg4'] },
];

/* Is `san` a book move for a game whose already-played SAN history is
   `historySan`? Returns the matching opening entry or null. Only consulted
   within the first BOOK_MAX_MOVES full moves. */
export function bookMoveFor(historySan, san) {
  const idx = historySan.length;
  if (idx >= BOOK_MAX_MOVES * 2) return null;
  for (const line of openings) {
    if (idx >= line.moves.length || line.moves[idx] !== san) continue;
    let ok = true;
    for (let j = 0; j < idx; j++) {
      if (line.moves[j] !== historySan[j]) { ok = false; break; }
    }
    if (ok) return line;
  }
  return null;
}

/* Name of the most specific opening still consistent after `historySan` —
   picked as the shortest matching line, so early on you get the family
   ("Italian Game") which then refines as the variation unfolds. Null when
   the game already left book. Used for the header label. */
export function openingTag(historySan) {
  let best = null;
  for (const line of openings) {
    if (line.moves.length < 4) continue;
    let ok = true;
    for (let j = 0; j < historySan.length && j < line.moves.length; j++) {
      if (line.moves[j] !== historySan[j]) { ok = false; break; }
    }
    if (ok && historySan.length <= line.moves.length) {
      if (!best || line.moves.length < best.moves.length) best = line;
    }
  }
  return best ? best.name : null;
}

/* ────────────────────────────────────────────────────────────────────────
   Lichess Explorer book (async, frequency-gated)
   ──────────────────────────────────────────────────────────────────────── */

/* per-run + cross-game position cache: fen → Promise of the explorer payload
   (shared across games so a validation corpus hits the API once per opening). */
const explorerCache = new Map();

/* Sticky flag set once the backend tells us it has no Lichess token:
   the explorer is unavailable, so every later question can short-circuit to
   the offline curated book without a network round-trip (or a 401 spam). */
let explorerDisabled = false;

/* The explorer response for `fen`, cached and in-flight-deduplicated.
   Resolves to null when the position isn't in the DB or the request fails —
   never throws to the pipeline.

   Lichess now requires auth on explorer.lichess.ovh (browser fetch → 401).
   In the browser we route through our backend proxy (which identifies the
   server and can send an API token); in Node scripts we talk to Lichess
   directly but send the identifying headers Lichess asks for. */
const isBrowser = typeof window !== 'undefined' && typeof window.location !== 'undefined';

export async function explorerLookup(fen) {
  if (explorerDisabled) return null;
  if (explorerCache.has(fen)) return explorerCache.get(fen);
  const p = (async () => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
    try {
      const headers = {
        Accept: 'application/json',
        'User-Agent': `mate-zone-chess-academy-review/1.0 (${APP_NAME} game review; opening book lookup)`,
      };
      if (!isBrowser && process.env.LICHESS_API_TOKEN) {
        headers.Authorization = `Bearer ${process.env.LICHESS_API_TOKEN}`;
      }
      const url = isBrowser
        ? `/api/openings/explorer?fen=${encodeURIComponent(fen)}`
        : `${BOOK_EXPLORER_ENDPOINT}?fen=${encodeURIComponent(fen)}`;
      const init = isBrowser
        ? { cache: 'force-cache', signal: ctrl ? ctrl.signal : undefined }
        : { headers, cache: 'force-cache', signal: ctrl ? ctrl.signal : undefined };
      const res = await fetch(url, init);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.moves)) return null;
      if (data.configured === false) {
        explorerDisabled = true;
        return null;
      }
      return data;
    } catch {
      return null; // offline / rate-limited / timed out → fall back to the local book
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  explorerCache.set(fen, p);
  return p;
}

/* strip check/mate/annotation suffixes so chess.js SAN matches explorer SAN */
const canonSan = (san) => (san || '').replace(/[+#!?]+$/g, '');

/* "sufficient game frequency" (chess.com-style): the POSITION must be common
   enough in the DB (≥ BOOK_MIN_POSITION_GAMES) and the EXACT played move must
   appear often enough both in absolute games (≥ BOOK_MIN_MOVE_GAMES) and as a
   share of the position's sample (≥ BOOK_MIN_MOVE_SHARE %). */
export function isSufficientBookEntry(data, playedSan) {
  if (!data) return null;
  const total = data.white + data.draws + data.black;
  if (total < BOOK_MIN_POSITION_GAMES) return null;
  const target = canonSan(playedSan);
  for (const mv of data.moves) {
    if (canonSan(mv.san) !== target) continue;
    const games = mv.white + mv.draws + mv.black;
    const share = total > 0 ? (games / total) * 100 : 0;
    if (games >= BOOK_MIN_MOVE_GAMES && share >= BOOK_MIN_MOVE_SHARE) {
      return { games, share, played: games, total };
    }
  }
  return null;
}

/* The review pipeline's single book decision. Resolves to a book entry
   ({ name }) or null. Order:
     1. window gate — only the first BOOK_MAX_MOVE_NUMBER fullmoves;
     2. live Lichess Explorer lookup + frequency rule;
     3. offline / miss → the curated local book.
   Pure-DI: an injected `lookup` (tests / determinism harness) replaces the
   explorer. */
export async function resolveBookMove({ fenBefore, historySan = [], san, lookup = explorerLookup }) {
  if (historySan.length >= BOOK_MAX_MOVE_NUMBER * 2) return null;
  let data = null;
  try {
    data = await lookup(fenBefore);
  } catch { data = null; }
  if (data) {
    const entry = isSufficientBookEntry(data, san);
    if (entry) {
      return {
        games: entry.games,
        share: Math.round(entry.share * 10) / 10,
        name: data.opening && data.opening.name ? data.opening.name : null,
      };
    }
  }
  const local = bookMoveFor(historySan, san);
  return local ? local : null;
}