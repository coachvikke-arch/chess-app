const path = require('path');
const BACKEND = path.join(__dirname, '..', '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const { Client } = require(path.join(BACKEND, 'node_modules', 'pg'));
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const q = await c.query(
    "select table_name, column_name from information_schema.columns where table_name in ('imported_game_analysis','sigma_moves') order by table_name, ordinal_position"
  );
  q.rows.forEach((r) => console.log(r.table_name + ' | ' + r.column_name));
  await c.end();
}).catch((e) => { console.error('ERR', e.message); process.exit(1); });