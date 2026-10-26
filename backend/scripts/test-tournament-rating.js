/* End-to-end check of tournament ⇄ rating integration.
 *
 * Run: node scripts/test-tournament-rating.js
 *
 * It exercises the REAL service functions (`tournamentRatingService` +
 * `ratingService`) against the REAL database, using a temporary tournament.
 * All ratings, time-control pools, levels and history rows are snapshotted and
 * restored, and the temporary tournament is deleted, so the DB is left exactly
 * as it was.
 *
 * Covered:
 *   · win moves the winner up and the loser down
 *   · the settlement is exactly-once (repeat call, page refresh, restart)
 *   · the partial UNIQUE index rejects a duplicate history row
 *   · a draw moves both players
 *   · an admin correction reverses + re-applies exactly once
 *   · submitting the SAME correction again is a no-op
 *   · reverting a result restores the pre-game ratings
 *   · abandoned / Armageddon / no-student-profile games are skipped
 *   · Game History returns the tournament entry (tournament, round, opponent
 *     rating, before/change/after, PGN/FEN) exactly once for BOTH players
 *   · the profile's latest rating is the updated one
 */
'use strict';
const assert = require('node:assert/strict');
const db = require('../src/config/database');
const TR = require('../src/services/tournamentRatingService');
const rating = require('../src/services/ratingService');
const historyController = require('../src/controllers/gameHistoryController');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';

const tournamentIds = [];
const gameIds = [];
let snap = null;
let restored = false;

const say = (msg) => console.log(msg);
const pass = (msg) => console.log(`  PASS  ${msg}`);

async function withTx(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

const ratingOf = async (studentId) => Number((await db.query(
  'SELECT current_rating, games_played, peak_rating FROM students WHERE id = $1', [studentId],
)).rows[0].current_rating);

const rowOf = async (studentId) => (await db.query(
  'SELECT current_rating, games_played, peak_rating FROM students WHERE id = $1', [studentId],
)).rows[0];

async function makeTournament(format = 'swiss', timeMinutes = 10) {
  const r = await db.query(
    `INSERT INTO tournaments (name, format, status, time_minutes, increment_seconds,
                              current_round, rounds, created_by)
     VALUES ($1, $2, 'active', $3, 5, 1, 3, NULL) RETURNING *`,
    [`ZZ rating test ${Date.now()}`, format, timeMinutes],
  );
  tournamentIds.push(r.rows[0].id);
  return r.rows[0];
}

async function makePairing(tournament, roundNo, boardNo) {
  return (await db.query(
    `INSERT INTO tournament_pairings (tournament_id, round_no, board_no, white_player, black_player)
     VALUES ($1, $2, $3, NULL, NULL) RETURNING *`,
    [tournament.id, roundNo, boardNo],
  )).rows[0];
}

async function makeGame(tournament, pairing, { white, black, result, reason, armageddon = false, pgn = PGN, moves = 5 }) {
  const r = await db.query(
    `INSERT INTO tournament_games
       (tournament_id, pairing_id, white_player, black_player, fen, pgn, moves_count,
        status, result, reason, armageddon, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'finished',$8,$9,$10,NOW()) RETURNING *`,
    [tournament.id, pairing.id, white, black, START_FEN, pgn, moves, result, reason, armageddon],
  );
  gameIds.push(r.rows[0].id);
  return r.rows[0];
}

const gameRow = async (id) => (await db.query('SELECT * FROM tournament_games WHERE id = $1', [id])).rows[0];
const historyOf = async (gameId) => (await db.query(
  'SELECT * FROM rating_history WHERE tournament_game_id = $1 ORDER BY student_id', [gameId],
)).rows;
const poolHistoryOf = async (gameId) => (await db.query(
  'SELECT * FROM time_control_rating_history WHERE tournament_game_id = $1 ORDER BY student_id', [gameId],
)).rows;

async function snapshot(ids, userIds) {
  const students = (await db.query('SELECT * FROM students WHERE id = ANY($1)', [ids])).rows;
  const pools = (await db.query('SELECT * FROM student_time_ratings WHERE student_id = ANY($1)', [ids])).rows;
  const levels = (await db.query('SELECT id FROM student_levels WHERE student_id = ANY($1)', [ids])).rows.map((r) => r.id);
  return { ids, userIds, students, pools, levels };
}

async function restore() {
  if (restored) return;
  restored = true;
  if (gameIds.length) {
    await db.query('DELETE FROM rating_history WHERE tournament_game_id = ANY($1)', [gameIds]);
    await db.query('DELETE FROM time_control_rating_history WHERE tournament_game_id = ANY($1)', [gameIds]);
  }
  if (tournamentIds.length) {
    /* Deleting the tournament cascades games/pairings. History rows are deleted
       FIRST because their FK is ON DELETE SET NULL, which would otherwise leave
       orphaned test rows behind. */
    await db.query('DELETE FROM tournaments WHERE id = ANY($1)', [tournamentIds]);
  }
  for (const s of snap.students) {
    await db.query(
      `UPDATE students
          SET current_rating = $2, peak_rating = $3, games_played = $4,
              provisional_games = $5, highest_level = $6, last_rating_change_at = $7
        WHERE id = $1`,
      [s.id, s.current_rating, s.peak_rating, s.games_played, s.provisional_games,
        s.highest_level, s.last_rating_change_at],
    );
  }
  await db.query('DELETE FROM student_time_ratings WHERE student_id = ANY($1)', [snap.ids]);
  for (const p of snap.pools) {
    await db.query(
      `INSERT INTO student_time_ratings
         (id, student_id, time_class, rating, peak_rating, highest_level,
          games_played, provisional_games, last_changed_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, p.student_id, p.time_class, p.rating, p.peak_rating, p.highest_level,
        p.games_played, p.provisional_games, p.last_changed_at, p.updated_at],
    );
  }
  await db.query(
    'DELETE FROM student_levels WHERE student_id = ANY($1) AND NOT (id = ANY($2))',
    [snap.ids, snap.levels],
  );
  await db.query("SELECT setval(pg_get_serial_sequence('student_time_ratings','id'), COALESCE((SELECT MAX(id) FROM student_time_ratings), 1))");
}

(async () => {
  await TR.ensureSchema();

  const students = (await db.query(
    `SELECT s.id, s.user_id, u.name
       FROM students s JOIN users u ON u.id = s.user_id
      WHERE s.active AND s.user_id IS NOT NULL
      ORDER BY s.id LIMIT 2`,
  )).rows;
  assert.equal(students.length, 2, 'need two students with user accounts');
  const [A, B] = students;
  const ids = [A.id, B.id];
  const userIds = [A.user_id, B.user_id];
  snap = await snapshot(ids, userIds);

  say(`\nTournament rating test — ${A.name} (student ${A.id}) vs ${B.name} (student ${B.id})`);

  try {
    /* ── 1. win ─────────────────────────────────────────────────────────── */
    say('\n[1] Win moves winner up, loser down, and records both sides');
    const t = await makeTournament('swiss');
    const p1 = await makePairing(t, 1, 1);
    const g1 = await makeGame(t, p1, { white: A.user_id, black: B.user_id, result: 'white', reason: 'checkmate' });
    await db.query('UPDATE tournament_pairings SET game_id = $2 WHERE id = $1', [p1.id, g1.id]);

    const beforeA = await ratingOf(A.id);
    const beforeB = await ratingOf(B.id);
    await withTx((c) => TR.settleFinishedGame(c, { game: { id: g1.id }, tournament: t, result: 'white' }));
    const afterA = await ratingOf(A.id);
    const afterB = await ratingOf(B.id);
    assert.ok(afterA > beforeA, `winner rating should rise (${beforeA} -> ${afterA})`);
    assert.ok(afterB < beforeB, `loser rating should fall (${beforeB} -> ${afterB})`);
    const g1row = await gameRow(g1.id);
    assert.equal(g1row.rating_status, 'applied');
    assert.equal(g1row.rating_result, 'white');
    const h1 = await historyOf(g1.id);
    assert.equal(h1.length, 2, 'one history row per player');
    const hA = h1.find((r) => r.student_id === A.id);
    assert.equal(hA.rating_before, beforeA);
    assert.equal(hA.rating_after, afterA);
    assert.equal(hA.rating_change, afterA - beforeA);
    assert.equal(hA.result, 'win');
    assert.equal(hA.time_class, 'rapid', '10+5 is a rapid game');
    assert.equal((await poolHistoryOf(g1.id)).length, 2, 'both time-control pools recorded');
    pass(`rating ${beforeA} → ${afterA} / ${beforeB} → ${afterB}, 2 history rows, pool=rapid`);

    /* ── 2. exactly once ────────────────────────────────────────────────── */
    say('\n[2] Repeating the same result (refresh / restart) is a no-op');
    await withTx((c) => TR.settleFinishedGame(c, { game: { id: g1.id }, tournament: t, result: 'white' }));
    assert.equal(await ratingOf(A.id), afterA);
    assert.equal(await ratingOf(B.id), afterB);
    assert.equal((await historyOf(g1.id)).length, 2, 'no duplicate history rows');
    pass('ratings and history unchanged after a second settlement');

    /* ── 3. database backstop ───────────────────────────────────────────── */
    say('\n[3] Partial UNIQUE index rejects a duplicate history row');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        client.query(
          `INSERT INTO rating_history
             (student_id, opponent_id, opponent_name, result, rating_before, rating_after,
              rating_change, game_type, tournament_game_id)
           VALUES ($1,$2,'dup','win',1000,1010,10,'tournament',$3)`,
          [A.id, B.id, g1.id],
        ),
        (err) => err.code === '23505',
      );
      await client.query('ROLLBACK');
      pass('duplicate (tournament_game_id, student_id) is rejected with 23505');
    } finally {
      client.release();
    }

    /* ── 4. draw + admin correction ─────────────────────────────────────── */
    say('\n[4] Draw moves both; correction reverses then applies the new result once');
    const p2 = await makePairing(t, 2, 1);
    const g2 = await makeGame(t, p2, { white: A.user_id, black: B.user_id, result: 'draw', reason: 'agreement' });
    await db.query('UPDATE tournament_pairings SET game_id = $2 WHERE id = $1', [p2.id, g2.id]);

    const preDrawA = await ratingOf(A.id);
    const preDrawB = await ratingOf(B.id);
    await withTx((c) => TR.settleFinishedGame(c, { game: { id: g2.id }, tournament: t, result: 'draw' }));
    const drawA = await ratingOf(A.id);
    const drawB = await ratingOf(B.id);
    assert.notEqual(drawA, preDrawA, 'draw must move the lower-rated player');
    assert.equal((await gameRow(g2.id)).rating_result, 'draw');
    pass(`draw ${preDrawA} → ${drawA} / ${preDrawB} → ${drawB}`);

    await withTx((c) => TR.correctPairingRating(c, { pairingId: p2.id, tournament: t, newResult: 'white' }));
    const corrA = await ratingOf(A.id);
    const corrB = await ratingOf(B.id);
    assert.ok(corrA > preDrawA, `corrected win should leave A above pre-draw (${preDrawA}, got ${corrA})`);
    assert.ok(corrB < preDrawB, `corrected win should leave B below pre-draw (${preDrawB}, got ${corrB})`);
    const h2 = await historyOf(g2.id);
    assert.equal(h2.length, 2, 'still exactly one row per player after correction');
    assert.equal(h2.find((r) => r.student_id === A.id).result, 'win');
    assert.equal(h2.find((r) => r.student_id === B.id).result, 'loss');
    assert.equal((await gameRow(g2.id)).rating_result, 'white');
    pass(`corrected ${drawA} → ${corrA} / ${drawB} → ${corrB} (reversed + re-applied, 2 rows)`);

    /* ── 5. same correction again ───────────────────────────────────────── */
    say('\n[5] Submitting the SAME correction again does not move ratings');
    await withTx((c) => TR.correctPairingRating(c, { pairingId: p2.id, tournament: t, newResult: 'white' }));
    assert.equal(await ratingOf(A.id), corrA);
    assert.equal(await ratingOf(B.id), corrB);
    assert.equal((await historyOf(g2.id)).length, 2);
    pass('idempotent correction (no double apply)');

    /* ── 6. revert ──────────────────────────────────────────────────────── */
    say('\n[6] Revert restores the pre-game ratings');
    await withTx((c) => TR.revertPairingRating(c, p2.id));
    assert.equal(await ratingOf(A.id), preDrawA);
    assert.equal(await ratingOf(B.id), preDrawB);
    assert.equal((await historyOf(g2.id)).length, 0);
    assert.equal((await gameRow(g2.id)).rating_status, 'reverted');
    pass(`reverted to ${preDrawA} / ${preDrawB}, history rows removed`);

    /* ── 7. non-rateable outcomes ───────────────────────────────────────── */
    say('\n[7] Abandoned, Armageddon and missing-student games are skipped');
    const p3 = await makePairing(t, 3, 1);
    const g3 = await makeGame(t, p3, { white: A.user_id, black: B.user_id, result: 'abandon', reason: 'forfeit_no_show', pgn: '', moves: 0 });
    const beforeSkip = await ratingOf(A.id);
    await withTx((c) => TR.settleFinishedGame(c, { game: { id: g3.id }, tournament: t, result: 'abandon' }));
    assert.equal(await ratingOf(A.id), beforeSkip);
    assert.equal((await gameRow(g3.id)).rating_status, 'skipped');
    pass('abandoned board skipped, ratings untouched');

    const p4 = await makePairing(t, 4, 1);
    const g4 = await makeGame(t, p4, { white: B.user_id, black: A.user_id, result: 'black', reason: 'armageddon', armageddon: true, pgn: '' });
    await withTx((c) => TR.settleFinishedGame(c, { game: { id: g4.id }, tournament: t, result: 'black' }));
    assert.equal(await ratingOf(A.id), beforeSkip);
    assert.equal((await gameRow(g4.id)).rating_status, 'skipped');
    pass('Armageddon tiebreak skipped (a pairing is rated once)');

    const outsider = (await db.query(
      `SELECT u.id FROM users u LEFT JOIN students s ON s.user_id = u.id
        WHERE s.id IS NULL AND u.id <> ALL($1) LIMIT 1`,
      [userIds],
    )).rows[0];
    if (outsider) {
      const p5 = await makePairing(t, 5, 1);
      const g5 = await makeGame(t, p5, { white: A.user_id, black: outsider.id, result: 'white', reason: 'resign' });
      await withTx((c) => TR.settleFinishedGame(c, { game: { id: g5.id }, tournament: t, result: 'white' }));
      assert.equal(await ratingOf(A.id), beforeSkip);
      assert.equal((await gameRow(g5.id)).rating_status, 'skipped');
      pass('game vs a user without a student profile skipped');
    } else {
      pass('no student-less user available — skipped that sub-case');
    }

    /* ── 8. knockout format ─────────────────────────────────────────────── */
    say('\n[8] Knockout: drawn board is rated, Armageddon tiebreak is not');
    const kt = await makeTournament('knockout', 10);
    const kp = await makePairing(kt, 1, 1);
    const kg = await makeGame(kt, kp, { white: A.user_id, black: B.user_id, result: 'draw', reason: 'agreement' });
    const preKnockoutA = await ratingOf(A.id);
    await withTx((c) => TR.settleFinishedGame(c, { game: { id: kg.id }, tournament: kt, result: 'draw' }));
    const postKnockoutA = await ratingOf(A.id);
    assert.notEqual(postKnockoutA, preKnockoutA);
    assert.equal((await gameRow(kg.id)).rating_status, 'applied');
    const kap = await makePairing(kt, 1, 2);
    const kag = await makeGame(kt, kap, { white: B.user_id, black: A.user_id, result: 'black', reason: 'armageddon', armageddon: true });
    await withTx((c) => TR.settleFinishedGame(c, { game: { id: kag.id }, tournament: kt, result: 'black' }));
    assert.equal(await ratingOf(A.id), postKnockoutA);
    assert.equal((await gameRow(kag.id)).rating_status, 'skipped');
    pass('drawn knockout board rated as a draw; Armageddon skipped');

    /* ── 9. Game History merge ──────────────────────────────────────────── */
    say('\n[9] History shows the tournament game once for BOTH players, with rating data');
    for (const [student, other, otherStudent] of [[A, B, B], [B, A, A]]) {
      const hist = await historyController.historyForUser(student.user_id);
      const entries = hist.games.filter((g) => g.id === `tournament_${g1.id}`);
      assert.equal(entries.length, 1, `exactly one entry for tournament game ${g1.id}`);
      const e = entries[0];
      assert.equal(e.type, 'tournament');
      assert.equal(e.tournamentName, t.name);
      assert.equal(e.roundNo, 1);
      assert.equal(e.boardNo, 1);
      assert.equal(e.opponentName, other.name);
      assert.ok(e.opponentRating != null, 'opponent rating present');
      const row = (await db.query(
        'SELECT rating_before, rating_after, rating_change FROM rating_history WHERE tournament_game_id=$1 AND student_id=$2',
        [g1.id, student.id],
      )).rows[0];
      assert.equal(e.ratingBefore, row.rating_before);
      assert.equal(e.ratingAfter, row.rating_after);
      assert.equal(e.ratingChange, row.rating_change);
      assert.equal(e.rated, true);
      assert.ok(e.pgn && e.fen, 'replay payload present');
      pass(`${student.name}: ${e.resultLabel}, ${e.ratingBefore} ${e.ratingChange >= 0 ? '+' : ''}${e.ratingChange} → ${e.ratingAfter}, vs ${e.opponentName} (${e.opponentRating}) R${e.roundNo}/B${e.boardNo}`);
    }
    const aHist = await historyController.historyForUser(A.user_id);
    assert.ok(aHist.games.some((g) => g.id === `tournament_${g2.id}`), 'reverted game still appears (unrated)');
    for (let i = 1; i < aHist.games.length; i += 1) {
      assert.ok(new Date(aHist.games[i - 1].date) >= new Date(aHist.games[i].date), 'history is newest-first');
    }
    pass('reverted game kept in history as unrated; list sorted newest-first');

    /* ── 10. admin member list ──────────────────────────────────────────── */
    say('\n[10] Admin member list includes tournament participation without error');
    let body = null;
    const res = {
      json: (x) => { body = x; },
      status(c) { return { json: (x) => { body = { status: c, ...x }; } }; },
    };
    const adminId = (await db.query("SELECT id FROM users WHERE role='superadmin' ORDER BY id LIMIT 1")).rows[0].id;
    await historyController.adminHistory({ user: { id: adminId, role: 'superadmin' }, query: {} }, res);
    assert.ok(body && Array.isArray(body.members), 'member list returned');
    const member = body.members.find((m) => Number(m.user_id) === Number(A.user_id));
    assert.ok(member, 'tournament player appears in the member list');
    assert.ok(Number(member.games) >= 2, `member games count includes tournaments (got ${member.games})`);
    pass(`member row ${member.name}: ${member.games} games, ${member.wins}W ${member.losses}L ${member.draws}D`);

    /* ── 11. profile ────────────────────────────────────────────────────── */
    say('\n[11] Profile reports the latest rating');
    const profile = await rating.buildProfile(A.id);
    assert.equal(Number(profile.currentRating), Number((await rowOf(A.id)).current_rating));
    pass(`profile rating = ${profile.currentRating}`);

    say('\nAll tournament rating checks passed.\n');
  } finally {
    try { await restore(); say('Test data cleaned up; ratings restored.\n'); }
    catch (err) { console.error('CLEANUP FAILED — restore ratings manually:', err.message); process.exitCode = 1; }
    await db.pool.end();
  }
})().catch(async (err) => {
  console.error('\nTEST FAILED:', err);
  process.exitCode = 1;
  try { if (snap) await restore(); } catch (e) { console.error('cleanup failed:', e.message); }
  try { await db.pool.end(); } catch (_) { /* ignore */ }
});
