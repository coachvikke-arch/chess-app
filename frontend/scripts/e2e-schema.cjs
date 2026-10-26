const path = require('path');
const B = path.join(__dirname, '..', '..', 'backend');
require(path.join(B, 'node_modules', 'dotenv')).config({ path: path.join(B, '.env') });
const db = require(path.join(B, 'src', 'config', 'database'));

(async () => {
  for (const t of ['connected_chess_accounts', 'chess_games', 'sigma_moves']) {
    const r = await db.query(
      'SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position',
      [t],
    );
    console.log('---', t, '---');
    console.log(r.rows.map((x) => x.column_name + (x.is_nullable === 'NO' ? '*' : '')).join(', '));
  }
  await db.pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });