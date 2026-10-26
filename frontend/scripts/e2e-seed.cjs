/* Seeds a verification user + a Chess Profile game + two Sigma rows so the
 * real browser flows can be exercised end to end. Idempotent. */
const path = require('path');
const BACKEND = path.join(__dirname, '..', '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const bcrypt = require(path.join(BACKEND, 'node_modules', 'bcryptjs'));
const db = require(path.join(BACKEND, 'src', 'config', 'database'));
const { Chess } = require(path.join(__dirname, '..', 'node_modules', 'chess.js'));

const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'O-O', 'Nf6', 'Nc3', 'b6',
  'd3', 'Bb7', 'Be3', 'Be7', 'h3', 'Nd4', 'Nxd4', 'exd4', 'Bxd4', 'c5', 'Be3',
  'd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd5', 'Bb5+', 'Kf8', 'c4', 'Be6', 'Qd2', 'a6',
  'Ba4', 'Bd6', 'Rad1', 'g5', 'Rfe1', 'Rg8', 'Re2', 'Ke7', 'Rde1', 'Qc7', 'Qc3',
  'g4', 'hxg4', 'Rxg4', 'Bxh6', 'Rag8', 'g3', 'Bxg3', 'fxg3', 'Qxg3+', 'Kf1', 'Qg1#'];

const PGN = `[Event "Verification"]\n[Site "https://www.chess.com/game/live/verify1"]\n[Date "2026.05.18"]\n[White "vipulpatel9773"]\n[Black "Nagavel_Krishnamoorthi"]\n[Result "1-0"]\n[WhiteElo "1200"]\n[BlackElo "1180"]\n[TimeControl "900+10"]\n[ECO "B13"]\n[Opening "Caro-Kann Defense: Exchange Variation"]\n\n1. ${SANS.join(' ')} 1-0`;

const BXG3 = SANS.indexOf('Bxg3');
const BXH2 = SANS.indexOf('Bxh6'); // a second brilliant-ish marker; any ply works

(async () => {
  const email = 'verify.sigma@e2e.local';
  const password = 'Verify123!';
  const hash = await bcrypt.hash(password, 10);

  let user = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  let userId;
  if (user.rows.length) {
    userId = user.rows[0].id;
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hash, userId]);
  } else {
    const ins = await db.query(
      `INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,'student') RETURNING id`,
      ['Verify Sigma', email, hash],
    );
    userId = ins.rows[0].id;
  }

  const account = await db.query(
    `INSERT INTO connected_chess_accounts (user_id, platform, username, status)
     VALUES ($1,'chess.com','verify_sigma','connected') RETURNING id`,
    [userId],
  );
  const accountId = account.rows[0].id;

  const g = await db.query(
    `INSERT INTO chess_games (account_id, platform_game_id, game_date, end_time_ms,
       white_name, black_name, white_rating, black_rating, result, my_color,
       time_control, time_class, opening, eco, pgn, game_url, moves_count)
     VALUES ($1,'verify1',DATE '2026-05-18', 1, 'vipulpatel9773','Nagavel_Krishnamoorthi',
       1200,1180,'white','white','900+10','rapid','Caro-Kann Defense: Exchange Variation','B13',
       $2,'https://www.chess.com/game/live/verify1',$3)
     RETURNING id`,
    [accountId, PGN, SANS.length],
  );
  const gameId = g.rows[0].id;

  // Two sigma rows for the SAME game at different plies.
  const chess = new Chess();
  const fens = [chess.fen()];
  for (const san of SANS) { chess.move(san); fens.push(chess.fen()); }

  for (const [idx, type] of [[BXG3, 'bishop_sacrifice'], [BXH2, 'bishop_sacrifice']]) {
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

  console.log(JSON.stringify({ email, password, userId, gameId, plyBxg3: BXG3, plyBxh6: BXH2 }));
  await db.pool.end();
})().catch(async (e) => { console.error('SEED FAILED:', e.message); process.exit(1); });