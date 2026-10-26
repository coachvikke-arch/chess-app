const db = require('../src/config/database');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS course_documents (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      original_name VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(50) NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('course_documents table created');
  process.exit(0);
}

migrate().catch((e) => { console.error(e); process.exit(1); });
