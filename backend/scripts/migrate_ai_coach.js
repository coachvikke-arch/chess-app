require('dotenv').config();
const db = require('../src/config/database');

const S = [
  `CREATE TABLE IF NOT EXISTS ai_coach_sessions (
     id SERIAL PRIMARY KEY,
     user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
     title TEXT NOT NULL DEFAULT 'New coach session',
     mode TEXT NOT NULL DEFAULT 'coach',
     messages JSONB NOT NULL DEFAULT '[]',
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   )`,

  `CREATE INDEX IF NOT EXISTS idx_ai_coach_sessions_user
     ON ai_coach_sessions (user_id, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS ai_coach_progress (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     xp INTEGER NOT NULL DEFAULT 0,
     streak INTEGER NOT NULL DEFAULT 0,
     last_active TIMESTAMP,
     stats JSONB NOT NULL DEFAULT '{}',
     updated_at TIMESTAMP DEFAULT NOW()
   )`,
];

(async () => {
  for (const s of S) {
    await db.query(s);
    console.log('ok:', s.replace(/\s+/g, ' ').slice(0, 90));
  }
  process.exit(0);
})().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});