const { Pool } = require('pg');
require('dotenv').config();

/* DATABASE_URL wins so a managed host (Railway/Render/Neon) can inject one
   connection string without the local DB_* values silently overriding it. */
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
