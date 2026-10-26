require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_gm_games_feature.sql'), 'utf8')
    );
    const feat = await db.pool.query(
      `SELECT id, key, name, category, route, sort_order
         FROM features WHERE key = 'gm_games'`
    );
    if (!feat.rows.length) throw new Error('gm_games feature was not registered');
    const f = feat.rows[0];
    const perms = await db.pool.query(
      `SELECT role, is_enabled FROM role_permissions
        WHERE feature_id = $1 ORDER BY role`,
      [f.id]
    );
    if (perms.rows.length !== 2) {
      throw new Error(`expected 2 role switches, found ${perms.rows.length}`);
    }
    console.log('GM GAMES FEATURE OK -', f.key, '|', f.name, '|', f.category,
      '| route', f.route, '| sort', f.sort_order);
    perms.rows.forEach((r) => console.log(`  ${r.role}: ${r.is_enabled ? 'on' : 'off'}`));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
