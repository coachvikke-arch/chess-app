/**
 * chessMoveExplainer — the deterministic explanation card underneath the GM
 * game replay's "Engine analysis" commentary.
 *
 * THE CONTRACT THESE TESTS GUARD
 *
 * Every statement the card shows must be DERIVED from an exact FEN + the
 * engine's MultiPV lines through chess.js. Nothing is invented ("the knight
 * attacks a pawn" only when a knight really does), anything unprovable
 * degrades to an honest no-purpose/low-confidence fallback, never to padding
 * language. Evals cross the White↔mover boundary ONLY through the exported
 * helpers, so a Black move's card can never quote a White-perspective number
 * as its own.
 *
 * Positions below are built by replaying SAN with chess.js, so every FEN used
 * as "before" is the exact one that the real replay produces for those moves.
 *
 * Run with: npm run test:explainer
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  buildMoveExplanation,
  getMoveExplanation,
  explanationCacheKey,
  clearExplanationCache,
  principalVariationFrom,
  formatPawnEval,
  formatMoverEval,
  toMoverPerspective,
  toWhitePerspective,
  EXPLANATION_VERSION,
  EXPLAIN_ENGINE_VERSION,
} from '../src/utils/chessMoveExplainer.js';

/* Replays `sans`, returning { fenBefore, side, moveNumber } of the position in
 * which the LAST san was played. Throws on an illegal san so a typo'd move is
 * a loud failure, not a silently wrong position. */
function beforePosition(sans) {
  const game = new Chess();
  for (const san of sans.slice(0, -1)) {
    if (!game.move(san)) throw new Error(`illegal SAN in test setup: ${san}`);
  }
  const played = game.move(sans[sans.length - 1]);
  if (!played) throw new Error(`illegal final SAN in test setup: ${sans[sans.length - 1]}`);
  return {
    fen: game.history({ verbose: true })
      .at(-1).before,
    side: played.color,
    uci: played.from + played.to + (played.promotion || ''),
    san: played.san,
    moveNumber: game.moveNumber(),
  };
}

const START_FEN = new Chess().fen();

function line(uci, score, mate = null, pv = null) {
  return { uci, score, mate, pv };
}

test('formatPawnEval formats signer and mate exactly, with a null on missing data', () => {
  assert.equal(formatPawnEval(240, null), '+2.4');
  assert.equal(formatPawnEval(-80, null), '−0.8');
  assert.equal(formatPawnEval(0, null), '0.0');
  assert.equal(formatPawnEval(null, 2), 'M2');
  assert.equal(formatPawnEval(null, -3), '−M3');
  assert.equal(formatPawnEval(null, null), null);
});

test('eval perspective helpers flip only for Black', () => {
  assert.equal(toMoverPerspective(-150, 'b'), 150);
  assert.equal(toMoverPerspective(-150, 'w'), -150);
  assert.equal(toWhitePerspective(150, 'b'), -150);
  assert.equal(formatMoverEval(-150, null, 'b'), '+1.5');
  assert.equal(formatMoverEval(-150, null, 'w'), '−1.5');
  /* A White-perspective mate that is White's win reads as THE ENGINE'S OWN
     win for White but as a countdown AGAINST Black. */
  assert.equal(formatMoverEval(null, -2, 'b'), 'M2');
  assert.equal(formatMoverEval(null, -2, 'w'), '−M2');
});

test('1. opening development: a knight leaves its home square for a reason the board shows', () => {
  const pos = beforePosition(['Nf3']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: pos.side, playedUci: pos.uci, playedSan: pos.san, moveNumber: 1,
    lossCp: 5, lines: [line('g1f3', 35), line('e2e4', 30)],
  });
  assert.ok(card, 'card missing');
  assert.equal(card.movePurpose.verified, true);
  assert.match(card.movePurpose.headline, /White develops the knight off its starting square/);
  assert.match(card.strategicPlan.shortTerm, /knight joins the game/);
  /* The played move IS the engine's first choice here. */
  assert.equal(card.alternativeComparison.isEngineChoice, true);
  assert.equal(card.alternativeComparison.playedCostPawns, 0);
  /* The runner-up (e4) shows up as an alternative, with its own cost label. */
  const alt = card.alternativeComparison.alternatives.find((a) => a.uci === 'e2e4');
  assert.ok(alt, 'e4 alternative missing');
  assert.ok(alt.costLabel, 'expected a cost label for the runner-up');
});

test('2. tactical capture: a defended capture names piece and square, and does NOT call it free', () => {
  const pos = beforePosition(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: pos.side, playedUci: pos.uci, playedSan: pos.san, moveNumber: 4,
    lossCp: 8, lines: [line('b5c6', 40)],
  });
  assert.equal(card.movePurpose.verified, true);
  assert.match(card.movePurpose.headline, /wins the knight on c6/);
  assert.ok(!card.movePurpose.headline.includes('nothing defended'), 'a defended capture must not read as free');
  assert.equal(card.confidence, 'high');
});

test('3. sacrifice: stepping onto an attacked, undefended square is stated as the offer it is', () => {
  /* 1.Nf3 Nc6 2.Nc3 d5 — then 3.Nxe5?? no, capture-less: the f3-knight steps to
   * e5, a square the c6-knight attacks with NO white defender nearby, so the
   * card must call the move what it is: a piece parked where it can hang. */
  const fen = 'r1bqkbnr/ppp1pppp/2n5/3p4/8/2N2N2/PPPPPPPP/R1BQKB1R w KQkq - 0 3';
  const game = new Chess(fen);
  const played = game.move('Ne5');
  const card = buildMoveExplanation({
    fen, side: 'w', playedUci: played.from + played.to, playedSan: played.san, moveNumber: 3,
    lossCp: 0, lines: [line('f3e5', 10)],
  });
  assert.equal(card.movePurpose.verified, true);
  assert.match(card.movePurpose.headline, /leaves the knight capturable on e5/);
  /* No capture happened, so the counted detail (which exists only when the
     played move itself captured) is absent — the plan still tells the truth. */
  assert.match(card.strategicPlan.shortTerm, /material sits in the pot/);
});

test('4. check with a capture: the combined purpose names both, and the plan treats the tempo', () => {
  const pos = beforePosition(['e4', 'e5', 'Qh5', 'g6', 'Qxe5+']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: pos.side, playedUci: pos.uci, playedSan: pos.san, moveNumber: 3,
    lossCp: 0, lines: [line('h5e5', 60)],
  });
  assert.equal(card.movePurpose.verified, true);
  assert.match(card.movePurpose.headline, /gives check and collects the pawn on e5/);
});

test('5. castling: king-safety and rooks in one sentence, each half provable', () => {
  const pos = beforePosition(['Nf3', 'Nc6', 'e4', 'e5', 'Bc4', 'Bc5', 'O-O']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: pos.side, playedUci: pos.uci, playedSan: pos.san, moveNumber: 4,
    lossCp: 2, lines: [line('e1g1', 20)],
  });
  assert.equal(card.movePurpose.verified, true);
  assert.match(card.movePurpose.headline, /castles kingside/);
  assert.match(card.strategicPlan.contribution, /king safety and rook activation/);
});

test('6. defensive: the attacked knight that nothing defends moves out of fire', () => {
  /* Black's pawn on e4 attacks f3. The g2 pawn and d1 queen are GONE, so the
   * knight is attacked and defended by nobody — the g5 escape is the rescue
   * branch. Both "defender" squares had to be emptied: with g2 present the
   * knight is defended and the rescue gate (fromDefenders === 0) stays shut. */
  const fen = 'rnbqkbnr/pppppppp/8/8/4p3/5N2/PPPP1P1P/RNB1KB1R w - - 0 3';
  assert.equal(new Chess(fen).attackers('f3', 'w').length, 0, 'test setup: f3 must be undefended');
  const played = new Chess(fen).move('Ng5');
  const card = buildMoveExplanation({
    fen, side: 'w', playedUci: played.from + played.to, playedSan: played.san, moveNumber: 3,
    lossCp: 0, lines: [line('f3g5', 15)],
  });
  assert.equal(card.movePurpose.verified, true);
  assert.match(card.movePurpose.headline, /moves the attacked knight out of fire and to g5/);
});

test('7. endgame: the king walks toward the middle, and the card says so as activation', () => {
  /* Bare kings on the middle files: endgame gate (no queens, ≤6 minors/heavy
   * pieces) passes, and the d3 destination is inside the near-centre band. */
  const fen = '8/5k2/8/8/8/8/4K3/8 w - - 0 1';
  const game = new Chess(fen);
  const played = game.move('Kd3');
  const card = buildMoveExplanation({
    fen, side: 'w', playedUci: played.from + played.to, playedSan: played.san, moveNumber: 12,
    lossCp: 0, lines: [line('e2d3', 10)],
  });
  assert.equal(card.movePurpose.verified, true);
  assert.match(card.movePurpose.headline, /walks the king toward the middle/);
  assert.match(card.strategicPlan.contribution, /activates the strongest piece/);
});

test('8. mistake: the engine preference is named first, with the cost of not taking it', () => {
  const pos = beforePosition(['Na3']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: pos.side, playedUci: pos.uci, playedSan: pos.san, moveNumber: 1,
    lossCp: 20, lines: [line('e2e4', 40), line('g1f3', 38)],
  });
  assert.equal(card.alternativeComparison.isEngineChoice, false);
  assert.equal(card.alternativeComparison.playedCostPawns, 0.2);
  assert.match(card.alternativeComparison.summary, /The engine preferred e4 over Na3\./);
  const engineLine = card.alternativeComparison.alternatives[0];
  assert.equal(engineLine.san, 'e4');
  assert.ok(engineLine.comparison, 'the played-vs-engine comparison note is expected');
  assert.match(engineLine.comparison, /Not playing it was worth about 0\.20 pawns/);
  /* The played move still gets its truthful (rim-knight) development wording. */
  assert.ok(card.movePurpose, 'the card never suppresses the positional read-out');
  assert.equal(card.confidence, 'high');
});

test('9. black-vs-white perspective: the same line reads flipped for Black', () => {
  const pos = beforePosition(['e4', 'e5']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: 'b', playedUci: pos.uci, playedSan: pos.san, moveNumber: 1,
    lossCp: 0, lines: [line('e7e5', -30), line('c7c5', -35)],
  });
  assert.equal(card.movePurpose.verified, true);
  /* e5 is a CENTRE square, so the central-occupation branch outranks the plain
     pawn-push: the move is described by the stronger of the two provable
     facts. */
  assert.match(card.movePurpose.headline, /^Black occupies the centre with the pawn on e5/);
  assert.match(card.strategicPlan.shortTerm, /claims a central square/);
  /* The engine's line is White-perspective (−30cp is GOOD for Black), so the
     best line moves to Black's credit: the comparison must cost 0, not the
     engine's White-number. */
  assert.equal(card.alternativeComparison.playedCostPawns, 0);
});

test('10. two equally strong engine moves: the runner-up costs nothing, within noise', () => {
  const pos = beforePosition(['e4']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: 'w', playedUci: 'e2e4', playedSan: 'e4', moveNumber: 1,
    lossCp: 0, lines: [line('e2e4', 30), line('g1f3', 30)],
  });
  assert.equal(card.alternativeComparison.isEngineChoice, true);
  const alt = card.alternativeComparison.alternatives[0];
  assert.equal(alt.uci, 'g1f3');
  assert.equal(alt.evalCostPawns, 0);
  assert.match(alt.costLabel, /just as strong, within engine noise/);
});

test('11. missing PV (and scoreless mate lines): the card degrades honestly, never invents costs', () => {
  const pos = beforePosition(['e4', 'e5', 'Nf3']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: pos.side, playedUci: pos.uci, playedSan: pos.san, moveNumber: 3,
    lossCp: null,
    lines: [
      line('f1c4', null), /* mate-scored line with no cp — cost uncomputable */
      line('b1c3', 20),
    ],
  });
  assert.equal(card.principalVariation, null, 'no PV was given, none may appear');
  for (const alt of card.alternativeComparison.alternatives) {
    assert.equal(alt.evalCostPawns, null);
    assert.equal(alt.costLabel, null);
    assert.ok(alt.aims, 'the aim text is still derivable without evals');
  }
});

test('12. illegal principal variation: only the legal prefix survives, truncation stays honest', () => {
  assert.equal(principalVariationFrom(START_FEN, ['a1a2']), null, 'an illegal first move yields no line');
  const ok = principalVariationFrom(START_FEN, ['e2e4', 'e7e5', 'b1c3', 'g8f6']);
  assert.deepEqual(ok, { sans: ['e4', 'e5', 'Nc3', 'Nf6'], truncated: false });
  const cut = principalVariationFrom(START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'h1h5']);
  assert.deepEqual(cut, { sans: ['e4', 'e5', 'Nf3', 'Nc6'], truncated: true });
});

test('13. invalid input and broken moves degrade to an honest low-confidence statement', () => {
  assert.equal(buildMoveExplanation(null), null);

  const noFen = buildMoveExplanation({ fen: '' });
  assert.equal(noFen.confidence, 'low');
  assert.match(noFen.movePurpose.headline, /No position is known/);

  const unreadable = buildMoveExplanation({ fen: 'not-a-fen' });
  assert.equal(unreadable.confidence, 'low');
  assert.match(unreadable.movePurpose.headline, /position could not be read/);
  assert.deepEqual(unreadable.strategicPlan, {
    shortTerm: null, longTerm: null, contribution: null,
  });

  const noMove = buildMoveExplanation({ fen: START_FEN, side: 'w', playedUci: '', playedSan: '' });
  assert.match(noMove.movePurpose.headline, /played move could not be identified/);

  const illegal = buildMoveExplanation({ fen: START_FEN, side: 'w', playedUci: 'e2e5' });
  assert.match(illegal.movePurpose.headline, /not legal in this exact position/);

  const wrongSide = buildMoveExplanation({ fen: START_FEN, side: 'b', playedUci: 'e2e4' });
  assert.match(wrongSide.movePurpose.headline, /does not match the side to move/);

  for (const card of [noFen, unreadable, noMove, illegal, wrongSide]) {
    assert.equal(card.confidence, 'low');
    assert.deepEqual(card.alternativeComparison.alternatives, []);
  }
});

test('the decision engine line (f2f3/g2g4) exposes the mate purpose with its engine-best must-catch annotation', () => {
  const pos = beforePosition(['f3', 'e5', 'g4', 'Qh4#']);
  const card = buildMoveExplanation({
    fen: pos.fen, side: 'b', playedUci: pos.uci, playedSan: pos.san, moveNumber: 2,
    lossCp: 0, lines: [line('d8h4', null, 1)],
  });
  assert.equal(card.movePurpose.verified, true);
  assert.match(card.movePurpose.headline, /checkmates — the game ends on this very move/);
  /* The engine's own line IS the mating move and the pv validates through it. */
  const pv = principalVariationFrom(pos.fen, ['d8h4']);
  assert.deepEqual(pv, { sans: ['Qh4#'], truncated: false });
});

test('the cache serves the identical explanation for the same key without rebuilding between versions', () => {
  clearExplanationCache();
  const pos = beforePosition(['e4', 'e5', 'Nf3']);
  const input = {
    fen: pos.fen, side: pos.side, playedUci: pos.uci, playedSan: pos.san, moveNumber: 3,
    lossCp: 0, lines: [line('g1f3', 15)],
  };
  const first = getMoveExplanation(input);
  const second = getMoveExplanation(input);
  assert.equal(first, second, 'cache returns the same object reference');
  const key = explanationCacheKey(input);
  assert.ok(key.includes(String(EXPLANATION_VERSION)));
  assert.ok(key.includes(EXPLAIN_ENGINE_VERSION));
  clearExplanationCache();
  const after = getMoveExplanation(input);
  assert.ok(after, 'after clearing the entry is re-built, not lost');
  assert.equal(after.movePurpose.verified, true);
});
