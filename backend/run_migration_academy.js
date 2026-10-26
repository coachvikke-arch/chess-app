require('dotenv').config();
const fs = require('fs');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(fs.readFileSync(require('path').join(__dirname, 'migrations', 'add_chess_academy.sql'), 'utf8'));
    const tables = ['academy_stats', 'academy_progress', 'academy_sessions', 'academy_badges', 'user_academy_badges'];
    const st = await db.pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [tables]
    );
    const present = st.rows.map((r) => r.table_name);
    const missing = tables.filter((t) => !present.includes(t));
    if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);
    const badges = await db.pool.query('SELECT COUNT(*)::int AS n FROM academy_badges');
    console.log(`ACADEMY MIGRATION OK — tables created, ${badges.rows[0].n} badges seeded.`);
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();