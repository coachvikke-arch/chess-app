import { Chess } from 'chess.js';

const FILES = 'abcdefgh';

/** The part of a FEN that defines the position (ignores move counters). */
export function positionKey(fen) {
  return String(fen).split(' ').slice(0, 4).join(' ');
}

/**
 * Squares whose contents differ between two piece-placement fields.
 *
 * Rows are expanded to one character per square before comparing: in the
 * compact FEN a `8` and a `P` shift every following square, so comparing the
 * raw strings character by character would report changes that never happened.
 */
function changedSquares(before, after) {
  const rowsBefore = String(before).split('/');
  const rowsAfter = String(after).split('/');
  const out = new Set();
  for (let r = 0; r < 8; r += 1) {
    const a = expandRow(rowsBefore[r]);
    const b = expandRow(rowsAfter[r]);
    for (let f = 0; f < 8; f += 1) {
      if (a[f] !== b[f]) out.add(`${FILES[f]}${8 - r}`);
    }
  }
  return out;
}

function expandRow(row) {
  const out = [];
  for (const ch of String(row || '')) {
    if (ch >= '1' && ch <= '8') {
      for (let i = 0; i < Number(ch); i += 1) out.push('');
    } else out.push(ch);
  }
  while (out.length < 8) out.push('');
  return out.slice(0, 8);
}

/**
 * "Did exactly one legal move produce `nextFen` from `prevFen`?"
 *
 * Working backwards from the FENs is what makes this safe for any caller: it can
 * only ever match a real, legal move of the position we were actually in, so a
 * jump across plies, a new game load or a FEN paste returns null.
 *
 * The placement diff is what makes it cheap. A move always empties its origin
 * and fills its destination, so both squares necessarily appear in the diff —
 * castling (4 squares), en passant (3) and promotion (2) included. Narrowing the
 * legal list to those candidates before applying anything turns the old
 * "apply every legal move and compare" sweep (30-40 full move generations for a
 * busy position, and up to three of them per navigation) into one generation
 * plus one or two probes, and a multi-ply jump costs almost nothing.
 */
export function exactlyOnePly(prevFen, nextFen) {
  if (!prevFen || !nextFen || prevFen === nextFen) return null;
  const cacheKey = `${prevFen}|${nextFen}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const answer = probe(prevFen, nextFen);
  remember(cacheKey, answer);
  return answer;
}

/* One surface asks the same question several times per navigation: the piece
 * layer probes it to animate the ply, and the board probes it again to sound the
 * move and start its effect — and a card opened over another board doubles both.
 * The last answers are kept so one step is one generation. Small on purpose:
 * navigation only ever revisits the pairs the user just crossed. */
const CACHE_LIMIT = 64;
const cache = new Map();

function remember(key, value) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

function probe(prevFen, nextFen) {
  const before = String(prevFen).split(' ');
  const after = String(nextFen).split(' ');
  /* One ply always hands the turn to the other side. */
  if (before[1] === after[1]) return null;
  const diff = changedSquares(before[0], after[0]);
  /* Same placement, different move counters: nothing moved. */
  if (diff.size === 0) return null;

  let prevGame;
  try { prevGame = new Chess(prevFen); } catch { return null; }  // bad FEN from a caller
  let legal;
  try { legal = prevGame.moves({ verbose: true }); } catch { return null; }

  const candidates = legal.filter((m) => diff.has(m.from) && diff.has(m.to));
  for (const m of candidates) {
    try {
      prevGame.move(m.san);
      /* `isCheckmate`/`isStalemate` can end a game, but FEN stays comparable. */
      if (positionKey(prevGame.fen()) === positionKey(nextFen)) return m;
      prevGame.undo();
    } catch {
      /* Undo restores the position; keep scanning the remaining candidates. */
    }
  }
  return null;
}
