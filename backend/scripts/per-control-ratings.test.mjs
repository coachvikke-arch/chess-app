/* ──────────────────────────────────────────────────────────────────────────
 * Per-time-control ratings: write path, replay and single source of truth.
 *
 * These tests pin the properties the rating repair exists to guarantee, using an
 * in-memory stand-in for Postgres (no live row is read or written):
 *
 *   1. A result only moves the pool of ITS OWN class. A Rapid game must leave
 *      Bullet, Blitz and Classical untouched — the reported bug was one
 *      continuous chain across all four.
 *   2. "Peak" is monotonic and only moves when the new rating exceeds it.
 *   3. A game id is rated exactly once, even if the finish path runs twice.
 *   4. Within one class, game N's "before" is game N-1's "after".
 *   5. Nothing in the rated flow reads the legacy `students.current_rating`
 *      aggregate (it is only WRITTEN, as a Rapid display mirror).
 *   6. Replaying corrupted history rebuilds one chain per class from the
 *      starting rating, so the migration converges on the live formula.
 *   7. The profile's Rapid rating IS the latest Rapid history row's "after",
 *      and its peak covers the highest "after" — the two visible numbers that
 *      disagreed on the profile page.
 *
 * Run: node --test scripts/per-control-ratings.test.mjs   (from backend/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');

const db = require(join(BACKEND, 'src', 'config', 'database.js'));
const rating = require(join(BACKEND, 'src', 'services', 'ratingService.js'));
const replay = require(join(BACKEND, 'scripts', 'lib', 'perControlReplay.js'));

/* ── in-memory Postgres stand-in ─────────────────────────────────────────── */

function seedPool(studentId, timeClass, value, peak, games = 40) {
  return {
    student_id: studentId,
    time_class: timeClass,
    rating: value,
    peak_rating: peak,
    highest_level: 1,
    games_played: games,
    provisional_games: Math.max(0, 20 - games),
  };
}

function makeStore({ students = [], pools = [] } = {}) {
  const store = {
    students: new Map(students.map((s) => [s.id, { ...s }])),
    pools: new Map(pools.map((p) => [`${p.student_id}:${p.time_class}`, { ...p }])),
    tcHistory: [],
    rhHistory: [],
    sql: [],
    connects: 0,
  };

  const poolAt = (studentId, timeClass) => store.pools.get(`${studentId}:${timeClass}`);

  const client = {
    release() {},
    async query(sql, params = []) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      store.sql.push(flat);

      if (flat === 'BEGIN' || flat === 'COMMIT' || flat === 'ROLLBACK') return { rows: [] };

      if (flat.startsWith('SELECT id FROM students')) {
        return { rows: params[0].map((id) => ({ id })) };
      }

      if (flat.startsWith('SELECT 1 FROM time_control_rating_history')) {
        const [tournamentId, onlineId] = params;
        const hit = store.tcHistory.find((h) => (
          (tournamentId != null && h.tournament_game_id === tournamentId)
          || (onlineId != null && h.online_game_id === onlineId)
        ));
        return { rows: hit ? [{ hit: 1 }] : [] };
      }

      if (flat.startsWith('INSERT INTO student_time_ratings')) {
        const [studentId, timeClass, start] = params;
        if (!poolAt(studentId, timeClass)) {
          store.pools.set(`${studentId}:${timeClass}`, {
            student_id: studentId,
            time_class: timeClass,
            rating: start,
            peak_rating: start,
            highest_level: 1,
            games_played: 0,
            provisional_games: 20,
          });
        }
        return { rows: [] };
      }

      if (flat.startsWith('SELECT * FROM student_time_ratings')) {
        const [studentId, timeClass] = params;
        const p = poolAt(studentId, timeClass);
        return { rows: p ? [{ ...p }] : [] };
      }

      if (flat.startsWith('UPDATE student_time_ratings')) {
        const [value, level, studentId, timeClass] = params;
        const p = poolAt(studentId, timeClass);
        p.rating = value;
        p.peak_rating = Math.max(p.peak_rating, value);
        p.highest_level = Math.max(p.highest_level, level);
        p.games_played += 1;
        p.provisional_games = Math.max(0, p.provisional_games - 1);
        return { rows: [] };
      }

      if (flat.startsWith('INSERT INTO time_control_rating_history')) {
        const [student_id, time_class, opponent_id, opponent_name, result,
          rating_before, rating_after, rating_change, time_control, game_type,
          online_game_id, tournament_game_id] = params;
        store.tcHistory.push({
          id: store.tcHistory.length + 1, student_id, time_class, opponent_id,
          opponent_name, result, rating_before, rating_after, rating_change,
          time_control, game_type, online_game_id, tournament_game_id,
        });
        return { rows: [] };
      }

      if (flat.startsWith('INSERT INTO rating_history')) {
        const [student_id, opponent_id, opponent_name, result, rating_before,
          rating_after, rating_change, time_control, time_class, game_type,
          online_game_id, tournament_game_id] = params;
        store.rhHistory.push({
          id: store.rhHistory.length + 1, student_id, opponent_id, opponent_name,
          result, rating_before, rating_after, rating_change, time_control,
          time_class, game_type, online_game_id, tournament_game_id,
        });
        return { rows: [] };
      }

      if (flat.startsWith('UPDATE students SET current_rating')) {
        const [after, level, studentId] = params;
        const s = store.students.get(studentId);
        s.current_rating = after;
        s.peak_rating = Math.max(s.peak_rating, after);
        s.highest_level = Math.max(s.highest_level, level);
        s.games_played += 1;
        return { rows: [] };
      }

      if (flat.startsWith('UPDATE students SET highest_level')) {
        const [level, studentId] = params;
        const s = store.students.get(studentId);
        s.highest_level = Math.max(s.highest_level, level);
        s.games_played += 1;
        return { rows: [] };
      }

      if (flat.startsWith('INSERT INTO student_levels')) return { rows: [] };

      throw new Error(`unexpected SQL in rating flow: ${flat.slice(0, 120)}`);
    },
  };

  return { store, client };
}

function withFakeDb(store, client, fn) {
  const originalConnect = db.pool.connect;
  db.pool.connect = async () => { store.connects += 1; return client; };
  return Promise.resolve(fn()).finally(() => { db.pool.connect = originalConnect; });
}

const TWO = [
  { id: 1, current_rating: 1000, peak_rating: 1000, highest_level: 1, games_played: 0 },
  { id: 2, current_rating: 1000, peak_rating: 1000, highest_level: 1, games_played: 0 },
];

function playResult({ tc = '10+0', playerScore = 1, onlineGameId = null, tournamentGameId = null } = {}) {
  return rating.applyGameResult({
    player: { studentId: 1, score: playerScore },
    opponent: { studentId: 2, score: 1 - playerScore },
    meta: { timeControl: tc, gameType: 'official', onlineGameId, tournamentGameId },
  });
}

/* ── 1. one class per result ─────────────────────────────────────────────── */

test('a Rapid game cannot move Bullet, Blitz or Classical', async () => {
  const pools = [
    seedPool(1, 'bullet', 1150, 1200),
    seedPool(1, 'blitz', 1050, 1100),
    seedPool(1, 'rapid', 1032, 1054, 30),
    seedPool(1, 'classical', 1037, 1060),
    seedPool(2, 'rapid', 1040, 1060, 30),
  ];
  const { store, client } = makeStore({ students: TWO, pools });

  await withFakeDb(store, client, () => playResult({ tc: '10+0', playerScore: 1 }));

  assert.equal(store.pools.get('1:rapid').rating, 1042, 'Rapid moved by the Elo delta');
  assert.equal(store.pools.get('1:bullet').rating, 1150, 'Bullet must not move');
  assert.equal(store.pools.get('1:blitz').rating, 1050, 'Blitz must not move');
  assert.equal(store.pools.get('1:classical').rating, 1037, 'Classical must not move');
  assert.equal(store.pools.get('2:rapid').rating, 1030, 'the opponent moved in Rapid only');

  /* Every history row carries the class it was played in, and the before/after
     it was scored with — no combined chain anywhere. */
  const rows = store.rhHistory;
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.time_class, 'rapid');
    assert.equal(r.rating_after - r.rating_before, r.rating_change);
  }
  assert.equal(rows.find((r) => r.student_id === 1).rating_before, 1032);
  assert.equal(rows.find((r) => r.student_id === 1).rating_after, 1042);

  /* The legacy aggregate mirrors Rapid only. */
  assert.equal(store.students.get(1).current_rating, 1042);
});

test('a Blitz game leaves students.current_rating untouched', async () => {
  const pools = [
    seedPool(1, 'blitz', 1010, 1030, 30),
    seedPool(2, 'blitz', 1010, 1030, 30),
  ];
  const { store, client } = makeStore({
    students: [
      { id: 1, current_rating: 1200, peak_rating: 1250, highest_level: 2, games_played: 50 },
      { id: 2, current_rating: 1180, peak_rating: 1190, highest_level: 2, games_played: 44 },
    ],
    pools,
  });

  await withFakeDb(store, client, () => playResult({ tc: '5+0' }));

  assert.equal(store.pools.get('1:blitz').rating, 1020);
  assert.equal(store.students.get(1).current_rating, 1200, 'a Blitz game must not move the Rapid mirror');
  assert.equal(store.students.get(1).games_played, 51, 'the counters still advance');
});

/* ── 2. peak ─────────────────────────────────────────────────────────────── */

test('peak only moves when the new rating beats it', async () => {
  const below = makeStore({
    students: TWO,
    pools: [seedPool(1, 'rapid', 1100, 1300, 40), seedPool(2, 'rapid', 1100, 1300, 40)],
  });
  await withFakeDb(below.store, below.client, () => playResult({ playerScore: 1 }));
  assert.equal(below.store.pools.get('1:rapid').rating, 1110);
  assert.equal(below.store.pools.get('1:rapid').peak_rating, 1300, 'peak stays above the new rating');

  const above = makeStore({
    students: TWO,
    pools: [seedPool(1, 'rapid', 1100, 1100, 40), seedPool(2, 'rapid', 1100, 1100, 40)],
  });
  await withFakeDb(above.store, above.client, () => playResult({ playerScore: 1 }));
  assert.equal(above.store.pools.get('1:rapid').rating, 1110);
  assert.equal(above.store.pools.get('1:rapid').peak_rating, 1110, 'a new high moves the peak');

  /* A loss never lowers the peak. */
  await withFakeDb(above.store, above.client, () => playResult({ playerScore: 0 }));
  assert.equal(above.store.pools.get('1:rapid').rating, 1099);
  assert.equal(above.store.pools.get('1:rapid').peak_rating, 1110);
});

/* ── 3. idempotency ──────────────────────────────────────────────────────── */

test('the same onlineGameId is rated exactly once', async () => {
  const { store, client } = makeStore({
    students: TWO,
    pools: [seedPool(1, 'rapid', 1032, 1054, 30), seedPool(2, 'rapid', 1040, 1060, 30)],
  });

  await withFakeDb(store, client, () => playResult({ onlineGameId: 77 }));
  const afterFirst = store.pools.get('1:rapid').rating;
  const historyCount = store.tcHistory.length;

  const second = await withFakeDb(store, client, () => playResult({ onlineGameId: 77 }));

  assert.equal(second.timeClass, 'rapid');
  assert.equal(store.pools.get('1:rapid').rating, afterFirst, 'a retried finish must not move the pool');
  assert.equal(store.tcHistory.length, historyCount, 'no duplicate history row');
  assert.equal(store.rhHistory.length, historyCount, 'both tables stay in step');
});

/* ── 4. per-class chain ──────────────────────────────────────────────────── */

test('each control forms its own before → after chain', async () => {
  const { store, client } = makeStore({ students: TWO });

  await withFakeDb(store, client, async () => {
    await playResult({ tc: '10+0', playerScore: 1, onlineGameId: 1 });  // rapid
    await playResult({ tc: '5+0', playerScore: 0, onlineGameId: 2 });   // blitz
    await playResult({ tc: '10+0', playerScore: 0, onlineGameId: 3 });  // rapid
    await playResult({ tc: '30+0', playerScore: 0, onlineGameId: 4 });  // classical
    await playResult({ tc: '10+0', playerScore: 1, onlineGameId: 5 });  // rapid
  });

  const byClass = (cls) => store.rhHistory.filter((r) => r.student_id === 1 && r.time_class === cls);

  const rapid = byClass('rapid');
  assert.deepEqual(rapid.map((r) => r.rating_before), [
    rating.STARTING_RATING,
    rapid[0].rating_after,
    rapid[1].rating_after,
  ]);
  assert.equal(rapid[rapid.length - 1].rating_after, store.pools.get('1:rapid').rating);

  for (const cls of ['blitz', 'classical']) {
    const rows = byClass(cls);
    assert.equal(rows[0].rating_before, rating.STARTING_RATING, `${cls} starts from its own pool`);
  }

  /* The bug: a Rapid row's "before" used to be the BLITZ row's "after". */
  assert.notEqual(rapid[1].rating_before, byClass('blitz')[0].rating_after);

  /* Both trades see the same game — Rapid rows pair up on the game id. */
  assert.equal(store.tcHistory.length, store.rhHistory.length);
  assert.equal(store.tcHistory.length, 10);
});

/* ── 5. no shared rating reads ───────────────────────────────────────────── */

test('the write path never reads the shared students rating', async () => {
  const { store, client } = makeStore({
    students: TWO,
    pools: [seedPool(1, 'rapid', 1032, 1054, 30), seedPool(2, 'rapid', 1040, 1060, 30)],
  });

  await withFakeDb(store, client, () => playResult({ onlineGameId: 9 }));

  const studentStatements = store.sql.filter((s) => /\bstudents\b/.test(s));
  assert.ok(studentStatements.length > 0);
  for (const s of studentStatements) {
    if (s.startsWith('SELECT')) {
      assert.match(s, /^SELECT id FROM students WHERE id = ANY\(\$1\) ORDER BY id FOR UPDATE$/,
        'only the row lock may touch students rows on the read side');
    } else {
      assert.match(s, /^UPDATE students SET/, 'the mirror is write-only');
    }
  }
  assert.ok(!store.sql.some((s) => /FROM students[\s\S]*current_rating/.test(s)),
    'no rating computation may read students.current_rating');
});

/* ── 6. migration replay ─────────────────────────────────────────────────── */

/* The exact shape reported on the profile page: one chain that jumps between
   controls, with each row's "before" copied from the previous row regardless of
   its class. */
const CORRUPTED = [
  { id: 1, student_id: 1, opponent_id: 2, time_class: 'rapid', result: 'win', rating_before: 1056, rating_after: 1064, rating_change: 8, played_at: '2026-10-26T10:00:00Z', online_game_id: 101 },
  { id: 2, student_id: 1, opponent_id: 2, time_class: 'bullet', result: 'loss', rating_before: 1064, rating_after: 1052, rating_change: -12, played_at: '2026-10-26T11:00:00Z', online_game_id: 102 },
  { id: 3, student_id: 1, opponent_id: 2, time_class: 'bullet', result: 'loss', rating_before: 1052, rating_after: 1041, rating_change: -11, played_at: '2026-10-26T12:00:00Z', online_game_id: 103 },
  { id: 4, student_id: 1, opponent_id: 2, time_class: 'rapid', result: 'loss', rating_before: 1041, rating_after: 1031, rating_change: -10, played_at: '2026-10-27T09:00:00Z', online_game_id: 104 },
];

test('replay rebuilds one chain per control from the starting rating', () => {
  const { byRow, states, games } = replay.replayRows(CORRUPTED);

  assert.equal(games.length, 4, 'each gameId is its own game');

  const rapid = [byRow.get(1), byRow.get(4)];
  const bullet = [byRow.get(2), byRow.get(3)];

  assert.equal(rapid[0].ratingBefore, rating.STARTING_RATING);
  assert.equal(rapid[1].ratingBefore, rapid[0].ratingAfter,
    'the second Rapid game starts where the first ended — not at the Bullet result');
  assert.equal(bullet[0].ratingBefore, rating.STARTING_RATING,
    'Bullet has its own starting rating');
  assert.equal(bullet[1].ratingBefore, bullet[0].ratingAfter);

  for (const change of [...rapid, ...bullet]) {
    assert.equal(change.ratingAfter - change.ratingBefore, change.ratingChange);
  }

  /* Pool state after replay: rating = latest "after", peak covers every "after". */
  const rapidState = states.get('1:rapid');
  assert.equal(rapidState.rating, rapid[1].ratingAfter);
  assert.ok(rapidState.peak >= Math.max(...rapid.map((c) => c.ratingAfter)));
  assert.equal(rapidState.gamesPlayed, 2);
  assert.equal(states.get('1:bullet').gamesPlayed, 2);
});

test('replay ignores a duplicate row for a game id instead of rating it twice', () => {
  const duplicated = [
    ...CORRUPTED,
    { id: 5, student_id: 1, opponent_id: 2, time_class: 'rapid', result: 'win', rating_before: 1031, rating_after: 1041, rating_change: 10, played_at: '2026-10-27T09:00:00Z', online_game_id: 104 },
  ];

  const { duplicates, states } = replay.replayRows(duplicated);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].id, 5);
  assert.equal(duplicates[0].keptId, 4);
  assert.equal(states.get('1:rapid').gamesPlayed, 2, 'the duplicate was not replayed');
});

/* ── 7. single source of truth ───────────────────────────────────────────── */

const PROFILE_POOLS = [
  { time_class: 'bullet', rating: 962, peak_rating: 1001, games_played: 40, highest_level: 1 },
  { time_class: 'blitz', rating: 1003, peak_rating: 1020, games_played: 30, highest_level: 1 },
  { time_class: 'rapid', rating: 1042, peak_rating: 1074, games_played: 34, highest_level: 2 },
  { time_class: 'classical', rating: 1037, peak_rating: 1050, games_played: 12, highest_level: 1 },
];

/* Newest first, exactly as the query returns them. */
const PROFILE_HISTORY = [
  { id: 8, opponent_name: 'IYAPPAN', result: 'win', rating_before: 1032, rating_after: 1042, rating_change: 10, time_control: '10+0', game_type: 'official', played_at: '2026-11-10T10:00:00Z', time_class: 'rapid' },
  { id: 7, opponent_name: 'KAVIN', result: 'loss', rating_before: 1039, rating_after: 1032, rating_change: -7, time_control: '5+0', game_type: 'official', played_at: '2026-11-09T10:00:00Z', time_class: 'blitz' },
  { id: 6, opponent_name: 'ARUN', result: 'win', rating_before: 1028, rating_after: 1039, rating_change: 11, time_control: '10+0', game_type: 'official', played_at: '2026-11-08T10:00:00Z', time_class: 'rapid' },
  { id: 5, opponent_name: 'MUTHU', result: 'win', rating_before: 1018, rating_after: 1028, rating_change: 10, time_control: '10+0', game_type: 'official', played_at: '2026-11-07T10:00:00Z', time_class: 'rapid' },
];

function withProfileDb(fn) {
  const originalQuery = db.query;
  db.query = async (sql, params = []) => {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (flat.includes('FROM students s WHERE s.id = $1')) {
      return { rows: [{ id: params[0], current_rating: 1042, peak_rating: 1074, highest_level: 2, games_played: 116, provisional_games: 0, birthdate: null }] };
    }
    if (flat.includes('FROM student_levels')) return { rows: [{ level: 1, badge_name: 'Pawn', achieved_at: '2026-01-01' }, { level: 2, badge_name: 'Knight', achieved_at: '2026-10-27' }] };
    if (flat.includes('FROM student_time_ratings WHERE student_id = $1') && !flat.includes("time_class = 'rapid'")) {
      return { rows: PROFILE_POOLS.map((p) => ({ ...p })) };
    }
    if (flat.includes('FROM time_control_rating_history')) {
      return { rows: PROFILE_HISTORY.map((r) => ({ ...r })) };
    }
    throw new Error(`unexpected SQL in profile: ${flat.slice(0, 100)}`);
  };
  return Promise.resolve(fn()).finally(() => { db.query = originalQuery; });
}

test('profile Rapid equals the latest Rapid "after", and peak covers the highest', () => withProfileDb(async () => {
  const profile = await rating.buildProfile(1);

  assert.equal(profile.currentRating, 1042);
  assert.equal(profile.rapid.rating, profile.currentRating);
  assert.equal(profile.rapid.peakRating, 1074);

  assert.equal(profile.latestRapid.ratingAfter, 1042, 'latest move ends at the profile rating');
  assert.equal(profile.latestRapid.ratingBefore, 1032);

  const rapidAfters = profile.historyByClass.rapid.map((r) => r.rating_after);
  assert.equal(rapidAfters[rapidAfters.length - 1], profile.rapid.rating);
  assert.ok(profile.rapid.peakRating >= Math.max(...rapidAfters), 'peak covers every Rapid after');

  /* The chart and the card read the same source: no Blitz row sneaks into the
     Rapid series, and the feed row's class is carried through. */
  assert.ok(profile.historyByClass.rapid.every((r) => r.time_class === 'rapid'));
  assert.deepEqual(profile.historyByClass.blitz.map((r) => r.rating_after), [1032]);

  /* Tier + progress come from the champion control (Rapid 1042 → band 1000-1199). */
  assert.equal(profile.rapid.level.min, 1000);
  assert.equal(profile.rapid.pointsToNext, 1200 - 1042);
}));
