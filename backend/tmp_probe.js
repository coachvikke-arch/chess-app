require('dotenv').config();
const { Client } = require('pg');
const { movesFromPgn } = require('./src/services/pgnUtils');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const a = await c.query('select id,user_id,platform,username from connected_chess_accounts order by id');
  console.log('ACCOUNTS', JSON.stringify(a.rows));
  const g = await c.query(`select account_id, count(*) n,
      sum(case when pgn <> '' then 1 else 0 end) withpgn
      from chess_games group by account_id order by account_id`);
  console.log('GAMES', JSON.stringify(g.rows));
  const u = await c.query('select id, name, role from users order by id');
  console.log('USERS', JSON.stringify(u.rows));
  /* move-count consistency across every stored game */
  const all = await c.query('select id, moves_count, pgn from chess_games');
  let mismatch = 0; let empty = 0; const samples = [];
  for (const row of all.rows) {
    if (!row.pgn) { empty++; continue; }
    const n = movesFromPgn(row.pgn).length;
    if (Number(row.moves_count) !== n) {
      mismatch++;
      if (samples.length < 8) samples.push({ id: row.id, stored: row.moves_count, parsed: n });
    }
  }
  console.log('TOTAL', all.rows.length, 'noPgn', empty, 'mismatch', mismatch);
  console.log('SAMPLES', JSON.stringify(samples));

  // Ground truth via chess.js (the canonical parser used by the analysis pipeline)
  const { Chess } = require('chess.js');
  let gtWrong = 0;
  const gtSamples = [];
  let parsedWrong = 0;
  const headerFirst = {};
  for (const row of all.rows) {
    if (!row.pgn) continue;
    let n = null;
    try {
      const g = new Chess();
      g.loadPgn(row.pgn, { strict: false });
      n = g.history().filter(Boolean).length;
    } catch (e) {
      n = -1;
    }
    const p = movesFromPgn(row.pgn).length;
    if (p !== n) parsedWrong++;
    if (n !== Number(row.moves_count)) {
      gtWrong++;
      if (gtSamples.length < 10) {
        gtSamples.push({ id: row.id, stored: row.moves_count, chessjs: n, legacy: p });
      }
    }
    // how far into the file does the legacy splitter start the movetext?
    const idx = row.pgn.indexOf(row.pgn.match(/\[(White|Black|Result|WhiteElo|BlackElo|Opening|ECO|TimeControl|Date|Round|Site|Event)/)?.[0] || 'x');
    if (idx >= 0) headerFirst[row.pgn.slice(idx, idx + 12)] = (headerFirst[row.pgn.slice(idx, idx + 12)] || 0) + 1;
  }
  console.log('GROUND TRUTH (chess.js) wrong stored counts:', gtWrong, 'of', all.rows.length);
  console.log('GT SAMPLES', JSON.stringify(gtSamples));
  console.log('legacy parser != chess.js on', parsedWrong, 'games');
  console.log('HEADER ORDER SAMPLE', JSON.stringify(Object.entries(headerFirst).slice(0, 15)));

  for (const id of [101695, 94683]) {
    const row = all.rows.find((r) => r.id === id);
    if (!row) continue;
    console.log('\n===== GAME', id, 'stored', row.moves_count, '=====');
    console.log(JSON.stringify(row.pgn));
    const g = new Chess();
    try { g.loadPgn(row.pgn, { strict: false }); console.log('chess.js history len', g.history().length); console.log('chess.js history', JSON.stringify(g.history())); }
    catch (e) { console.log('chess.js threw:', e.message); }
    console.log('legacy tokens', JSON.stringify(movesFromPgn(row.pgn)));
  }
  await c.end();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });

