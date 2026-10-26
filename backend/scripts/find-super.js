/* temp: find a superadmin to log in with during verification */
const db = require('../src/config/database');

db.query("SELECT id, email, role, name FROM users WHERE role = 'superadmin' LIMIT 2")
  .then((r) => {
    console.log(JSON.stringify(r.rows, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.log('ERR', e.message);
    process.exit(0);
  });
