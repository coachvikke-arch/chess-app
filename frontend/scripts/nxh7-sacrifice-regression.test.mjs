import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { reviewGame, REVIEW_META } from '../src/utils/gameReview.js';
import { createReviewEngine } from './nodeEngine.mjs';
import { settledNetSacrifice, sacrificeCandidate, attackingSacrifice, classifyMove, describeSacrifice } from '../src/utils/reviewClassify.js';

export const PGN = `[Event "Nagavel_Krishnamoorthi vs. Eberth26471"]
[Site "Chess.com"]
[Date "2026-06-20"]
[White "Nagavel_Krishnamoorthi"]
[Black "Eberth26471"]
[Result "1-0"]
[WhiteElo "1252"]
[BlackElo "1216"]
[TimeControl "600"]
[Termination "Nagavel_Krishnamoorthi won by checkmate"]

1. e4 d5 2. e5 e6 3. d4 g6 4. Nh3 Bg7 5. Qf3 a6 6. Ng5 Nh6
7. Bd3 O-O 8. h4 Nc6 9. h5 Nxd4 10. Qh3 Ndf5 11. g4 Nd4
12. Nxh7 Kxh7 13. hxg6+ fxg6 14. Bxh6 Rh8 15. Qe3 Bxh6
16. Rxh6+ Kg7 17. Rxg6+ Kf7 18. Qf4+ Ke7 19. Rg7+ Ke8 20. Qf7# 1-0`;
const game = new Chess();
game.loadPgn(PGN);
const history = game.history({ verbose: true });
const candidate = history[22];
const continuation = history.slice(23).map((m) => m.from + m.to + (m.promotion || ''));

test('the exact attack settles through its two PV threat/defence bridges', () => {
  const settled = settledNetSacrifice(candidate.before, 'w', 'g5h7', continuation, 18, { type: 'mate', value: 8 });
  assert.equal(attackingSacrifice(candidate.before, candidate), false);
  assert.equal(sacrificeCandidate(candidate.before, candidate, history[21]), true);
  assert.equal(settled.sequence.at(-1), 'Qf7#');
  assert.equal(settled.given, 750);
  assert.equal(settled.recovered, 950);
  assert.equal(settled.netDown, -200);
  assert.equal(settled.materialWinning, true);
  assert.equal(settled.connectedTacticalSacrifice, true);
  assert.equal(settled.forcedMate, true);
  assert.equal(settled.checksInContinuation, 6);
  const args = { bestM: 366, playedM: 366, sacrifice: true, attackingSac: false,
    connectedTacticalSacrifice: settled.connectedTacticalSacrifice, hasNetSacrifice: true, sacMovedCp: 320 };
  assert.equal(classifyMove(args), 'brilliant');
  assert.notEqual(classifyMove({ ...args, playedM: 355 }), 'brilliant');
  assert.equal(settledNetSacrifice(candidate.before, 'w', 'g5h7', continuation, 2).forcedMate, false);
});

test('exact game: live Stockfish review awards 12.Nxh7 Sigma and preserves mate semantics', { timeout: 300000 }, async () => {
  const engine = await createReviewEngine();
  try {
    const result = await reviewGame('start', history.map((m) => m.san), { engine });
    const row = result.moves[22];
    const line = await engine.searchTopMoves(candidate.after, { maxDepth: 18, multiPv: 1 });
    const settled = settledNetSacrifice(candidate.before, 'w', 'g5h7', line[0].pv, 18, line[0]);
    const debug = describeSacrifice({ san: candidate.san, mv: candidate, cpl: row.cpl,
      bestM: row.best, playedM: row.played, settled, tops: [], fenBefore: candidate.before,
      prevMv: history[21], mover: 'w', verdict: row.verdict });
    console.log('12.Nxh7 regression diagnostics:', JSON.stringify(debug));
    assert.equal(row.verdict, 'sigma', JSON.stringify(debug));
    assert.equal(REVIEW_META[row.verdict].label, 'Brilliant');
    assert.equal(row.sigma.type, 'knight_sacrifice');
    assert.ok(result.white.counts.brilliant >= 1);
    for (const ply of [22, 30, 36, 38]) {
      const inspected = result.moves[ply];
      console.log('mate/CPL inspection:', JSON.stringify(inspected));
      assert.ok(inspected.loss <= 1000);
      assert.ok(Math.abs(inspected.best) < 90000);
      assert.ok(Math.abs(inspected.played) < 90000);
    }
    assert.equal(result.moves[38].evalAfter.type, 'mate');
    assert.equal(result.moves[38].evalAfter.value, 1);
  } finally { engine.destroy(); }
});
