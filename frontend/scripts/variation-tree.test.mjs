import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMainline, initialState, playMoveInTree, movePointer, backInTree, toMainline,
  deleteVariationInTree, togglePromotionInTree, resetToMainline, serializeTree, hydrateTree,
  mergeMainline, currentOf, displayIdsOf, siblingInTree, variationCountOf, ROOT_ID,
} from '../src/utils/variationTree.js';

const PGN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'];
const line = (moves) => buildMainline('start', moves);
const play = (state, from, to, promotion) => playMoveInTree(state, { from, to, promotion });

test('mainline is built and never mutated by a deviation', () => {
  const base = line(PGN);
  const state = initialState(base, 'm4'); // after 1.e4 e5 2.Nf3 Nc6
  const before = base.nodes.m4.children.slice();

  const res = play(state, 'f1', 'c4'); // White's mainline 3rd move
  assert.equal(res.created, false);
  assert.equal(res.state.pointer, 'm5');

  const dev = play(backInTree(res.state), 'd2', 'd4'); // a different White 3rd move
  assert.equal(dev.created, true);
  assert.equal(dev.node.san, 'd4');
  assert.equal(dev.node.isMainline, false);
  assert.deepEqual(base.nodes.m4.children, before, 'mainline children untouched');
  assert.equal(base.nodes.m5.san, 'Bc4');
  assert.equal(variationCountOf(dev.state), 1);
});

test('playing an existing variation move navigates instead of duplicating', () => {
  const base = line(PGN);
  let state = initialState(base, 'm2');
  state = play(state, 'd2', 'd4').state;
  const firstId = state.pointer;
  const count = variationCountOf(state);

  state = backInTree(state); // back to m2
  const again = play(state, 'd2', 'd4');
  assert.equal(again.created, false);
  assert.equal(again.state.pointer, firstId);
  assert.equal(variationCountOf(again.state), count);
});

test('a move matching the mainline next move is a navigation, not a branch', () => {
  const base = line(PGN);
  const state = initialState(base, 'm2');
  const res = play(state, 'g1', 'f3');
  assert.equal(res.created, false);
  assert.equal(res.state.pointer, 'm3');
  assert.equal(variationCountOf(res.state), 0);
});

test('variation inside a variation returns to the mainline branch point', () => {
  let state = initialState(line(PGN), 'm2');
  state = play(state, 'd2', 'd4').state;          // variation at White 2
  state = play(state, 'd7', 'd5').state;          // continues the variation
  state = play(state, 'c2', 'c4').state;          // nested branch inside it
  assert.equal(currentOf(state).isMainline, false);
  assert.equal(state.nodes[state.pointer].parentId, state.nodes[state.nodes[state.pointer].parentId].id);
  assert.equal(variationCountOf(state), 3);

  state = toMainline(state);
  assert.equal(currentOf(state).id, 'm2');
  assert.equal(currentOf(state).isMainline, true);
  assert.equal(state.promotedId, null);
});

test('deleting the current variation falls back to its parent', () => {
  let state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  const variationId = state.pointer;
  const next = deleteVariationInTree(state, variationId);
  assert.equal(next.pointer, 'm2');
  assert.equal(next.nodes[variationId], undefined);
  assert.equal(variationCountOf(next), 0);
  /* The deleted state must keep the mainline array — a state without `ids`
     crashes every reader that maps it. */
  assert.deepEqual(next.ids, state.ids);
  assert.equal(next.nodes.m6.san, 'Bc5');
});

test('deleting a variation from deep inside it lands on the root of that branch', () => {
  let state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  const variationId = state.pointer;
  state = play(state, 'd7', 'd5').state;   // pointer is now a child of the branch
  const next = deleteVariationInTree(state, variationId);
  assert.equal(next.pointer, 'm2');
  assert.equal(variationCountOf(next), 0);
  assert.deepEqual(next.ids, state.ids);
});

test('reset removes every branch and restores the original line', () => {
  let state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  state = play(state, 'd7', 'd5').state;
  const base = line(PGN);
  state = resetToMainline(state, base);
  assert.equal(variationCountOf(state), 0);
  assert.equal(state.pointer, base.ids[base.ids.length - 1]);
  assert.equal(state.promotedId, null);
});

test('promote is display-only and can be toggled off', () => {
  let state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  const id = state.pointer;
  state = togglePromotionInTree(state, id);
  assert.equal(state.promotedId, id);
  assert.equal(displayIdsOf(state).at(-1), id);
  assert.equal(state.ids.at(-1), 'm6', 'real mainline still ends at Bc5');
  state = togglePromotionInTree(state, id);
  assert.equal(state.promotedId, null);
});

test('serialize/hydrate round-trips branches and the pointer', () => {
  let state = play(initialState(line(PGN), 'm4'), 'f3', 'e5').state;
  state = play(state, 'f1', 'c4').state;
  const saved = JSON.parse(JSON.stringify(serializeTree(state)));
  const base = line(PGN);
  const restored = hydrateTree(saved, base);
  assert.equal(restored.pointer, state.pointer);
  assert.equal(variationCountOf(restored), variationCountOf(state));
  assert.ok(restored.nodes[state.pointer]);
  assert.equal(restored.nodes[state.pointer].san, state.nodes[state.pointer].san);
});

test('hydrating the same snapshot twice never duplicates branches', () => {
  /* The classroom re-hydrates on every server snapshot against ONE memoized
     mainline — attaching must not write back into that mainline. */
  let state = play(initialState(line(PGN), 'm4'), 'f3', 'e5').state;
  const saved = serializeTree(state);
  const base = line(PGN);
  const parentChildren = base.nodes.m4.children.slice();
  hydrateTree({ ...saved, pointer: null }, base);
  const twice = hydrateTree({ ...saved, pointer: null }, base);
  assert.deepEqual(base.nodes.m4.children, parentChildren, 'mainline untouched');
  assert.deepEqual(twice.nodes.m4.children.filter((id) => id.startsWith('v')), [state.pointer]);
  assert.equal(variationCountOf(twice), 1);
});

test('hydrate drops branches whose parent no longer exists', () => {
  let state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  const saved = serializeTree(state);
  const shorter = line(['e4']); // no m2 -> branch cannot attach
  const restored = hydrateTree(saved, shorter);
  assert.equal(variationCountOf(restored), 0);
  assert.equal(restored.pointer, 'm1');
});

test('hydrate refuses a branch recorded for a different game at the same ply', () => {
  let state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  const saved = serializeTree(state);
  /* Same number of plies, so m2 EXISTS positionally — but it is not the same
     position, and White's d4 is not even legal there for Black to move. */
  const different = line(['d4', 'd5']);
  const restored = hydrateTree(saved, different);
  assert.equal(variationCountOf(restored), 0);
});

test('a grown mainline keeps branches; a replaced one does not', () => {
  let state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  const grown = line([...PGN, 'd3', 'd6']);
  const merged = mergeMainline(state, grown);
  assert.ok(merged);
  assert.equal(variationCountOf(merged), 1);
  assert.equal(merged.ids.length, grown.ids.length);

  const replaced = line(['d4', 'd5']);
  assert.equal(mergeMainline(state, replaced), null);
});

test('castling, en passant and promotion are legal inside variations', () => {
  // castling as a deviation from 1.e4 e5 2.Nf3 Nc6
  let s = initialState(line(['e4', 'e5', 'Nf3', 'Nc6']), 'm4');
  s = play(s, 'f1', 'c4').state;
  s = play(s, 'f8', 'c5').state;
  const castle = play(s, 'e1', 'g1');
  assert.equal(castle.created, true);
  assert.equal(castle.node.san, 'O-O');
  assert.equal(currentOf(castle.state).isMainline, false);

  // en passant: 1.e4 a6 2.e5 d5 3.exd6
  let e = initialState(line(['e4', 'a6', 'e5', 'd5']), 'm4');
  e = play(e, 'e5', 'd6').state;
  assert.equal(currentOf(e).san, 'exd6');
  assert.equal(currentOf(e).isMainline, false);

  // promotion from a bare pawn position (a8=Q gives check to the a1 king)
  const promo = buildMainline('8/P7/8/8/8/8/8/k6K w - - 0 1', []);
  const p = play(initialState(promo, ROOT_ID), 'a7', 'a8', 'q');
  assert.equal(p.created, true);
  assert.equal(p.node.san, 'a8=Q+');
});

test('no legal move at a checkmate position (variation cannot invent one)', () => {
  const mate = buildMainline('start', ['f3', 'e5', 'g4', 'Qh4']);
  const res = play(initialState(mate, 'm4'), 'a2', 'a3');
  assert.equal(res.illegal, true);
  assert.equal(res.created, false);
  assert.equal(res.state.pointer, 'm4');
});

test('sibling navigation stays inside one branch point', () => {
  let s = initialState(line(PGN), 'm2');
  s = play(s, 'd2', 'd4').state;   // child 1 of m2
  const first = s.pointer;
  s = backInTree(s);
  s = play(s, 'g1', 'f3').state;   // child 2 of m2 (same as mainline move -> m3)
  // m2's children are [m3, v1]; sibling moves between them
  const sib = siblingInTree(s, 1);
  assert.equal(sib.pointer, first);
});

/* ── the live classroom snapshot ───────────────────────────────────────────
   The server stores exactly `serializeTree`'s shape and adds `mode`/`rev`, so
   the classroom hydrates it with this same model on every broadcast. */

test('a classroom snapshot hydrates with the room pointer and its branches', () => {
  const state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  const branchId = state.pointer;
  const sent = { ...serializeTree(state), pointer: 'm2', mode: 'free', rev: 7 };
  const restored = hydrateTree(sent, line(PGN));
  assert.equal(restored.pointer, 'm2');
  assert.equal(variationCountOf(restored), 1);
  assert.equal(restored.nodes[branchId].san, 'd4');
});

test('a growing class mainline keeps branches anchored to their plies', () => {
  const state = play(initialState(line(['e4', 'e5']), 'm2'), 'd2', 'd4').state;
  const saved = serializeTree(state);

  const longer = hydrateTree(saved, line(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']));
  assert.equal(longer.nodes.v1.san, 'd4');
  assert.equal(longer.ids.length, 6);
  assert.equal(variationCountOf(longer), 1);

  const grown = hydrateTree(saved, line(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']));
  assert.equal(grown.ids.length, 7);
  assert.equal(variationCountOf(grown), 1);
});

test('a room pointer the class line no longer reaches falls back to the live end', () => {
  const state = play(initialState(line(PGN), 'm2'), 'd2', 'd4').state;
  const saved = { ...serializeTree(state), pointer: 'm5' };
  /* Undo shortened the class game to two plies: m5 is gone. */
  const restored = hydrateTree(saved, line(['e4', 'e5']));
  assert.equal(restored.pointer, 'm2');
  assert.equal(variationCountOf(restored), 1);
});
