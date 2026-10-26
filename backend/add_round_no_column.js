const { Pool } = require('pg');

const pool = new Pool({
  port: 5432,
  database: 'chess_academy',
  user: 'postgres',
  host: 'localhost'
});

pool.query(
  `DO $$
  BEGIN
    -- Add the column if it doesn't exist (with default 1 for future rows)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tournament_pairings' AND column_name = 'round_no') THEN
      EXECUTE 'ALTER TABLE tournament_pairings ADD COLUMN round_no INTEGER NOT NULL DEFAULT 1';
    END IF;

    -- Update any existing rows that have NULL round_no to the default value
    EXECUTE 'UPDATE tournament_pairings SET round_no = 1 WHERE round_no IS NULL';
    
    RAISE NOTICE 'tournament_pairings round_no column ensured with default 1';
  END $$;`,
  (err, res) => {
    if (err) {
      console.error('Error ensuring round_no column:', err.message);
    } else {
      console.log('Round no column ensured:', res);
    }
    pool.end();
  }
);