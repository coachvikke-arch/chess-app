const db = require('../src/config/database');
(async () => {
  const r = await db.query(
    "SELECT id, game_source, game_id, status, attempts, eligibility, left(error_message, 60) AS err, analyzed_at FROM game_stockfish_analysis ORDER BY id",
  );
  console.log(JSON.stringify(r.rows, null, 1));
  const m = await db.query(
    "SELECT game_source, game_id, count(*)::int AS moves FROM move_stockfish_analysis GROUP BY 1,2 ORDER BY 3 DESC",
  );
  console.log('move rows:', JSON.stringify(m.rows));
  await db.pool.end();
})();
