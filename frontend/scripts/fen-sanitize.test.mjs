/* Regression guard for jhlywa/chess.js#577 / #552.
 *
 * chess.js 1.4.0 loads any syntactically valid FEN but THROWS
 * "TypeError: Cannot mix BigInt and other types" from move generation
 * (isStalemate/moves) when the castling field advertises a right whose king and
 * rook are not on their home squares. Game Review rebuilt its board from such a
 * stored FEN and `resultText()` took the whole page down. `sanitizeFen` drops the
 * unsupported rights before chess.js sees the string.
 *
 * Run: node --test scripts/fen-sanitize.test.mjs
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';
import { sanitizeFen } from '../src/utils/fen.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/* The exact shape that crashed: an imported mid-game FEN carrying default
   castling rights with no rooks on their home squares. */
const BROKEN = '1k1nr3/1pp5/p4p2/3p2p1/PP1P4/2P2QPp/5P1P/4R2K b KQkq - 0 1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const castlingField = (fen) => fen.split(/\s+/)[2];

test('the raw broken FEN really does throw (so the guard is meaningful)', () => {
  assert.throws(() => new Chess(BROKEN).moves(), /BigInt/);
});

test('sanitizeFen drops rights the position cannot support', () => {
  const fixed = sanitizeFen(BROKEN);
  assert.equal(castlingField(fixed), '-');
  /* all other fields are preserved verbatim */
  const a = BROKEN.split(/\s+/); const b = fixed.split(/\s+/);
  assert.deepEqual([b[0], b[1], b[3], b[4], b[5]], [a[0], a[1], a[3], a[4], a[5]]);
});

test('a sanitized broken FEN no longer throws on move generation', () => {
  const g = new Chess(sanitizeFen(BROKEN));
  assert.doesNotThrow(() => g.moves());
  assert.doesNotThrow(() => g.isStalemate());
  assert.doesNotThrow(() => g.isCheckmate());
});

test('a real position keeps every castling right', () => {
  assert.equal(sanitizeFen(START), START);
  const realFour = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.equal(castlingField(sanitizeFen(realFour)), 'KQkq');
});

test('only the unsupported side is dropped', () => {
  /* white rooks/king home, black king home but no rooks → keep KQ, drop kq */
  const fixed = sanitizeFen('4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(castlingField(fixed), 'KQ');
});

test('non-six-field FENs pass through untouched', () => {
  const short = '8/8/8/8/8/8/8/8 b KQkq';
  assert.equal(sanitizeFen(short), short);
  assert.equal(sanitizeFen('start'), 'start');
  assert.equal(sanitizeFen(''), '');
});

test('GameReview rebuilds through sanitizeFen and resultText cannot throw', () => {
  const src = readFileSync(join(SRC, 'pages', 'GameReview.jsx'), 'utf8');
  assert.match(src, /sanitizeFen\('init|sanitizeFen\(init|sanitizeFen\(/);
  assert.match(src, /const safeInit = init === 'start' \? 'start' : sanitizeFen\(init\);/);
  /* resultText wraps move generation so a degenerate position degrades to '' */
  const fn = src.slice(src.indexOf('function resultText'));
  assert.match(fn, /try \{/);
  assert.match(fn, /catch \{/);
});
