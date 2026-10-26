/* ──────────────────────────────────────────────────────────────────────────
 * The contract between the server's stored analysis and the client's cache.
 *
 * The regression: the server returned `{ data: envelope, created_at }` while
 * the canonical layer validates the ENVELOPE. A wrapped envelope has no
 * `analysisVersion`, so every persistent lookup was a MISS and Stockfish
 * re-ran the whole review on every open of an already-reviewed game - with a
 * complete analysis sitting in the database the whole time.
 *
 * These tests pin the shape end to end: what the server sends, what the client
 * reads out of it, and that the result is accepted by the ONE validator
 * (canonicalAnalysis.isValidCanonicalAnalysis) — including the null
 * accuracies a book move really carries.
 *
 * Run: node --test scripts/analysis-store-contract.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  isValidCanonicalAnalysis,
  hasAnalysisShape,
  movesFingerprint,
  CANONICAL_ANALYSIS_VERSION,
  ANALYSIS_SCHEMA_VERSION,
} from '../src/utils/canonicalAnalysis.js';
import { unwrapAnalysisEnvelope } from '../src/utils/analysisEnvelope.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SERVICE = read('src/services/chessProfiles.js');
const REVIEW = read('src/pages/GameReview.jsx');
const CARD = read('src/components/GameViewerCard.jsx');
const PROFILE = read('src/pages/ChessProfile.jsx');
const RUNNER = read('src/utils/reviewRunner.js');

/* A realistic canonical review: 94 plies of a real game, with the nulls the
   engine genuinely produces (acc: null for a book move, and null metrics for a
   row it could not score), plus a brilliant move with its Sigma payload. */
function realisticEnvelope() {
  const moves = [];
  for (let i = 0; i < 94; i += 1) {
    const isBook = i < 8;
    moves.push({
      ply: i,
      player: i % 2 ? 'b' : 'w',
      san: `m${i}`,
      uci: `e2e${(i % 8) + 1}`,
      verdict: isBook ? 'book' : 'good',
      cpl: 0,
      loss: isBook ? 0 : null,
      swing: isBook ? 0 : null,
      wpd: isBook ? 0 : null,
      acc: isBook ? null : 92.5,
      best: isBook ? 20 : null,
      played: isBook ? 20 : null,
      bestUci: `e2e${(i % 8) + 1}`,
      bestSan: `m${i}`,
      forced: false,
      sacrifice: false,
      sacrificeProtected: false,
      sigma: null,
      lines: [],
    });
  }
  /* One brilliant move, with the Sigma payload the UI reads. */
  moves[42] = {
    ...moves[42],
    verdict: 'sigma',
    acc: 100,
    loss: 0,
    sigma: {
      type: 'queen_sacrifice', label: 'Queen Sacrifice', piece: 'q',
      rank: 1, fromSquare: 'd1', toSquare: 'h5',
    },
  };
  return {
    gameSource: 'chess_profile',
    gameId: 101860,
    initialFen: 'start',
    moveCount: 94,
    analysisVersion: CANONICAL_ANALYSIS_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analysis: {
      initialFen: 'start',
      moves,
      white: { accuracy: 93.4, counts: { brilliant: 1 } },
      black: { accuracy: 88.9, counts: { brilliant: 0 } },
    },
  };
}

const GAME = { gameSource: 'chess_profile', gameId: 101860, initialFen: 'start', moves: Array.from({ length: 94 }, (_, i) => `m${i}`) };

/* ── the shape the server sends ───────────────────────────────────────────── */

test('the envelope the server sends is accepted by the one validator', () => {
  const envelope = realisticEnvelope();
  assert.equal(isValidCanonicalAnalysis(envelope, GAME), true,
    'a stored analysis must validate, or the engine re-runs on every open');
});

test('a wrapped envelope is NOT accepted - which is why it must not be sent', () => {
  const wrapped = { data: realisticEnvelope(), created_at: '2026-01-01T00:00:00.000Z' };
  assert.equal(isValidCanonicalAnalysis(wrapped, GAME), false,
    'this is the exact shape that caused the permanent cache miss');
});

test('the client unwraps both shapes into the same envelope', () => {
  const envelope = realisticEnvelope();
  const direct = unwrapAnalysisEnvelope({ ...envelope, created_at: 'x' });
  const wrapped = unwrapAnalysisEnvelope({ data: envelope, created_at: 'x' });
  assert.equal(isValidCanonicalAnalysis(direct, GAME), true);
  assert.equal(isValidCanonicalAnalysis(wrapped, GAME), true);
  assert.deepEqual(wrapped.analysis.moves, envelope.analysis.moves,
    'both shapes must yield the same review');
});

test('an empty or unknown payload never becomes an answer', () => {
  assert.equal(unwrapAnalysisEnvelope(null), null);
  assert.equal(unwrapAnalysisEnvelope(undefined), null);
  assert.equal(unwrapAnalysisEnvelope(''), null);
  /* An unknown shape is passed through untouched: the validator, not the
     transport, decides what may be reused. */
  const junk = { something: 'else' };
  assert.equal(unwrapAnalysisEnvelope(junk), junk);
  assert.equal(isValidCanonicalAnalysis(junk, GAME), false);
});

/* ── the null-accuracy rule ───────────────────────────────────────────────── */

test('null accuracies are valid, absent metrics are not', () => {
  const envelope = realisticEnvelope();
  assert.equal(hasAnalysisShape(envelope.analysis), true,
    'a book move (acc: null) and an unscored row (loss: null) are valid');
  const noAcc = realisticEnvelope();
  delete noAcc.analysis.moves[0].acc;
  assert.equal(hasAnalysisShape(noAcc.analysis), false,
    'a MISSING field is corruption and must be rejected');
});

/* ── the classifications survive the round trip ──────────────────────────── */

test('the Sigma payload and every verdict survive the round trip', () => {
  const envelope = realisticEnvelope();
  const read = unwrapAnalysisEnvelope({ data: envelope });
  const rows = read.analysis.moves;
  assert.equal(rows.length, 94, 'every move is stored, not just a summary');
  assert.equal(rows.filter((r) => r.verdict === 'sigma').length, 1);
  assert.deepEqual(rows[42].sigma, envelope.analysis.moves[42].sigma,
    'the brilliant move keeps its Sigma type, label and squares');
  assert.equal(rows[42].verdict, 'sigma');
  assert.equal(read.analysis.white.counts.brilliant, 1);
  assert.equal(read.analysis.black.accuracy, 88.9);
});

/* ── the wiring: who loads, who saves ────────────────────────────────────── */

test('the service reads the stored analysis and writes it back', () => {
  assert.match(SERVICE, /export async function fetchAnalysis\(id\)/);
  assert.match(SERVICE, /unwrapAnalysisEnvelope\(res\.data\)/);
  assert.match(SERVICE, /api\.post\(`\/chess-profiles\/games\/\$\{id\}\/analysis`, data\)/,
    'the complete envelope must be persisted');
});

test('the game card loads the stored analysis on open and saves what it analyses', () => {
  assert.match(CARD, /reuseOnly: true, loadAnalysis/,
    'opening a card must look in the store and must NOT start engine work');
  assert.match(CARD, /force: true, loadAnalysis, saveAnalysis/,
    'an explicit analysis must be persisted');
});

test('the review page passes both the loader and the saver', () => {
  assert.match(REVIEW, /loadAnalysis: fetchAnalysis, saveAnalysis/,
    'the review page must reuse the stored analysis AND persist a new one');
});

test('the profile page passes both the loader and the saver', () => {
  assert.match(PROFILE, /loadAnalysis=\{fetchAnalysis\}/);
  assert.match(PROFILE, /saveAnalysis=\{saveAnalysis\}/);
});

test('the review runner goes through the canonical layer', () => {
  assert.match(RUNNER, /getCanonicalAnalysis\(/);
  assert.match(RUNNER, /analysisStore/,
    'the runner must forward the caller\'s persistence');
});

/* ── a cached review must not wait for the engine ────────────────────────── */

test('the review page does not block the cache lookup on the engine boot', () => {
  /* The engine warm-up used to be AWAITED before the review started, so a
     cached analysis could not appear until Stockfish had booted. */
  assert.doesNotMatch(REVIEW, /await warmReviewEngine\(\)/,
    'the cached path must not wait for the engine');
  assert.match(REVIEW, /warmReviewEngine\(\)\.catch/,
    'the engine is still warmed, in the background');
  /* The page asks the runner, and the runner asks the canonical layer - the
     one place that decides between the cache and the engine. */
  assert.match(REVIEW, /startReview\(id, init, san, \{ gameRef: gameRefArg, analysisStore \}\)/,
    'the review must be started with the game identity and the store');
  assert.match(RUNNER, /await getCanonicalAnalysis\(/,
    'the runner must go through the canonical layer');
});

/* ── the cached path is cheap ─────────────────────────────────────────────── */

test('validating a 94-move stored analysis is fast enough to be invisible', () => {
  const envelope = realisticEnvelope();
  const started = Date.now();
  for (let i = 0; i < 20; i += 1) isValidCanonicalAnalysis(envelope, GAME);
  const each = (Date.now() - started) / 20;
  assert.ok(each < 50, `validating a stored review took ${each.toFixed(1)}ms`);
});

/* ── a changed game invalidates the stored review ────────────────────────── */

test('a game whose MOVES changed is not served the old verdicts', () => {
  const envelope = realisticEnvelope();
  assert.equal(isValidCanonicalAnalysis(envelope, GAME), true, 'the same game validates');
  /* Same number of moves, different moves: a re-synced or edited game. The
     move COUNT alone would not notice this. */
  const edited = GAME.moves.map((m, i) => (i === 10 ? 'zz9' : m));
  assert.equal(edited.length, GAME.moves.length, 'the length is unchanged on purpose');
  assert.equal(isValidCanonicalAnalysis(envelope, { ...GAME, moves: edited }), false,
    'a changed PGN must invalidate the stored analysis');
});

test('a game with a different move COUNT is not served the old verdicts', () => {
  const envelope = realisticEnvelope();
  assert.equal(isValidCanonicalAnalysis(envelope, { ...GAME, moves: [...GAME.moves, 'm94'] }), false);
});

test('the fingerprint is stable, cheap and order sensitive', () => {
  assert.equal(movesFingerprint(['e4', 'e5']), movesFingerprint(['e4', 'e5']));
  assert.notEqual(movesFingerprint(['e4', 'e5']), movesFingerprint(['e5', 'e4']));
  assert.notEqual(movesFingerprint(['ab', 'c']), movesFingerprint(['a', 'bc']));
  assert.equal(movesFingerprint(null), null);
});

test('a stored analysis is compared by its own move list', () => {
  /* The stored rows carry the SAN of every graded move, so the comparison
     needs no extra column — and the games already in the database stay valid. */
  const envelope = realisticEnvelope();
  assert.equal(envelope.analysis.moves[0].san, GAME.moves[0]);
  assert.equal(movesFingerprint(envelope.analysis.moves.map((r) => r.san)),
    movesFingerprint(GAME.moves));
});
