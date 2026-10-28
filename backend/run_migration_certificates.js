require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/**
 * Certificates migration runner — applies migrations/add_certificates.sql and
 * then verifies the columns, constraints and indexes the module depends on.
 *
 * The verification step is the point of this file. A migration that applies
 * cleanly can still be wrong (a renamed column, a dropped constraint), and
 * without this the failure surfaces much later as a confusing runtime error in
 * the middle of issuing a certificate.
 */
(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'add_certificates.sql'), 'utf8');
    await db.pool.query(sql);

    /* ── tables ─────────────────────────────────────────────────────────── */
    const tables = await db.pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('certificates', 'certificate_settings', 'certificate_number_counters')
    `);
    const tableNames = new Set(tables.rows.map((r) => r.table_name));
    const missingTables = ['certificates', 'certificate_settings', 'certificate_number_counters']
      .filter((t) => !tableNames.has(t));
    if (missingTables.length) throw new Error(`Missing tables: ${missingTables.join(', ')}`);

    /* ── columns ────────────────────────────────────────────────────────── */
    const cols = await db.pool.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('certificates', 'certificate_settings', 'certificate_number_counters')
    `);
    const present = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const requiredColumns = [
      'certificates.id', 'certificates.student_id', 'certificates.type',
      'certificates.title', 'certificates.rank', 'certificates.level_no',
      'certificates.tournament_id', 'certificates.issued_at', 'certificates.certificate_no',
      'certificates.score', 'certificates.points', 'certificates.rounds',
      'certificates.file_url', 'certificates.file_error', 'certificates.status',
      'certificates.sent_at', 'certificates.sent_by', 'certificates.send_count',
      'certificates.created_at', 'certificates.updated_at',
      'certificate_settings.id', 'certificate_settings.message_template',
      'certificate_settings.institute_name', 'certificate_settings.coach_name',
      'certificate_settings.logo_url', 'certificate_settings.updated_by',
      'certificate_settings.participation_certificates',
      'certificate_number_counters.year', 'certificate_number_counters.last_value',
    ];
    const missingCols = requiredColumns.filter((c) => !present.has(c));
    if (missingCols.length) throw new Error(`Missing columns: ${missingCols.join(', ')}`);

    /* ── check constraints ──────────────────────────────────────────────── */
    const cons = await db.pool.query(`
      SELECT conname FROM pg_constraint WHERE conrelid = 'certificates'::regclass
    `);
    const conNames = new Set(cons.rows.map((r) => r.conname));
    const requiredCons = [
      'certificates_certificate_no_key',
      'certificates_type_valid',
      'certificates_status_valid',
      'certificates_type_reference_valid',
      'certificates_level_no_valid',
      'certificates_rank_valid',
      'certificates_sent_at_required',
    ];
    const missingCons = requiredCons.filter((c) => !conNames.has(c));
    if (missingCons.length) throw new Error(`Missing constraints: ${missingCons.join(', ')}`);

    /* ── partial unique indexes (the idempotency guarantee) ─────────────── */
    const idx = await db.pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'certificates'
        AND indexname IN ('uq_certificates_student_level', 'uq_certificates_student_tournament')
    `);
    const idxNames = new Set(idx.rows.map((r) => r.indexname));
    const missingIdx = ['uq_certificates_student_level', 'uq_certificates_student_tournament']
      .filter((i) => !idxNames.has(i));
    if (missingIdx.length) throw new Error(`Missing unique indexes: ${missingIdx.join(', ')}`);

    /* ── the settings row must exist: the app reads id = 1 unconditionally ── */
    const seed = await db.pool.query(`SELECT id FROM certificate_settings WHERE id = 1`);
    if (!seed.rows.length) {
      throw new Error('certificate_settings row id=1 is missing — the app requires it');
    }

    console.log(
      'CERTIFICATES MIGRATION OK — certificates, certificate_settings, ' +
      'certificate_number_counters, constraints and unique indexes verified.'
    );
    process.exit(0);
  } catch (error) {
    console.error('CERTIFICATES MIGRATION FAILED:', error.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();