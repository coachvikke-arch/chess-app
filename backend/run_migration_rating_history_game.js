require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_rating_history_game.sql'), 'utf8')
    );
    const col = await db.pool.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'rating_history' AND column_name = 'online_game_id'`
    );
    if (!col.rows.length) throw new Error('rating_history.online_game_id was not created');
    const c = col.rows[0];
    const idx = await db.pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'rating_history' AND indexname = 'idx_rating_history_game'`
    );
    if (!idx.rows.length) throw new Error('idx_rating_history_game was not created');
    console.log('RATING HISTORY GAME LINK OK -', c.column_name, c.data_type, 'nullable', c.is_nullable, '|', idx.rows[0].indexname);
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();