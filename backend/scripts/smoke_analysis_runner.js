/* Ad-hoc check: analyse one real stored game with a STUB engine (no WASM boot),
   so the loader → review-pipeline → storage-shaping path can be exercised in
   seconds. Not part of the suite; run with:
     node backend/scripts/smoke_analysis_runner.js
*/
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require(path.join(__dirname, '..', 'src', 'config', 'database.js'));
const { loadGame } = require(path.join(__dirname, '..', 'src', 'services', 'analysis', 'gameLoader.js'));
const { analyseGame } = require(path.join(__dirname, '..', 'src', 'services', 'analysis', 'analysisRunner.js'));

/* A deterministic stub with the shape gameReview.js expects: WHITE-perspective
   scores, and a "best move" that is always the first legal move, so the
   classifier produces a real mix of verdicts without booting an engine. */
function stubEngine(fen) {
  const stm = (fen.split(/\s+/)[1] || 'w') === 'w' ? 1 : -1;
  return {
    searchTopMoves: async () => ([
      { rank: 1, uci: '0000', score: 10 * stm, depth: 14, pv: [] },
      { rank: 2, uci: '0000', score: 0 * stm, depth: 14, pv: [] },
    ]),
    evaluateGame: async () => ({ score: 0, mate: null, depth: 14 }),
  };
}

(async () => {
  const src = process.argv[2] || 'chess_profile';
  const { rows } = await db.query(
    src === 'chess_profile'
      ? `SELECT id FROM chess_games WHERE pgn IS NOT NULL AND pgn <> '' ORDER BY id LIMIT 1`
      : `SELECT id FROM ${src === 'computer' ? 'computer_games' : src === 'online' ? 'online_games' : 'tournament_games'} WHERE pgn IS NOT NULL AND pgn <> '' ORDER BY id LIMIT 1`,
  );
  if (!rows.length) {
    console.log(`no ${src} game with a PGN — nothing to smoke-test`);
    await db.pool.end();
    return;
  }
  const loaded = await loadGame(src, rows[0].id);
  console.log('loadGame →', loaded.ok ? 'ok' : `FAILED: ${loaded.reason}`);
  if (!loaded.ok) { await db.pool.end(); process.exit(1); }
  const g = loaded.game;
  console.log(`  ${g.gameSource}#${g.gameId} owner=${g.ownerUserId} fen=${g.initialFen.slice(0, 40)}… playedAt=${g.playedAt}`);

  const t0 = Date.now();
  const out = await analyseGame({ game: g, engine: { searchTopMoves: async (fen) => stubEngine(fen).searchTopMoves(), evaluateGame: async () => stubEngine('').evaluateGame() } });
  console.log(`analyseGame → ${out.ok ? 'ok' : `FAILED: ${out.reason}`} in ${Date.now() - t0}ms`);
  if (out.ok) {
    console.log('  summary:', JSON.stringify({
      accuracyWhite: out.summary.accuracyWhite,
      accuracyBlack: out.summary.accuracyBlack,
      openingName: out.summary.openingName,
      ecoCode: out.summary.ecoCode,
      gameClassification: out.summary.gameClassification,
      analysisDepth: out.summary.analysisDepth,
      engineVersion: out.summary.engineVersion,
    }));
    console.log(`  moves: ${out.moves.length}, first 3:`, out.moves.slice(0, 3).map((m) => `${m.ply}:${m.moveSan}=${m.verdict}`).join(' '));
    console.log('  move row keys:', Object.keys(out.moves[0]).join(','));
  }
  await db.pool.end();
})();
