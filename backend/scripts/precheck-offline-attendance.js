/* Read-only pre-flight for migrations/add_offline_attendance_markers.sql.
   Prints counts and column names only — never connection settings. */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/chess',
});

async function main() {
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'attendance'`
  );
  const have = new Set(cols.rows.map((r) => r.column_name));
  const needed = ['attendance_date', 'type', 'marked_by', 'marked_by_name', 'marked_by_role', 'marked_at'];
  console.log('attendance columns present:', [...have].sort().join(', '));
  console.log('migration columns missing:', needed.filter((c) => !have.has(c)).join(', ') || '(none)');

  const dateExpr = have.has('attendance_date')
    ? `COALESCE(attendance_date, created_at::date)`
    : `created_at::date`;
  const typeExpr = have.has('type') ? `type` : `'offline'`;

  const totals = await pool.query(
    `SELECT count(*)::int AS rows_total,
            count(*) FILTER (WHERE class_id IS NULL)::int AS standalone,
            count(*) FILTER (WHERE ${have.has('attendance_date') ? 'class_id IS NOT NULL AND attendance_date IS NULL' : 'FALSE'})::int AS class_rows_needing_date
       FROM attendance`
  );
  console.log('row counts:', JSON.stringify(totals.rows[0]));

  const dupes = await pool.query(
    `SELECT student_id, ${dateExpr} AS d, count(*)::int AS n
       FROM attendance
      WHERE class_id IS NULL AND ${typeExpr} = 'offline'
      GROUP BY student_id, ${dateExpr}
     HAVING count(*) > 1
      ORDER BY n DESC
      LIMIT 20`
  );
  console.log('collisions that would abort the unique index:', dupes.rowCount);
  if (dupes.rowCount) console.table(dupes.rows);

  const indexes = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'attendance'`
  );
  console.log('indexes:', indexes.rows.map((r) => r.indexname).join(', '));
}

main()
  .catch((err) => { console.error('pre-check failed:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
