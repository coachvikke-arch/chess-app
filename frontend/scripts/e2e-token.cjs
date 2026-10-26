/* Mints a JWT for the verification user using the backend's own secret, so the
 * e2e run is not blocked by the login rate limiter. */
const path = require('path');
const BACKEND = path.join(__dirname, '..', '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));
const db = require(path.join(BACKEND, 'src', 'config', 'database'));

(async () => {
  const r = await db.query('SELECT id, name, email, role FROM users WHERE email = $1', ['verify.sigma@e2e.local']);
  if (!r.rows.length) { console.error('user missing — run e2e-seed.cjs'); process.exit(1); }
  const u = r.rows[0];
  const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '2h' });
  console.log(JSON.stringify({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } }));
  await db.pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });