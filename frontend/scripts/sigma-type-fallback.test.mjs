/* ──────────────────────────────────────────────────────────────────────────
 * A brilliant move must always reach the Brilliant Moves list.
 *
 * The regression: a "protected sacrifice" — a brilliant move whose piece stays
 * DEFENDED, which the classifier blesses on the continuation rather than on the
 * geometry — produced a review row with the verdict 'sigma' but a NULL type.
 * The persist step dropped every row without a type ("the column is NOT NULL,
 * a chip that can hold nothing is worse than one that is never offered"), so
 * the POST went out EMPTY for that game: the Brilliant Moves tab showed
 * nothing at all, even though the review itself displayed "!!" on that move.
 *
 * The position below is the real one: 25.Bxf5+ in M8-Zone vs Nursandi1945,
 * where the bishop lands on f5 defended by the queen on e5 — nothing looks
 * "given away", so the geometry names no type.
 *
 * Run: node --test scripts/sigma-type-fallback.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifySigmaFromPly,
  classifySigmaType,
  fallbackSigmaType,
  SIGMA_TYPE,
} from '../src/utils/sigmaType.js';
import { buildSigmaPayload } from '../src/utils/sigmaPayload.js';

/* 25.Bxf5+ — the bishop is defended by the queen on e5, so the "given away"
   geometry finds nothing. */
const PROTECTED_FEN = 'r3b3/2p1r1pk/p3p2q/1p1pQp2/3P4/2PB2RP/PP3P2/1K4R1 w - - 0 25';
const PROTECTED_SAN = 'Bxf5+';

const PERSIST = readFileSync(new URL('../src/utils/sigmaPersist.js', import.meta.url), 'utf8');

test('a protected sacrifice is still named — by the piece it offered', () => {
  const named = classifySigmaFromPly({ fenBefore: PROTECTED_FEN, moveSan: PROTECTED_SAN, isSigma: true });
  assert.ok(named, 'the move must be nameable');
  assert.equal(named.type, SIGMA_TYPE.BISHOP);
  assert.equal(named.fromSquare, 'd3');
  assert.equal(named.toSquare, 'f5');
});

test('the geometry alone still names a loose offer', () => {
  /* A loose offer (the piece really is hanging) keeps its type from the
     geometry — the fallback only fills a gap. */
  const loose = classifySigmaType({
    move: { piece: 'p', color: 'w', from: 'd5', to: 'h5', san: 'dxh5' },
    exposed: ['r'],
  });
  assert.equal(loose, SIGMA_TYPE.ROOK);
});

test('an underpromotion is an underpromotion by definition', () => {
  assert.equal(fallbackSigmaType({ piece: 'p', promotion: 'n' }), SIGMA_TYPE.UNDERPROMOTION);
  assert.equal(fallbackSigmaType({ piece: 'p', promotion: 'q' }), null,
    'a queen promotion is not an underpromotion');
  assert.equal(fallbackSigmaType({ piece: 'q' }), SIGMA_TYPE.QUEEN);
  assert.equal(fallbackSigmaType({ piece: 'p' }), null, 'a pawn is never a sacrifice piece');
  assert.equal(fallbackSigmaType(null), null);
});

test('a brilliant row without a type is still sent to the API', () => {
  const review = {
    moves: [
      { ply: 48, san: 'Bxf5+', verdict: 'sigma', sigma: null },
      { ply: 12, san: 'e4', verdict: 'good', sigma: null },
      { ply: 3, san: 'Nf3', verdict: 'brilliant', sigma: { type: 'knight_sacrifice' } },
    ],
  };
  const payload = buildSigmaPayload(review);
  assert.equal(payload.length, 2, 'both brilliant rows must be kept');
  const named = payload.find((p) => p.ply === 48);
  assert.ok(named, 'the unnamed brilliant must be in the payload');
  assert.equal(named.sigmaType, null, 'it is named later, from the move data');
  assert.equal(named.moveSan, 'Bxf5+');
  assert.equal(payload.find((p) => p.ply === 3).sigmaType, 'knight_sacrifice');
});

test('the persist step names an unnamed brilliant from the move data', () => {
  assert.match(PERSIST, /classifySigmaFromPly\(\{ fenBefore, moveSan: m\.moveSan, isSigma: true \}\)/,
    'the type must be re-derived with the SAME classifier the review used');
  assert.match(PERSIST, /\.filter\(\(m\) => m\.sigmaType\)/,
    'a move that still has no name is the only one that may be dropped');
});
