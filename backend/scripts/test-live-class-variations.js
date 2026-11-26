// Tests for the shared classroom variation tree.
//   run from backend/:  node --test scripts/test-live-class-variations.js
//
// The service is pure (chess.js only, no DB, no sockets), so these run offline
// and exercise the real move legality instead of a mock agreeing with itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Chess } = require('chess.js');

const variations = require('../src/services/liveVariationService');

function classGame(sans = ['e4', 'e5', 'Nf3', 'Nc6']) {
  const chess = new Chess();
  sans.forEach((san) => chess.move(san));
  return chess;
}

function play(state, atId, move, chess, baseFen = variations.START_FEN) {
  return variations.playVariationMove(state, atId, move, { chess, baseFen });
}

test('normalizeVariation accepts JSONB strings and drops broken nodes', () => {
  const state = variations.normalizeVariation(JSON.stringify({
    v: 1,
    seq: 4,
    pointer: 'v2',
    nodes: [
      { id: 'v1', parentId: 'm2', san: 'd4', fen: 'fen-a', ply: 3 },
      { id: 'v2', parentId: 'v1', san: 'd5', fen: 'fen-b', ply: 4 },
      { id: 'v3', parentId: 'm2' }, // no san/fen — dropped
      null,
    ],
  }));
  assert.equal(state.seq, 4);
  assert.equal(state.pointer, 'v2');
  assert.deepEqual(state.nodes.map((n) => n.id), ['v1', 'v2']);
  assert.equal(state.nodes[0].uci, null);
});

test('normalizeVariation never throws on garbage', () => {
  assert.deepEqual(variations.normalizeVariation('not json'), variations.emptyVariation());
  assert.deepEqual(variations.normalizeVariation(null), variations.emptyVariation());
  assert.deepEqual(variations.normalizeVariation({ nodes: 'nope' }), variations.emptyVariation());
});

test('mainline ids resolve to the class game position', () => {
  const chess = classGame();
  const state = variations.emptyVariation();

  const root = variations.resolvePosition(state, chess, variations.START_FEN, 'root');
  assert.equal(root.fen, variations.START_FEN);

  const m2 = variations.resolvePosition(state, chess, variations.START_FEN, 'm2');
  const expected = new Chess();
  expected.move('e4');
  expected.move('e5');
  assert.equal(m2.fen, expected.fen());
  assert.equal(m2.ply, 2);

  assert.equal(variations.resolvePosition(state, chess, variations.START_FEN, 'm9'), null,
    'a ply past the game is not a position');
  assert.equal(variations.resolvePosition(state, chess, variations.START_FEN, 'v404'), null);
});

test('a different move at a mainline position becomes a branch beside it', () => {
  const chess = classGame();
  const state = variations.emptyVariation();

  const res = play(state, 'm2', { from: 'd2', to: 'd4' }, chess);
  assert.equal(res.ok, true);
  assert.equal(res.created, true);
  assert.equal(res.node.id, 'v1');
  assert.equal(res.node.parentId, 'm2');
  assert.equal(res.node.san, 'd4');
  assert.equal(res.node.ply, 3);
  assert.equal(res.next.nodes.length, 1);

  /* The class game itself must be untouched by branching. */
  assert.equal(chess.history().join(' '), 'e4 e5 Nf3 Nc6');
});

test('replaying an existing move navigates instead of duplicating it', () => {
  const chess = classGame();
  let state = variations.emptyVariation();

  const first = play(state, 'm2', { from: 'd2', to: 'd4' }, chess);
  state = first.next;

  const again = play(state, 'm2', { from: 'd2', to: 'd4' }, chess);
  assert.equal(again.ok, true);
  assert.equal(again.created, false);
  assert.equal(again.navigateTo, 'v1');
  assert.equal(state.nodes.length, 1);

  const mainline = play(state, 'm2', { from: 'g1', to: 'f3' }, chess);
  assert.equal(mainline.created, false);
  assert.equal(mainline.navigateTo, 'm3', 'the real next move is the mainline child');
});

test('a branch can continue from its own leaf (nested variation)', () => {
  const chess = classGame();
  const first = play(variations.emptyVariation(), 'm2', { from: 'd2', to: 'd4' }, chess);
  const second = play(first.next, 'v1', { from: 'd7', to: 'd5' }, chess);

  assert.equal(second.created, true);
  assert.equal(second.node.id, 'v2');
  assert.equal(second.node.parentId, 'v1');
  assert.equal(second.node.ply, 4);
});

test('illegal moves and stale positions are rejected, not truncated', () => {
  const chess = classGame();
  const state = variations.emptyVariation();

  const illegal = play(state, 'm2', { from: 'd2', to: 'd5' }, chess);
  assert.equal(illegal.ok, false);
  assert.equal(illegal.error, 'Illegal move');

  const stale = play(state, 'm12', { from: 'd2', to: 'd4' }, chess);
  assert.equal(stale.ok, false);

  assert.equal(chess.history().length, 4);
});

test('promotion and castling work inside a variation', () => {
  const promoFen = '8/P7/8/8/8/8/8/K6k w - - 0 1';
  const chess = new Chess();
  const state = variations.emptyVariation();
  const promo = play(state, 'root', { from: 'a7', to: 'a8', promotion: 'q' }, chess, promoFen);
  assert.equal(promo.ok, true);
  assert.equal(promo.node.san, 'a8=Q+');
  assert.equal(promo.node.uci, 'a7a8q');

  const castleFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const castleChess = new Chess();
  const castle = play(variations.emptyVariation(), 'root', { from: 'e1', to: 'g1' }, castleChess, castleFen);
  assert.equal(castle.ok, true);
  assert.equal(castle.node.san, 'O-O');
  assert.equal(castle.node.fen.split(' ')[0], 'r3k2r/8/8/8/8/8/8/R4RK1');
});

test('pointer helpers accept real ids and reject ghosts', () => {
  const chess = classGame();
  const first = play(variations.emptyVariation(), 'm2', { from: 'd2', to: 'd4' }, chess);
  const state = first.next;

  assert.equal(variations.isPointerValid(state, chess, variations.START_FEN, null), true);
  assert.equal(variations.isPointerValid(state, chess, variations.START_FEN, 'm4'), true);
  assert.equal(variations.isPointerValid(state, chess, variations.START_FEN, 'v1'), true);
  assert.equal(variations.isPointerValid(state, chess, variations.START_FEN, 'v9'), false);

  const moved = variations.withPointer(state, 'v1');
  assert.equal(moved.pointer, 'v1');
  assert.equal(variations.withPointer(moved, null).pointer, null);
});

test('toClientState is the shape the browser hydrateTree expects', () => {
  const client = variations.toClientState(
    { v: 1, seq: 2, pointer: 'v1', promotedId: null, nodes: [{ id: 'v1' }] },
    7,
    'free'
  );
  assert.deepEqual(client, {
    v: 1,
    seq: 2,
    pointer: 'v1',
    mode: 'free',
    nodes: [{ id: 'v1' }],
    rev: 7,
  });
  assert.equal(variations.toClientState(variations.emptyVariation(), 0, 'nonsense').mode, 'follow');
});

test('a stored tree survives a JSON round-trip', () => {
  const chess = classGame();
  const first = play(variations.emptyVariation(), 'm2', { from: 'd2', to: 'd4' }, chess);
  const second = play(first.next, 'v1', { from: 'd7', to: 'd5' }, chess);
  const restored = variations.normalizeVariation(JSON.stringify({
    v: 1,
    seq: second.next.seq,
    pointer: 'v1',
    nodes: second.next.nodes,
  }));
  assert.equal(restored.nodes.length, 2);
  assert.equal(restored.seq, 2);
  assert.equal(restored.nodes[1].parentId, 'v1');
});
