/* Ad-hoc: queue one real short game and drain it with the REAL Stockfish engine,
   to prove the worker + store + real engine agree. Not part of the suite.
     node backend/scripts/smoke_worker.js <gameSource> <gameId>
*/
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require(path.join(__dirname, '..', 'src', 'config', 'database.js'));
const store = require(path.join(__dirname, '..', 'src', 'services', 'analysis', 'analysisStore.js'));
const { loadGame } = require(path.join(__dirname, '..', 'src', 'services', 'analysis', 'gameLoader.js'));
const { analyseGame, getEngine, shutdownEngine } = require(path.join(__dirname, '..', 'src', 'services', 'analysis', 'analysisRunner.js'));

(async () => {
  const gameSource = process.argv[2] || 'chess_profile';
  const gameId = Number(process.argv[3]);
  if (!Number.isInteger(gameId) || gameId <= 0) {
    console.error('usage: node scripts/smoke_worker.js <gameSource> <gameId>');
    await db.pool.end();
    process.exit(1);
  }

  const loaded = await loadGame(gameSource, gameId);
  if (!loaded.ok) { console.error('load failed:', loaded.reason); await db.pool.end(); process.exit(1); }
  const { game } = loaded;
  console.log(`queued ${gameSource}#${gameId} (owner ${game.ownerUserId}, ${game.pgn.length} bytes of PGN)`);

  const enq = await store.enqueueGame({
    gameSource, gameId, ownerUserId: game.ownerUserId,
    pgn: game.pgn, movesCount: game.movesCount,
  });
  console.log('enqueue →', JSON.stringify(enq));

  const job = await store.claimNextJob({ workerId: 'smoke' });
  if (!job) { console.error('claim returned nothing'); await db.pool.end(); process.exit(1); }
  console.log(`claimed ${job.jobId} (status=${job.status}, attempts=${job.attempts})`);

  const t0 = Date.now();
  const out = await analyseGame({ game, engine: await getEngine() });
  console.log(`analysed in ${((Date.now() - t0) / 1000).toFixed(1)}s →`, out.ok ? 'ok' : out.reason);
  if (!out.ok) { await db.pool.end(); process.exit(1); }

  const done = await store.completeJob({
    gameSource, gameId, claimToken: job.claim_token,
    summary: out.summary, moves: out.moves,
  });
  console.log('completeJob →', JSON.stringify(done));
  console.log('summary:', JSON.stringify({
    white: out.summary.accuracyWhite, black: out.summary.accuracyBlack,
    opening: out.summary.openingName, eco: out.summary.ecoCode,
    class: out.summary.gameClassification, depth: out.summary.analysisDepth,
    engine: out.summary.engineVersion,
  }));
  const verdicts = {};
  for (const m of out.moves) verdicts[m.verdict] = (verdicts[m.verdict] || 0) + 1;
  console.log('verdicts:', JSON.stringify(verdicts));
  console.log('sample rows:', out.moves.slice(0, 4).map((m) => `${m.ply}${m.player}:${m.moveSan} best=${m.evalBest} played=${m.evalPlayed} cpl=${m.cpl} ${m.verdict}`).join(' | '));

  await shutdownEngine();
  await db.pool.end();
})();
