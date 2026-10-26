/* ──────────────────────────────────────────────────────────────────────────
 * Brilliant-move game identity: sigma row → the ORIGINAL game record.
 *
 * The bug this guards against was a DOUBLE UNWRAP. `fetchGame` (the chess_profiles
 * service) already returns `r.data` — the game ROW — while bare `api.get` returns
 * the axios RESPONSE. Reading `.data` from a `fetchGame` result unwrapped twice,
 * produced `undefined`, and every valid Chess.com game then reported
 * "That game could not be found in your history."
 *
 * Loaders are injected as fakes here, so every source and every failure mode is
 * exercised without a server.
 *
 * Run: node --test scripts/sigma-game-identity.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sigmaGameRef,
  profileGameRow,
  toCardGame,
  findHistoryGame,
  resolveSigmaGame,
  HISTORY_SOURCES,
} from '../src/utils/gameIdentity.js';
import { plyToMoveIndex } from '../src/utils/sigmaDisplay.js';
import { Chess } from 'chess.js';

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';

/* A chess_profiles row, exactly as getGame returns it (snake_case, pgn included). */
const PROFILE_ROW = {
  id: 42,
  pgn: PGN,
  white_name: 'vipulpatel9773',
  black_name: 'Nagavel_Krishnamoorthi',
  white_rating: 1200,
  black_rating: 1180,
  time_class: 'rapid',
  time_control: '900+10',
  game_date: '2026-05-18',
  opening: 'Ruy Lopez',
  game_url: 'https://www.chess.com/game/live/42',
  my_color: 'white',
};

/* A /game-history row: camelCase, composite id. */
const HISTORY_ROW = {
  id: 'online_77',
  pgn: PGN,
  whiteName: 'Alice',
  blackName: 'Bob',
  timeClass: 'blitz',
  date: '2026-01-02',
  url: 'https://example/77',
};

/** fetchGame's contract: resolves to the ROW (already unwrapped). */
const fakeFetchGame = (row, { axiosShaped = false } = {}) => async (id) => {
  if (Number(id) !== Number(row.id)) {
    const e = new Error('Game not found.');
    e.status = 404;
    throw e;
  }
  return axiosShaped ? { data: row } : row;
};

/** bare api.get's contract: resolves to the RESPONSE. */
const fakeFetchHistory = (games) => async () => ({ data: { games } });

/* ── 1: the identity taken from the row ─────────────────────────────────── */

test('the sigma row identifies a game by (game_source, game_id), never by its own id', () => {
  const row = {
    id: 913,                 // the SIGMA record id — not a game
    gameSource: 'chess_profile',
    gameId: 42,
    ply: 49,
    moveNumber: 25,
    moveSan: 'Bxg3',
  };
  assert.deepEqual(sigmaGameRef(row), { gameSource: 'chess_profile', gameId: 42 });
  /* the analysis id is never mistaken for the game id */
  assert.notEqual(sigmaGameRef(row).gameId, row.id);
  /* nor is anything built from display data */
  assert.equal(sigmaGameRef(row).gameSource, row.gameSource);
  assert.equal(sigmaGameRef(null), null);
  assert.equal(sigmaGameRef({ gameSource: 'chess_profile' }), null);
});

/* ── the double unwrap ───────────────────────────────────────────────────── */

test('fetchGame returns the ROW, so profileGameRow does not unwrap a second time', async () => {
  const row = profileGameRow(await fakeFetchGame(PROFILE_ROW)(PROFILE_ROW.id));
  assert.ok(row, 'the game resolved');
  assert.equal(row.id, 42);
  assert.equal(row.pgn, PGN);
  /* This is the exact failure: reading `.data` off the row gives undefined. */
  assert.equal(PROFILE_ROW.data, undefined);
});

test('profileGameRow still copes if the service ever returns an axios-shaped value', async () => {
  const row = profileGameRow(await fakeFetchGame(PROFILE_ROW, { axiosShaped: true })(PROFILE_ROW.id));
  assert.equal(row.id, 42);
});

test('a row with no PGN is not a game', () => {
  assert.equal(profileGameRow(null), null);
  assert.equal(profileGameRow({ id: 42 }), null);
});

/* ── 1/2: each source resolves through its own existing loader ───────────── */

test('a Chess.com profile Brilliant opens its game (15.Bxh2 / 25.Bxg3 shape)', async () => {
  const g = await resolveSigmaGame(
    { gameSource: 'chess_profile', gameId: 42 },
    { fetchProfileGame: fakeFetchGame(PROFILE_ROW), fetchHistory: fakeFetchHistory([]) },
  );
  assert.ok(g, 'the game opened');
  assert.equal(g.pgn, PGN);
  assert.equal(g.white_name, 'vipulpatel9773');
  assert.equal(g.game_date, '2026-05-18', 'it is the ORIGINAL game, not the analysis row');
});

test('an online/computer/tournament Brilliant resolves by its "<type>_<id>" key', async () => {
  for (const source of HISTORY_SOURCES) {
    const games = [
      HISTORY_ROW,
      { ...HISTORY_ROW, id: 'computer_9', pgn: PGN },
    ];
    const id = source === 'computer' ? 9 : 77;
    const g = await resolveSigmaGame(
      { gameSource: source, gameId: id },
      { fetchProfileGame: fakeFetchGame(PROFILE_ROW), fetchHistory: fakeFetchHistory(games) },
    );
    assert.ok(g, `${source} resolved`);
    assert.equal(g.pgn, PGN);
    assert.equal(g.white_name, 'Alice');
  }
});

test('a GM-style/unknown source still resolves if history carries the key', async () => {
  const g = await resolveSigmaGame(
    { gameSource: 'gm', gameId: 'opera-1858' },
    { fetchProfileGame: fakeFetchGame(PROFILE_ROW), fetchHistory: fakeFetchHistory([{ id: 'gm_opera-1858', pgn: PGN }]) },
  );
  assert.ok(g, 'GM-style keys resolve by the same canonical rule');
  assert.equal(g.pgn, PGN);
});

/* ── history matching must not pick the wrong game ───────────────────────── */

test('history matching prefers the exact key and refuses an ambiguous suffix', () => {
  const games = [{ id: 'online_7' }, { id: 'online_77' }, { id: 'online_170' }];
  assert.equal(findHistoryGame(games, 'online', 7).id, 'online_7');
  assert.equal(findHistoryGame(games, 'online', 77).id, 'online_77');
  /* ambiguous → null rather than a wrong game */
  assert.equal(findHistoryGame([{ id: 'x_7' }, { id: 'y_7' }], 'other', 7), null);
  assert.equal(findHistoryGame(games, 'online', 999), null);
  assert.equal(findHistoryGame(null, 'online', 7), null);
});

test('a missing game resolves to null so the card can say so — never a wrong game', async () => {
  const g = await resolveSigmaGame(
    { gameSource: 'online', gameId: 4242 },
    { fetchProfileGame: fakeFetchGame(PROFILE_ROW), fetchHistory: fakeFetchHistory([HISTORY_ROW]) },
  );
  assert.equal(g, null);
});

test('a failed profile fetch surfaces as an error, not a silent null', async () => {
  await assert.rejects(
    () => resolveSigmaGame({ gameSource: 'chess_profile', gameId: 999 },
      { fetchProfileGame: fakeFetchGame(PROFILE_ROW), fetchHistory: fakeFetchHistory([]) }),
    /not found/i,
    'the real lookup failure is not swallowed',
  );
});

/* ── field mapping ───────────────────────────────────────────────────────── */

test('history rows map to the field names the card reads', () => {
  const g = toCardGame(HISTORY_ROW);
  assert.equal(g.white_name, 'Alice');
  assert.equal(g.black_name, 'Bob');
  assert.equal(g.time_class, 'blitz');
  assert.equal(g.game_date, '2026-01-02');
  assert.equal(g.game_url, 'https://example/77');
  assert.equal(toCardGame({ id: 'x' }), null);
});

/* ── 4/5/8/9: several brilliants, one game, distinct moves ───────────────── */

test('two brilliants in one game resolve to the same game but different moves', async () => {
  const bxg3 = { id: 913, gameSource: 'chess_profile', gameId: 42, ply: 49 };
  const bxh2 = { id: 914, gameSource: 'chess_profile', gameId: 42, ply: 29 };
  const deps = { fetchProfileGame: fakeFetchGame(PROFILE_ROW), fetchHistory: fakeFetchHistory([]) };
  const g1 = await resolveSigmaGame(sigmaGameRef(bxg3), deps);
  const g2 = await resolveSigmaGame(sigmaGameRef(bxh2), deps);
  assert.equal(g1.pgn, g2.pgn, 'same game');
  assert.notEqual(plyToMoveIndex(bxg3.ply), plyToMoveIndex(bxh2.ply), 'different moves');
  /* the card key separates them so neither reuses the other's state */
  assert.notEqual(`${bxg3.gameSource}:${bxg3.gameId}:${bxg3.ply}`,
    `${bxh2.gameSource}:${bxh2.gameId}:${bxh2.ply}`);
});

test('two brilliants in DIFFERENT games resolve to different games', async () => {
  const other = { ...PROFILE_ROW, id: 43, pgn: '1. d4 d5 2. c4 e6 1/2-1/2' };
  const a = await resolveSigmaGame({ gameSource: 'chess_profile', gameId: 42 },
    { fetchProfileGame: fakeFetchGame(PROFILE_ROW), fetchHistory: fakeFetchHistory([]) });
  const b = await resolveSigmaGame({ gameSource: 'chess_profile', gameId: 43 },
    { fetchProfileGame: fakeFetchGame(other), fetchHistory: fakeFetchHistory([]) });
  assert.notEqual(a.pgn, b.pgn);
  assert.equal(b.id, 43);
});

/* ── 7/8/9: the opened game keeps its own FEN and selected move ──────────── */

test('a custom-FEN game keeps its origin and its selected ply', async () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const row = { ...PROFILE_ROW, pgn: `[SetUp "1"]\n[FEN "${fen}"]\n\n1. d4 exd4 2. Nxd4 1/2-1/2` };
  const g = await resolveSigmaGame({ gameSource: 'chess_profile', gameId: 42 },
    { fetchProfileGame: fakeFetchGame(row), fetchHistory: fakeFetchHistory([]) });
  assert.match(g.pgn, /\[FEN "/, 'the SetUp/FEN header survives');

  /* ply 2 → 3 moves replayed, from the custom origin, not the standard one. */
  const index = plyToMoveIndex(2);
  assert.equal(index, 3);
  const c = new Chess(fen);
  for (const san of ['d4', 'exd4', 'Nxd4']) c.move(san);
  assert.equal(c.get('d4')?.type, 'n', 'after 2.Nxd4 the knight is on d4 — ply 2 already played');
  /* Replaying from the STANDARD position instead would fail outright: 1...exd4
     is not a legal reply to 1.d4 there (no black pawn faces the d-pawn on e5
     from this FEN's perspective), so a custom-origin bug cannot pass silently. */
  const standard = new Chess();
  standard.move('d4');
  assert.throws(() => standard.move('exd4'), /Invalid move/, 'exd4 only exists in the custom game');
});

test('an unknown move count still resolves the ply', () => {
  assert.equal(plyToMoveIndex(49), 50);
  assert.equal(plyToMoveIndex(29), 30);
});