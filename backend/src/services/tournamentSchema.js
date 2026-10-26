'use strict';

/* Creates / upgrades the tournament tables. Idempotent and cheap after the
   first call, so it is safe to await from any route or from server start-up. */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

let ready = null;

function statements() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'tournament_schema.sql'), 'utf8');
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function run() {
  for (const stmt of statements()) {
    try {
      await db.query(stmt);
    } catch (err) {
      if (/^CREATE (UNIQUE )?INDEX/i.test(stmt)) {
        console.warn('[tournament] optional index skipped:', err.message);
        continue;
      }
      /* Name the statement: an old table with a clashing column is the one
         realistic failure and the message has to say where. */
      err.message = `tournament schema: ${err.message} (while running: ${stmt.slice(0, 120)}...)`;
      throw err;
    }
  }
  /* The progression outbox is created lazily by roundProgressionService, but it
     references tournaments(id) so make sure it exists once tournaments does. */
  try { await require('./roundProgressionService').ensureTable(); } catch (_) { /* optional */ }
}

function ensureTournamentSchema() {
  if (!ready) {
    ready = run().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

module.exports = { ensureTournamentSchema };
