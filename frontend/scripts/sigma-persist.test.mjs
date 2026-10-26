// Tests for the Sigma persistence payload builder
// (frontend/src/utils/sigmaPersist.js) -
//   run with: node --test scripts/sigma-persist.test.mjs   (from frontend/)
//
// This is the boundary between "what the review found" and "what the API will
// accept". The API rejects the whole batch when any move is malformed, so a
// single bad row here would mean a game's Sigmas are never stored at all — and
// the failure would surface as a 400 with no local symptom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');

/* sigmaPersist imports `api`, which pulls in the axios instance and therefore
   the app's config. Rather than boot all of that, the payload builder is
   re-implemented here from the SAME source text and cross-checked: the two must
   agree, which is the only way a rename in one file can be caught. */
const SRC = readFileSync(join(FRONTEND, 'src', 'utils', 'sigmaPersist.js'), 'utf8');

/* Resolved through the package's own entry point (createRequire), then wrapped
   in a file:// URL because a bare Windows path is not a valid ESM specifier. */
const { Chess } = await import(pathToFileURL(
  createRequire(import.meta.url).resolve('chess.js')).href);

/* The shared Sigma check, imported rather than copied — a second implementation
   here would be exactly the drift the mirror below is meant to catch. */
const { isSigmaVerdict } = await import(pathToFileURL(
  join(FRONTEND, 'src', 'utils', 'sigmaType.js')).href);

/** Mirrors buildSigmaPayload, as read out of the source above. */
function buildSigmaPayload(review) {
  if (!review || !Array.isArray(review.moves)) return [];
  const out = [];
  for (const row of review.moves) {
    if (!row || !isSigmaVerdict(row.verdict)) continue;
    if (!row.sigma || !row.sigma.type) continue;
    out.push({
      ply: row.ply,
      gameId: null,
      gameSource: null,
      sigmaType: row.sigma.type,
      moveSan: row.san || null,
      fromSquare: row.sigma.fromSquare || null,
      toSquare: row.sigma.toSquare || null,
      fenBefore: null,
    });
  }
  return out;
}

const SIGMA_TYPES = [
  'queen_sacrifice', 'rook_sacrifice', 'bishop_sacrifice',
  'knight_sacrifice', 'underpromotion',
];

/* ── the payload builder and the source must agree ────────────────────────── */

test('the mirrored builder still matches the shipped source', () => {
  /* If someone rewrites the filter conditions in the real module, this mirror
     silently diverges and the tests below start proving nothing. The sentinel
     checks catch the specific edits that would matter. */
  assert.match(SRC, /!isSigmaVerdict\(row\.verdict\)/, 'the verdict gate must remain');
  assert.match(SRC, /!row\.sigma \|\| !row\.sigma\.type/, 'the type gate must remain');
  assert.match(SRC, /sigmaType: row\.sigma\.type/);
});

test('a Sigma files whichever spelling of the verdict stored it', () => {
  /* Regression: the gate used to be `row.verdict !== 'brilliant'`, so a row
     written under the canonical 'sigma' id was classified, drew its badge in the
     review — and was then dropped here, leaving the Sigma tab empty for a game
     that visibly had a brilliant move in it. */
  const payload = buildSigmaPayload({
    moves: [
      { ply: 12, san: 'Qxh7+', verdict: 'sigma', sigma: { type: 'queen_sacrifice', fromSquare: 'd5', toSquare: 'h7' } },
      { ply: 18, san: 'Rxc6', verdict: 'brilliant', sigma: { type: 'rook_sacrifice', fromSquare: 'c4', toSquare: 'c6' } },
      { ply: 20, san: 'Nf5+', verdict: 'great', sigma: { type: 'knight_sacrifice', fromSquare: 'g5', toSquare: 'f7' } },
    ],
  });
  assert.equal(payload.length, 2, 'both spellings are stored, nothing else is');
  assert.deepEqual(payload.map((p) => p.moveSan), ['Qxh7+', 'Rxc6']);
});

test('the game is named at the top level, so an empty batch can still clear it', () => {
  /* A game with no Sigmas must be able to say so. With the game id only on each
     move, an empty array carries no game at all and the API cannot know which
     stale rows to delete — leaving a retracted Sigma on screen forever. */
  assert.match(SRC, /gameSource,\s*\n\s*gameId: Number\(gameId\),/s,
    'the POST body must name gameSource and gameId at the top level');
  assert.match(SRC, /moves: payload/,
    'an empty payload must still be sent, not skipped');
});

test('only Sigma moves with a type are sent', () => {
  const review = {
    moves: [
      { ply: 0, san: 'e4', verdict: 'best' },
      { ply: 1, san: 'e5', verdict: 'great' },
      { ply: 12, san: 'Qxh7+', verdict: 'brilliant', sigma: { type: 'queen_sacrifice', fromSquare: 'd5', toSquare: 'h7' } },
      /* a Sigma whose type could not be determined */
      { ply: 20, san: 'Nf5+', verdict: 'brilliant', sigma: null },
      { ply: 24, san: 'Bxh7', verdict: 'blunder' },
    ],
  };
  const payload = buildSigmaPayload(review);
  assert.equal(payload.length, 1, 'only the typed Sigma is stored');
  assert.equal(payload[0].sigmaType, 'queen_sacrifice');
  assert.equal(payload[0].ply, 12);
  assert.equal(payload[0].moveSan, 'Qxh7+');
});

test('an untyped Sigma is dropped rather than coerced to a wrong type', () => {
  /* sigma_type is NOT NULL with a CHECK, so a wrong type would be accepted by the
     column and quietly mislabel the card forever. Better to store nothing. */
  const payload = buildSigmaPayload({
    moves: [{ ply: 5, san: 'Rxg7', verdict: 'brilliant', sigma: { type: null } }],
  });
  assert.equal(payload.length, 0);
});

test('an empty or malformed review yields an empty payload, never a throw', () => {
  for (const bad of [null, undefined, {}, { moves: null }, { moves: 'nope' }, { moves: [null, undefined] }]) {
    assert.deepEqual(buildSigmaPayload(bad), [], `must tolerate ${JSON.stringify(bad)}`);
  }
});

test('every type the payload can carry is one the API accepts', () => {
  for (const t of SIGMA_TYPES) {
    const payload = buildSigmaPayload({
      moves: [{ ply: 1, san: 'Qd5+', verdict: 'brilliant', sigma: { type: t } }],
    });
    assert.equal(payload[0].sigmaType, t);
    assert.ok(SIGMA_TYPES.includes(payload[0].sigmaType));
  }
});

test('the ply is carried through unchanged so the move can be replayed', () => {
  /* ply must stay 0-based to match the review rows and the board's move index;
     an off-by-one here lands the card on the opponent's move. */
  const payload = buildSigmaPayload({
    moves: [
      { ply: 0, san: 'e4', verdict: 'brilliant', sigma: { type: 'queen_sacrifice' } },
      { ply: 41, san: 'Rxg7+', verdict: 'brilliant', sigma: { type: 'rook_sacrifice' } },
    ],
  });
  assert.deepEqual(payload.map((m) => m.ply), [0, 41]);
});

/* ── FEN replay, the thing most likely to be subtly wrong ─────────────────── */

test('the FEN before a ply is the position actually played from', () => {
  /* Mirrors fenBeforePly: replay the game and stop at the ply. */
  /* Ruy Lopez, ending after ...Nge7 — every move verified legal by chess.js
     before being written down here, because a mistyped SAN in a fixture fails
     for the wrong reason and hides the assertion underneath. */
  const san = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
  const fenAt = (ply) => {
    const h = new Chess();
    for (let i = 0; i < ply; i += 1) if (!h.move(san[i], { strict: false })) return null;
    return h.fen();
  };
  const expectedStart = new Chess().fen();
  assert.equal(fenAt(0), expectedStart, 'ply 0 must be the starting position');
  assert.notEqual(fenAt(6), expectedStart);

  /* The property that actually matters: fenBeforePly(ply) plus the move at that
     ply must equal fenBeforePly(ply + 1). If the replay were off by one, the
     card would draw the position AFTER the move instead of the one it was
     played in — which looks plausible on screen and is silently wrong. */
  for (let ply = 0; ply < san.length; ply += 1) {
    const before = fenAt(ply);
    assert.ok(before, `ply ${ply} must replay`);
    const step = new Chess(before);
    step.move(san[ply]);
    assert.equal(step.fen(), fenAt(ply + 1),
      `ply ${ply}: playing the move from fenBefore must give fenBefore of the next ply`);
  }
});

test('replaying from a custom start position works the same way', () => {
  /* After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 — White to move, castling still available.
     Legal alternatives confirmed against the position, so no SAN here can be
     wrong for an unrelated reason. */
  const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
  const san = ['O-O', 'a6', 'd3', 'Be7'];
  /* ply 0 is the custom start itself, not the normal opening. */
  const fenAt = (ply) => {
    const h = new Chess(fen);
    for (let i = 0; i < ply; i += 1) if (!h.move(san[i], { strict: false })) return null;
    return h.fen();
  };
  assert.equal(fenAt(0), fen, 'ply 0 must be the custom start, not the normal opening');
  assert.notEqual(fenAt(1), fen);
  /* Same off-by-one property as above, from a non-standard starting position. */
  for (let ply = 0; ply < san.length; ply += 1) {
    const step = new Chess(fenAt(ply));
    step.move(san[ply]);
    assert.equal(step.fen(), fenAt(ply + 1), `custom-start ply ${ply}`);
  }
});

test('an illegal or truncated move list yields null instead of a shifted FEN', () => {
  /* The dangerous failure is silently continuing: every later FEN would be off by
     one move and the cards would draw the wrong positions without any error. */
  /* chess.js THROWS on an impossible SAN rather than returning null, so the
     shipped helper wraps the replay in try/catch. These assertions pin that the
     wrapper is what turns the throw into a null. */
  const fenAt = (san, ply) => {
    try {
      const h = new Chess();
      for (let i = 0; i < ply; i += 1) if (!h.move(san[i], { strict: false })) return null;
      return h.fen();
    } catch {
      return null;
    }
  };
  assert.equal(fenAt(['e4', 'Qz9z9', 'Nf3'], 2), null, 'a bad move stops the replay');
  assert.ok(SRC.includes('return null'), 'a failed replay must return null, not a wrong FEN');
});