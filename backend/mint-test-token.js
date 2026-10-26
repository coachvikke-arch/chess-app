// One-off harness helper: mint a JWT for an existing student user (test screenshots only).
const jwt = require('jsonwebtoken');
const db = require('./src/config/database');
(async () => {
  const sid = Number(process.argv[2] || 18);
  const r = await db.query(
    'SELECT u.id, u.role, u.name, u.email FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = $1',
    [sid]
  );
  if (!r.rows.length) { console.error('no such student'); process.exit(1); }
  const token = jwt.sign(
    { id: r.rows[0].id, role: r.rows[0].role, name: r.rows[0].name, email: r.rows[0].email },
    process.env.JWT_SECRET, { expiresIn: '1h' }
  );
  console.log(JSON.stringify({ token, user: r.rows[0] }));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
