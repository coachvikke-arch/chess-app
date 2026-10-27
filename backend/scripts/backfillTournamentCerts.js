#!/usr/bin/env node
require('dotenv').config();
const db = require('../src/config/database');
const svc = require('../src/services/certificateService');

/**
 * Backfill tournament certificates for tournaments completed before the
 * automatic path existed (or after a standings correction).
 *
 * Safe to run any number of times. Existing certificates are refreshed in
 * place — position, score, title and issue date — while their certificate
 * number and send status are kept. Run from the backend directory:
 *
 *   node scripts/backfillTournamentCerts.js
 */
(async () => {
  try {
    const { rows } = await db.query(
      `SELECT id, name FROM tournaments WHERE status = 'completed' ORDER BY id`
    );

    const totals = { created: 0, updated: 0, skipped: 0, failed: 0 };

    for (const t of rows) {
      try {
        const r = await svc.generateTournamentCertificates(t.id);
        totals.created += r.created;
        totals.updated += r.updated;
        totals.skipped += r.skipped;
        console.log(
          `#${t.id} ${t.name}: ${r.created} created, ${r.updated} refreshed, ${r.skipped} skipped`
        );
      } catch (err) {
        totals.failed += 1;
        console.error(`#${t.id} ${t.name}: FAILED - ${err.message}`);
      }
    }

    console.log(
      `\n${rows.length} completed tournaments - ${totals.created} certificates created, ` +
      `${totals.updated} refreshed, ${totals.skipped} skipped, ${totals.failed} failed.`
    );
    process.exit(totals.failed ? 1 : 0);
  } catch (err) {
    console.error('Tournament certificate backfill failed:', err.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
