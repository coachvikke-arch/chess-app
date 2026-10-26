/* Re-creates the two Sigma rows for the verification game so each browser run
 * starts from a known state.
 *
 * WHY THIS EXISTS. Analysing the game makes the backend recompute that game's
 * Sigma rows and replace the seeded ones with the rows the classifier actually
 * endorses (only 25...Bxg3 survives; 24...Bxh6 is graded `great`, not brilliant).
 * That is correct behaviour, not a bug — but it means a SECOND e2e run would
 * start with one card instead of two and could not exercise the "two brilliant
 * moves in one game" path. This restores the pair deterministically.
 *
 * Idempotent: ON CONFLICT DO NOTHING. Safe to run before every verification. */
const path = require('path');
const BACKEND = path.join(__dirname, '..', '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const db = require(path.join(BACKEND, 'src', 'config', 'database'));
const { Chess } = require(path.join(__dirname, '..', 'node_modules', 'chess.js'));

const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'O-O', 'Nf6', 'Nc3', 'b6',
  'd3', 'Bb7', 'Be3', 'Be7', 'h3', 'Nd4', 'Nxd4', 'exd4', 'Bxd4', 'c5', 'Be3',
  'd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd5', 'Bb5+', 'Kf8', 'c4', 'Be6', 'Qd2', 'a6',
  'Ba4', 'Bd6', 'Rad1', 'g5', 'Rfe1', 'Rg8', 'Re2', 'Ke7', 'Rde1', 'Qc7', 'Qc3',
  'g4', 'hxg4', 'Rxg4', 'Bxh6', 'Rag8', 'g3', 'Bxg3', 'fxg3', 'Qxg3+', 'Kf1', 'Qg1#'];

const BXG3 = SANS.indexOf('Bxg3');
const BXH6 = SANS.indexOf('Bxh6');

(async () => {
  const u = await db.query('SELECT id FROM users WHERE email = $1', ['verify.sigma@e2e.local']);
  if (!u.rows.length) { console.error('RESET FAILED: verification user missing — run e2e-seed.cjs'); process.exit(1); }
  const userId = u.rows[0].id;
  const g = await db.query(
    `SELECT g.id FROM chess_games g JOIN connected_chess_accounts a ON a.id = g.account_id
      WHERE a.user_id = $1 AND g.platform_game_id = 'verify1'`,
    [userId],
  );
  if (!g.rows.length) { console.error('RESET FAILED: verification game missing — run e2e-seed.cjs'); process.exit(1); }
  const gameId = g.rows[0].id;

  const chess = new Chess();
  const fens = [chess.fen()];
  for (const san of SANS) { chess.move(san); fens.push(chess.fen()); }

  for (const [idx, type] of [[BXG3, 'bishop_sacrifice'], [BXH6, 'bishop_sacrifice']]) {
    const mv = chess.history({ verbose: true })[idx];
    await db.query(
      `INSERT INTO sigma_moves (owner_user_id, game_source, game_id, ply, sigma_type,
         move_san, from_square, to_square, fen_before, played_at, white_name, black_name,
         white_rating, black_rating)
       VALUES ($1,'chess_profile',$2,$3,$4,$5,$6,$7,$8,DATE '2026-05-18',
         'vipulpatel9773','Nagavel_Krishnamoorthi',1200,1180)
       ON CONFLICT (game_source, game_id, ply) DO NOTHING`,
      [userId, gameId, idx, type, mv.san, mv.from, mv.to, fens[idx]],
    );
  }
  const rows = await db.query(
    'SELECT id, ply, move_san FROM sigma_moves WHERE game_source = $1 AND game_id = $2 ORDER BY ply',
    ['chess_profile', gameId],
  );
  console.log(JSON.stringify({ userId, gameId, sigmaRows: rows.rows }));
  await db.pool.end();
})().catch((e) => { console.error('RESET FAILED:', e.message); process.exit(1); });