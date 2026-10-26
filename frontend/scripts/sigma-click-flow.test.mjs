/* ──────────────────────────────────────────────────────────────────────────
 * Clicking a Brilliant Move must ALWAYS produce a visible card.
 *
 * The bug these guard against was architectural, not a typo: the parent awaited
 * the game fetch and only mounted the card on success, so every failure path
 * (game no longer in history, offline, gated endpoint) left the screen
 * completely unchanged and the click looked inert. The card now opens first and
 * resolves the game itself, showing loading and error states.
 *
 * Static wiring assertions plus real behaviour for the resolution/ply logic.
 *
 * Run: node --test scripts/sigma-click-flow.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { plyToMoveIndex } from '../src/utils/sigmaDisplay.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SIGMA = read('src/components/SigmaMoves.jsx');
const CARD = read('src/components/GameViewerCard.jsx');
const REVIEW = read('src/pages/GameReview.jsx');

/* ── A: a click handler exists and is wired ──────────────────────────────── */

test('every Brilliant card has a click handler that opens the game', () => {
  assert.match(SIGMA, /className="gr-sigma-card"[\s\S]{0,900}?onClick=\{\(\) => onOpenGame && onOpenGame\(m, \{ moveIndex: plyToMoveIndex\(m\.ply\) \}\)\}/,
    'the card is clickable and forwards the stored row plus the converted move index');
  /* Not hardcoded to any particular game or move. */
  assert.doesNotMatch(SIGMA, /Bxh2|Bxg3/);
  assert.doesNotMatch(SIGMA, /May 18|Aug 1/);
});

test('the only field read for navigation is the canonical ply', () => {
  /* The previous bug passed `m.moveCount`, which the API row does not carry. */
  /* The prose may name it; what must not exist is it being PASSED. */
  assert.doesNotMatch(SIGMA, /plyToMoveIndex\(m\.ply,\s*m\.moveCount\)/);
  assert.doesNotMatch(REVIEW, /m\.moveCount/);
  /* The card derives its own move count from the parsed PGN; the sigma row never
     carried one and it must not be asked for. */
  assert.doesNotMatch(CARD, /props\.moveCount/);
  assert.match(CARD, /const moveCount = Math\.ceil\(parsed\.moves\.length \/ 2\)/,
    'the count comes from the loaded PGN, not from the row');
  assert.match(SIGMA, /plyToMoveIndex\(m\.ply\)/, 'the ply is the input');
});

/* ── B/C/D/E/L/M: the click resolves the game and keeps the move ─────────── */

test('the card opens from a game REFERENCE, before the game is loaded', () => {
  /* The essence of the fix: no await between the click and the card. */
  assert.match(CARD, /gameRef = null/);
  assert.match(CARD, /resolveGame = null/);
  assert.match(CARD, /loadState === 'loading'/, 'it renders a loading state');
  assert.match(CARD, /loadState === 'error'/, 'and an error state');
  /* It resolves the game itself, from the reference. */
  assert.match(CARD, /resolveGame\(gameRef\)/);
});

test('the parent opens synchronously — no awaited fetch before mounting', () => {
  assert.match(REVIEW, /function openSigmaGame\(move, nav\) \{[\s\S]{0,400}?setSigmaGame\(\{/,
    'openSigmaGame sets state immediately');
  assert.doesNotMatch(REVIEW, /async function openSigmaGame/,
    'the click handler is not async — that was the silent-failure cause');
  assert.match(REVIEW, /<GameViewerCard[\s\S]{0,300}?gameRef=\{sigmaGame\.ref\}/,
    'the card receives the reference, not a preloaded game');
  assert.match(REVIEW, /resolveGame=\{resolveSigmaGame\}/);
});

test('the canonical game identifier is the stored (source, id) pair', () => {
  /* The rules live in utils/gameIdentity so they are testable without a server;
     the page only supplies the app's existing loaders. */
  const IDENTITY = read('src/utils/gameIdentity.js');
  assert.match(REVIEW, /const ref = sigmaGameRef\(move\)/);
  assert.match(REVIEW, /fetchProfileGame: fetchGame/, 'the same loader Chess Profile uses');
  assert.match(REVIEW, /fetchHistory: \(\) => api\.get\('\/game-history'/);
  assert.match(IDENTITY, /return \{ gameSource: String\(row\.gameSource\), gameId: row\.gameId \};/,
    'identity is (game_source, game_id) — never the sigma record id');
  assert.match(IDENTITY, /`\$\{gameSource\}_\$\{gameId\}`/, 'history key');
  /* Identity is NEVER derived from display data. (toCardGame legitimately copies
     player names into the card — that is presentation, not lookup.) */
  const identityFns = IDENTITY.slice(IDENTITY.indexOf('export function sigmaGameRef'),
    IDENTITY.indexOf('/** A history row'));
  assert.doesNotMatch(identityFns, /moveNumber|moveSan|whiteName|blackName|opening|date/);
  const searchFns = IDENTITY.slice(IDENTITY.indexOf('export function findHistoryGame'));
  assert.doesNotMatch(searchFns.slice(0, searchFns.indexOf('/**')),
    /whiteName|blackName|opening|moveSan|moveNumber/,
    'the history matcher keys on ids only');
});

/* ── F/G/H/I/J: the card's content comes from the shared implementation ───── */

test('the opened card is the SAME component Chess Profile uses', () => {
  assert.match(CARD, /export default function GameViewerCard/);
  assert.match(read('src/pages/ChessProfile.jsx'), /import GameViewerCard from '\.\.\/components\/GameViewerCard'/);
  assert.match(REVIEW, /import GameViewerCard from '\.\.\/components\/GameViewerCard'/);
  /* Full game content, not a single-move view. */
  assert.match(CARD, /cp-score/);
  assert.match(CARD, /reviewMetaFor\(curVerdict\)/, 'canonical badge/colour mapping');
  assert.match(CARD, /moveBadge=\{moveBadge\}/, 'the Brilliant badge renders');
  assert.match(CARD, /analyzeCanonical/, 'canonical analysis, no local classifier');
});

test('the board is established at the requested move index', () => {
  assert.match(CARD, /initialMoveIndex/);
  assert.match(CARD, /go\(startIndex, false\)/);
  /* …and the position is rebuilt FROM that many moves, i.e. AFTER the move. */
  assert.match(CARD, /for \(let i = 0; i < target; i\+\+\) \{\s*\n\s*try \{ g\.move\(parsed\.moves\[i\]\)/,
    'target moves are replayed, so the selected move is already played');
  assert.match(CARD, /Math\.max\(0, Math\.min\(n, i\)\)/, 'clamped to the real move list');
});

/* ── O: unknown move count must not collapse the ply ─────────────────────── */

test('an unknown move total never collapses the selected ply to zero', () => {
  for (const unknown of [undefined, null, 0, NaN]) {
    assert.equal(plyToMoveIndex(49, unknown), 50, `${String(unknown)} → 50`);
  }
  assert.equal(plyToMoveIndex(14, undefined), 15, '15. Bxh2-style ply 14 → 15');
  assert.equal(plyToMoveIndex(0, undefined), 1);
});

test('the converted index really lands on the position AFTER the move', () => {
  const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'O-O', 'Nf6', 'Nc3', 'b6',
    'd3', 'Bb7', 'Be3', 'Be7', 'h3', 'Nd4', 'Nxd4', 'exd4', 'Bxd4', 'c5', 'Be3',
    'd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd5', 'Bb5+', 'Kf8', 'c4', 'Be6', 'Qd2', 'a6',
    'Ba4', 'Bd6', 'Rad1', 'g5', 'Rfe1', 'Rg8', 'Re2', 'Ke7', 'Rde1', 'Qc7', 'Qc3',
    'g4', 'hxg4', 'Rxg4', 'Bxh6', 'Rag8', 'g3', 'Bxg3'];
  const ply = SANS.length - 1;
  const g = new Chess();
  for (const san of SANS.slice(0, plyToMoveIndex(ply, SANS.length))) g.move(san);
  assert.equal(g.get('g3')?.type, 'b', 'the sacrificed bishop is on g3 — move already played');
  assert.equal(g.get('d6'), undefined);
  /* A custom-FEN game starts from its own origin, not the standard position. */
  const custom = new Chess('4k3/8/8/8/8/5p2/8/4K3 b - - 0 1');
  assert.equal(custom.turn(), 'b');
});

/* ── I: two different games never share the opened card ──────────────────── */

test('each Brilliant opens its own game — the card key carries source, id and ply', () => {
  assert.match(REVIEW, /key=\{sigmaGame\.key\}/);
  assert.match(REVIEW, /key: `\$\{ref\.gameSource\}:\$\{ref\.gameId\}:\$\{move\.ply\}`/,
    'source+id+ply, so a second brilliant remounts on its own game/move');
});

/* ── no analysis logic moved ────────────────────────────────────────────── */

test('no analysis or classification code was touched', () => {
  for (const forbidden of ['reviewGame', 'classifyMove', 'brilliantGates',
    'sacrificeCandidate', 'settledNetSacrifice', 'engineOverrides']) {
    assert.doesNotMatch(CARD, new RegExp(`\\b${forbidden}\\b`), `card must not reference ${forbidden}`);
    assert.doesNotMatch(SIGMA, new RegExp(`\\b${forbidden}\\b`), `list must not reference ${forbidden}`);
  }
  assert.match(CARD, /analyzeCanonical/, 'it still goes through the canonical entry point');
});