require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(
        path.join(__dirname, 'migrations', 'add_chat_request_cancellation.sql'),
        'utf8'
      )
    );
    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'chat_requests'
          AND column_name IN ('cancelled_at', 'cancelled_by', 'cancel_reason')
        ORDER BY column_name`
    );
    if (cols.rows.length !== 3) {
      throw new Error(
        `Missing cancellation columns, found: ${cols.rows.map((r) => r.column_name).join(', ')}`
      );
    }
    const st = await db.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'chat_request_audit'`
    );
    if (st.rows.length === 0) {
      throw new Error('Missing table chat_request_audit');
    }
    console.log(
      'CHAT REQUEST CANCELLATION MIGRATION OK — columns:',
      cols.rows.map((r) => r.column_name).join(', '),
      '| table chat_request_audit created'
    );
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();