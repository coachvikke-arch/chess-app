require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_live_class_variations.sql'), 'utf8')
    );
    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'chess_game_states'`
    );
    const names = cols.rows.map((r) => r.column_name);
    const missing = ['variation_tree', 'variation_pointer', 'analysis_mode'].filter((c) => !names.includes(c));
    if (missing.length > 0) {
      throw new Error(`Missing columns: ${missing.join(', ')}`);
    }
    console.log('LIVE CLASS VARIATIONS MIGRATION OK — columns:', names.join(', '));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
