require('dotenv').config();
const db = require('../src/config/database');

const S = [
  "ALTER TABLE online_games ADD COLUMN IF NOT EXISTS time_base_minutes INTEGER NOT NULL DEFAULT 5",
  "ALTER TABLE online_games ADD COLUMN IF NOT EXISTS time_increment_seconds INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE online_games ADD COLUMN IF NOT EXISTS white_ms BIGINT NOT NULL DEFAULT 300000",
  "ALTER TABLE online_games ADD COLUMN IF NOT EXISTS black_ms BIGINT NOT NULL DEFAULT 300000",
  "ALTER TABLE online_games ADD COLUMN IF NOT EXISTS last_react_emoji VARCHAR(40)",
  "ALTER TABLE online_games ADD COLUMN IF NOT EXISTS last_react_by INTEGER",
  "ALTER TABLE online_games ADD COLUMN IF NOT EXISTS last_react_at TIMESTAMP",
];

(async () => {
  for (const s of S) {
    await db.query(s);
    console.log('ok:', s.slice(0, 70));
  }
  process.exit(0);
})().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});