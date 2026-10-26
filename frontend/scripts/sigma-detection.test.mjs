import { test } from 'node:test';
import assert from 'node:assert';

/**
 * Unit tests for Sigma move type detection.
 *
 * On the fixtures: these use DELIBERATELY BUILT positions rather than famous
 * games. An earlier draft typed out PGN by hand and two of the lines were not
 * even legal — the tests then failed for reasons that had nothing to do with the
 * classifier, which is the worst possible failure mode for a test.
 *
 * The positions here are minimal and each one isolates exactly one thing: a white
 * major piece offering itself to the enemy king with nothing defending it. That is
 * unambiguously a sacrifice of that piece, so the expected type is provable by
 * inspection rather than by trusting a remembered score.
 *
 * Whether the move is *brilliant* at all is decided by the existing
 * reviewClassify.classifyMove; these tests cover only "which type", and every
 * one asserts the fixture is a legal move first, so a typo cannot masquerade as a
 * passing test.
 *
 * Run: node --test scripts/sigma-detection.test.mjs
 */

import {
  SIGMA_TYPE, SIGMA_TYPES_IN_PRIORITY_ORDER, SIGMA_TYPE_META,
  classifySigmaType, classifySigmaFromPly, collectExposedPieces,
  isSigmaVerdict, normaliseVerdict, SIGMA_VERDICT, LEGACY_SIGMA_VERDICT,
  PIECE_VALUE, MIN_SACRIFICE_VALUE,
} from '../src/utils/sigmaType.js';
import { Chess } from 'chess.js';

const START = new Chess().fen();

/** Compress a row of '.' (empty) and pieces into FEN run-length form. */
function compressRow(row) {
  let out = '';
  let run = 0;
  for (const ch of row) {
    if (ch === '.') { run += 1; continue; }
    if (run) { out += run; run = 0; }
    out += ch;
  }
  return run ? out + run : out;
}

/**
 * A position where Black's king sits in the open next to where the white piece is
 * about to land, so the piece is genuinely hanging and can be taken for nothing.
 * That is the sacrifice, and it is provable by inspection rather than by
 * remembering a game.
 *
 * FEN rank 8 is the first group, so a square's row index is 8 - rank.
 */
function hangingPieceFen(piece, whitePieceSquare) {
  const board = Array.from({ length: 8 }, () => '.'.repeat(8));
  const put = (square, ch) => {
    const [file, rank] = square.split('');
    const row = 8 - Number(rank);
    const col = file.charCodeAt(0) - 97;
    const cells = board[row].split('');
    cells[col] = ch;
    board[row] = cells.join('');
  };
  put('d4', 'k');                  // the enemy king, out in the open
  put('e1', 'K');                  // our king, safely far away
  put(whitePieceSquare, piece.toUpperCase());
  return `${board.map(compressRow).join('/')} w - - 0 1`;
}

/* Each piece's move onto e4, which is adjacent to the black king on d4. */
const SACRIFICE_CASES = [
  { name: 'Queen Sacrifice', piece: 'q', from: 'e2', san: 'Qe4+', type: SIGMA_TYPE.QUEEN },
  { name: 'Rook Sacrifice', piece: 'r', from: 'e2', san: 'Re4+', type: SIGMA_TYPE.ROOK },
  { name: 'Bishop Sacrifice', piece: 'b', from: 'b1', san: 'Be4+', type: SIGMA_TYPE.BISHOP },
  { name: 'Knight Sacrifice', piece: 'n', from: 'g5', san: 'Ne4+', type: SIGMA_TYPE.KNIGHT },
];

/** Strip the check/mate suffix so fixtures need not predict it. */
const bare = (san) => san.replace(/[+#]/g, '');

/** Assert a SAN is legal here, then classify it. */
function typeOf(fenBefore, san) {
  const probe = new Chess(fenBefore);
  assert.ok(
    probe.moves({ verbose: true }).some((m) => bare(m.san) === bare(san)),
    `fixture is wrong: ${san} is not legal in ${fenBefore}`
  );
  return classifySigmaFromPly({ fenBefore, moveSan: san, isSigma: true })?.type ?? null;
}

/* ── The type table ───────────────────────────────────────────────────────*/

test('there are exactly five types, in sacrifice-priority order', () => {
  assert.deepStrictEqual(SIGMA_TYPES_IN_PRIORITY_ORDER, [
    'queen_sacrifice',
    'rook_sacrifice',
    'bishop_sacrifice',
    'knight_sacrifice',
    'underpromotion',
  ]);
  /* The filter sheet renders in this order, so queen must lead with the highest
     priority rank. */
  assert.strictEqual(SIGMA_TYPE_META[SIGMA_TYPES_IN_PRIORITY_ORDER[0]].rank, 5);
});

test('every type has a label and a piece glyph for the filter icons', () => {
  for (const t of SIGMA_TYPES_IN_PRIORITY_ORDER) {
    assert.ok(SIGMA_TYPE_META[t].label, `${t} needs a label`);
    assert.ok(SIGMA_TYPE_META[t].piece, `${t} needs a piece glyph`);
  }
});

/* A type label names the piece that was given up. It must not just restate the
   verdict's own name — the verdict label ("Brilliant") lives in REVIEW_META, and
   a card that read "Brilliant" instead of "Queen Sacrifice" would say nothing
   the badge does not already say. */
test('a Sigma type is named after the piece given up, not after the verdict', () => {
  for (const t of SIGMA_TYPES_IN_PRIORITY_ORDER) {
    assert.ok(!SIGMA_TYPE_META[t].label.toLowerCase().includes('brilliant'));
  }
});

/* ── One test per type ──────────────────────────────────────────────────
   Each case plays a piece onto e4, next to the black king on d4, where it is
   simply hanging. Note this module only answers "which piece was given up" —
   whether the move is brilliant at all is reviewClassify's job, upstream. */

for (const { name, piece, from, san, type } of SACRIFICE_CASES) {
  test(name, () => {
    const fen = hangingPieceFen(piece, from);
    assert.strictEqual(typeOf(fen, san), type);
  });
}

test('a genuine queen sacrifice is recognised through the moved piece', () => {
  /* Qe4+ is check and the queen is undefended, so Kxe4 wins a queen outright. */
  const fen = hangingPieceFen('q', 'e2');
  const g = new Chess(fen);
  assert.ok(
    g.moves({ verbose: true }).some((m) => bare(m.san) === 'Qe4'),
    'Qe4 must be legal in the fixture'
  );
  assert.strictEqual(
    classifySigmaFromPly({ fenBefore: fen, moveSan: 'Qe4+', isSigma: true })?.type,
    SIGMA_TYPE.QUEEN
  );
});

test('Underpromotion — a pawn promoting to a knight', () => {
  /* Black king a8, white pawn b7, white king h1. */
  const fen = 'k7/1P6/8/8/8/8/8/7K w - - 0 1';
  assert.strictEqual(typeOf(fen, 'b8=N'), SIGMA_TYPE.UNDERPROMOTION);
});

test('every promotion piece except the queen counts as underpromotion', () => {
  const fen = 'k7/1P6/8/8/8/8/8/7K w - - 0 1';
  /* chess.js PARSES promotion SAN case-insensitively but REPORTS it uppercased,
     so the fixture has to use the uppercase form or the legality check fails. */
  for (const promo of ['N', 'R', 'B']) {
    assert.strictEqual(typeOf(fen, `b8=${promo}`), SIGMA_TYPE.UNDERPROMOTION,
      `${promo} promotion must be an underpromotion`);
  }
});

test('promoting to a QUEEN is not an underpromotion', () => {
  /* The obvious promotion gives nothing away, so it is not a Sigma at all —
     importantly it is NOT mislabelled an underpromotion. */
  const fen = 'k7/1P6/8/8/8/8/8/7K w - - 0 1';
  assert.notStrictEqual(typeOf(fen, 'b8=Q'), SIGMA_TYPE.UNDERPROMOTION);
});

/* ── Highest-value-piece rule ─────────────────────────────────────────────*/

test('when several pieces are given away, the highest values one names the move', () => {
  assert.strictEqual(
    classifySigmaType({ move: { piece: 'n', promotion: null }, exposed: ['n', 'b'] }),
    SIGMA_TYPE.BISHOP
  );
});

test('a queen is named ahead of any other sacrifice', () => {
  assert.strictEqual(
    classifySigmaType({ move: { piece: 'r', promotion: null }, exposed: ['q', 'b', 'n'] }),
    SIGMA_TYPE.QUEEN
  );
});

test('the moved piece competes with the exposed pieces, not just alongside', () => {
  /* A knight moves while a rook is left hanging — the rook must name the move. */
  assert.strictEqual(
    classifySigmaType({ move: { piece: 'n', promotion: null }, exposed: ['r'] }),
    SIGMA_TYPE.ROOK
  );
});

test('a pawn is never a sacrifice type', () => {
  /* A pawn is not a type, so a move that only gives away a pawn is not a Sigma.
     Note "gives nothing back" is spelled undefined below — see the separate
     test that pins that, because callers must handle it. */
  assert.ok(!classifySigmaType({ move: { piece: 'p', promotion: null }, exposed: ['p'] }),
    'a move that only gives away a pawn is not a Sigma');
  assert.ok(!classifySigmaType({ move: { piece: 'n', promotion: null }, exposed: ['p'] }),
    'exposing only a pawn is not enough');
  assert.strictEqual(
    classifySigmaType({ move: { piece: 'n', promotion: null }, exposed: ['n', 'p'] }),
    SIGMA_TYPE.KNIGHT,
    'a knight still counts when a pawn is given away alongside it'
  );
});

test('bishop outranks knight on the standard material scale', () => {
  assert.ok(PIECE_VALUE.b > PIECE_VALUE.n);
  /* Pawns sit at the threshold and are excluded by the strict comparison. */
  assert.strictEqual(MIN_SACRIFICE_VALUE, PIECE_VALUE.p);
  for (const piece of ['q', 'r', 'b', 'n']) {
    assert.ok(PIECE_VALUE[piece] > MIN_SACRIFICE_VALUE,
      `${piece} must be sacrifice-eligible`);
  }
});

/* ── False positives ──────────────────────────────────────────────────────*/

test('a plain recapture is not a sacrifice', () => {
  /* After 1.e4 e5 2.Nf3 Nf6 3.Nxe5 the knight simply takes and is safe: the
     defender recaptures onto a defended square, so nothing was given away. This is
     the false positive that must never be labelled a sacrifice. */
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 2';
  const probe = new Chess(fen);
  assert.ok(probe.moves({ verbose: true }).some((m) => m.san === 'Nxe5'));
  const got = classifySigmaFromPly({ fenBefore: fen, moveSan: 'Nxe5', isSigma: true });
  assert.ok(!got || got.type !== SIGMA_TYPE.KNIGHT,
    `a clean recapture must not be a Knight Sacrifice (got ${got && got.type})`);
});

test('a queen that is attacked but properly defended is not a sacrifice', () => {
  /* White Qa4 attacked by the b5 pawn. Two rooks reach it — c4 along the rank,
     a2 up the file — so taking the queen loses two rooks. Never worth it. */
  const safe = '7k/8/8/1p6/Q1R5/8/R7/7K w - - 0 1';
  assert.ok(!collectExposedPieces(safe, 'w').includes('q'),
    'a twice-rook-covered queen is not a sacrifice');

  /* Same attack, ONE rook. Black takes and loses only a rook, so the queen IS
     given away — a defender being present is not the same as the defender being
     able to save it. (The second rook in the fixture above has to actually
     REACH a4; stacked rooks on one rank or file do not, the near one blocks the
     far one.) */
  const thinlyDefended = '7k/8/8/1p6/Q1R5/8/8/7K w - - 0 1';
  assert.ok(collectExposedPieces(thinlyDefended, 'w').includes('q'),
    'a queen covered by a single rook is still given away');

  /* A bishop covering it is worse still — this is the shape of real game 91626,
     where the black rook on c6 was covered only by Bd5. */
  const bishopOnly = '7k/8/8/1p6/Q7/1B6/8/7K w - - 0 1';
  assert.ok(collectExposedPieces(bishopOnly, 'w').includes('q'));
});

test('a queen defended only by the king counts as given away', () => {
  /* Nothing can actually save the queen, so Black simply takes it. */
  const fen = '7k/8/8/8/8/3p4/4Q3/4K3 w - - 0 1';
  assert.ok(collectExposedPieces(fen, 'w').includes('q'));
});

test('a move that is not a Sigma is never classified, whatever it attacks', () => {
  assert.strictEqual(
    classifySigmaFromPly({ fenBefore: hangingPieceFen('q','e2'), moveSan: 'Qe7+', isSigma: false }),
    null,
    'the verdict gate must be honoured — otherwise every queen move becomes a Sigma'
  );
});

test('an illegal SAN yields null instead of throwing', () => {
  assert.strictEqual(classifySigmaFromPly({ fenBefore: START, moveSan: 'Qz9z9' }), null);
  assert.strictEqual(classifySigmaFromPly({ fenBefore: 'not a fen', moveSan: 'e4' }), null);
  assert.strictEqual(classifySigmaFromPly({ fenBefore: START, moveSan: '' }), null);
  assert.strictEqual(classifySigmaFromPly({}), null);
});

test('a missing move yields null', () => {
  assert.strictEqual(classifySigmaType({}), null);
  assert.strictEqual(classifySigmaType({ move: null }), null);
});

test('every classified type is one of the five, and carries its squares', () => {
  /* A typo'd type would render an empty filter chip and an undrawable move. */
  for (const fen of [START, hangingPieceFen('q','e2'), 'k7/1P6/8/8/8/8/8/7K w - - 0 1']) {
    for (const m of new Chess(fen).moves({ verbose: true })) {
      const got = classifySigmaFromPly({ fenBefore: fen, moveSan: m.san, isSigma: true });
      if (!got) continue;
      assert.ok(SIGMA_TYPES_IN_PRIORITY_ORDER.includes(got.type), `unexpected type ${got.type}`);
      assert.match(got.fromSquare, /^[a-h][1-8]$/);
      assert.match(got.toSquare, /^[a-h][1-8]$/);
    }
  }
});

/* ── Real positions, from the stored reviews ─────────────────────────────────
   Taken verbatim from games the engine had already judged brilliant. An earlier
   "defender worth under half the piece" rule refused to name two of these, which
   is how the drift was found: the classifier disagreed with the verdict it is
   supposed to describe. */

test('real brilliant move — Qxf2, a queen defended only by a rook', () => {
  /* Game 88854, ply 55. Black's queen takes f2, covered by the rook on f5 while
     the white queen on e3 digs in. Queen-for-rook is a clear loss. */
  const fen = '8/pp2n1rk/2p4p/2n2rpP/2P5/4Q3/PP3Pq1/2KR3R b - - 2 28';
  assert.strictEqual(
    classifySigmaFromPly({ fenBefore: fen, moveSan: 'Qxf2', isSigma: true })?.type,
    SIGMA_TYPE.QUEEN
  );
});

test('real brilliant move — Rxc6, a rook defended only by a bishop', () => {
  /* Game 91626, ply 91. Black's rook takes c6, defended by the bishop on d5 and
     attacked by the rook on b6. Rook-for-bishop is a loss. */
  const fen = '8/5pk1/1RP2pp1/3b4/2r5/3K4/8/8 b - - 6 46';
  assert.strictEqual(
    classifySigmaFromPly({ fenBefore: fen, moveSan: 'Rxc6', isSigma: true })?.type,
    SIGMA_TYPE.ROOK
  );
});

test('real brilliant move — Bxb7, a genuinely undefended bishop', () => {
  /* Game 33810, ply 50. The bishop simply hangs — the straightforward case. */
  const fen = '1k6/ppp2p2/2B5/2q1p3/Q7/2P4P/2Pr1PP1/R5K1 w - - 1 26';
  assert.strictEqual(
    classifySigmaFromPly({ fenBefore: fen, moveSan: 'Bxb7', isSigma: true })?.type,
    SIGMA_TYPE.BISHOP
  );
});

test('those real moves are legal and are captures', () => {
  /* The FENs are hand-copied out of a database dump, so each is proved legal
     rather than trusted — an illegal fixture fails for a reason that has nothing
     to do with classification. They are all captures, which is what makes them
     exchange sacrifices rather than loose offers. */
  const cases = [
    ['8/pp2n1rk/2p4p/2n2rpP/2P5/4Q3/PP3Pq1/2KR3R b - - 2 28', 'Qxf2', 'q'],
    ['8/5pk1/1RP2pp1/3b4/2r5/3K4/8/8 b - - 6 46', 'Rxc6', 'r'],
    ['1k6/ppp2p2/2B5/2q1p3/Q7/2P4P/2Pr1PP1/R5K1 w - - 1 26', 'Bxb7', 'b'],
  ];
  for (const [fen, san, piece] of cases) {
    const mv = new Chess(fen).moves({ verbose: true }).find((m) => bare(m.san) === bare(san));
    assert.ok(mv, `${san} must be legal in ${fen}`);
    assert.equal(mv.piece, piece);
    assert.ok(mv.captured, `${san} must be a capture`);
  }
});

/* ── Exposed-piece detection ──────────────────────────────────────────────*/

test('an undefended piece on an open file is reported', () => {
  /* White Ra1 and black Ra8 on a clear file: the rook can be taken for nothing. */
  const fen = 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  const exposed = collectExposedPieces(fen, 'w');
  assert.ok(exposed.includes('r'), 'the hanging rook should be reported');
});

test('exposed pieces come back most valuable first', () => {
  const fen = 'q3k3/8/8/8/8/8/8/Q3K3 w - - 0 1';
  const exposed = collectExposedPieces(fen, 'w');
  for (let i = 1; i < exposed.length; i += 1) {
    assert.ok(PIECE_VALUE[exposed[i - 1]] >= PIECE_VALUE[exposed[i]],
      'exposed pieces must be sorted by value');
  }
});

test('pawns and kings are never reported as exposed sacrifices', () => {
  /* The start position: pawns everywhere, none of them a sacrifice. */
  const exposed = collectExposedPieces(START, 'w');
  assert.ok(!exposed.includes('p'), 'a pawn is not a sacrifice');
  assert.ok(!exposed.includes('k'), 'a king is not a sacrifice');
});

test('nothing is exposed in the starting position', () => {
  assert.deepStrictEqual(collectExposedPieces(START, 'w'), []);
  assert.deepStrictEqual(collectExposedPieces(START, 'b'), []);
});

test('a malformed FEN yields no exposed pieces rather than throwing', () => {
  assert.deepStrictEqual(collectExposedPieces('garbage', 'w'), []);
});

/* ── Naming: Sigma, and the legacy verdict ────────────────────────────────*/

test('the verdict is Sigma, with the old id still readable', () => {
  assert.strictEqual(SIGMA_VERDICT, 'sigma');
  assert.strictEqual(LEGACY_SIGMA_VERDICT, 'brilliant');

  assert.strictEqual(isSigmaVerdict('sigma'), true);
  assert.strictEqual(isSigmaVerdict('brilliant'), true, 'analysis saved before the rename must keep working');
  assert.strictEqual(isSigmaVerdict('best'), false);
  assert.strictEqual(isSigmaVerdict('blunder'), false);
  assert.strictEqual(isSigmaVerdict(null), false);
});

test('a legacy verdict normalises, so old rows are not double-counted', () => {
  assert.strictEqual(normaliseVerdict('brilliant'), 'sigma');
  assert.strictEqual(normaliseVerdict('sigma'), 'sigma');
  assert.strictEqual(normaliseVerdict('mistake'), 'mistake');
});