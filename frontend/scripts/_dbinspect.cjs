const path = require('path');
const BACKEND = path.join(__dirname, '..', '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const { Client } = require(path.join(BACKEND, 'node_modules', 'pg'));
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const a = await c.query('SELECT id, game_id, user_id, length(data::text) AS len, created_at FROM imported_game_analysis WHERE game_id = 94683 ORDER BY created_at');
  console.log('analysis rows:', JSON.stringify(a.rows));
  const g = await c.query('SELECT id, game_source, game_id, ply, move_san, sigma_type FROM sigma_moves ORDER BY id');
  console.log('sigma rows:', JSON.stringify(g.rows));

  const r = await c.query('SELECT data FROM imported_game_analysis WHERE game_id = 94683 ORDER BY created_at DESC LIMIT 1');
  if (r.rows.length) {
    const d = r.rows[0].data;
    const mv = d.moves || d.rows || d;
    console.log('top-level keys:', Object.keys(d).join(','));
    console.log('move count:', mv.length);
    const idx = {};
    mv.forEach((m, i) => { idx[m.ply] = i; });
    [46, 47, 49, 50].forEach((p) => {
      const i = idx[p];
      const m = mv[i];
      if (m) console.log('ply', p, JSON.stringify({ san: m.moveSan, verdict: m.verdict, acc: m.acc, loss: m.loss, swing: m.swing, sigma: m.sigma, suspicious: m.suspicious }));
    });
    const tally = mv.reduce((acc, m) => { const k = m.verdict || 'null'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    console.log('tally:', JSON.stringify(tally));
  }
  await c.end();
}).catch((e) => { console.error('ERR', e.message); process.exit(1); });