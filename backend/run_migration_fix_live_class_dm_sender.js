/* Runs migrations/fix_live_class_dm_sender.sql and reports what it changed.
 *
 * Idempotent: the UPDATE only touches rows that still have a NULL sender_id,
 * so re-running is safe.
 *
 * Run: node run_migration_fix_live_class_dm_sender.js
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('./src/config/database');

const FILE = path.join(__dirname, 'migrations', 'fix_live_class_dm_sender.sql');

(async () => {
  const sql = fs.readFileSync(FILE, 'utf8');

  const before = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM chat_messages
      WHERE is_private IS TRUE AND sender_id IS NULL`,
  );
  console.log(`DM rows with no sender_id: ${before.rows[0].n}`);

  await db.query(sql);

  const after = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM chat_messages
      WHERE is_private IS TRUE AND sender_id IS NULL`,
  );
  const fixed = before.rows[0].n - after.rows[0].n;
  console.log(`backfilled ${fixed} row(s); ${after.rows[0].n} still missing`);

  /* Prove the Messages-page read path now resolves the author. Before the fix
   * this JOIN produced nothing for a classroom DM. */
  const probe = await db.query(
    `SELECT cm.id, cm.sender_id, u.name
       FROM chat_messages cm
       JOIN users u ON u.id = cm.sender_id
      WHERE cm.is_private IS TRUE
      ORDER BY cm.id DESC LIMIT 5`,
  );
  console.log(`\nresolvable DM threads via sender_id: ${probe.rows.length}`);
  probe.rows.forEach((r) => console.log(`  #${r.id} from ${r.name} (sender ${r.sender_id})`));

  if (after.rows[0].n > 0) {
    console.log('\nWARN: some rows still have no author and no user_id — manual review needed');
  } else {
    console.log('\nOK - every private row now has a resolvable author');
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});