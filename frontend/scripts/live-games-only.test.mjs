// Regression tests for the Live games list in Play Arena.
//   run with: node --test scripts/live-games-only.test.mjs   (from frontend/)
//
// The list must contain ONLY genuinely active boards. Before this change a
// finished match stayed on screen until the next 5s poll because `game-update`
// only reaches the two players, so a spectator's card sat there looking live.
// The server now broadcasts a neutral `live-games-changed` on finish/abort and
// the open list drops exactly that card immediately; the poll stays as the
// fallback and Game History keeps every row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const board = read('src', 'pages', 'AnalysisBoard.jsx');
const socket = read('src', 'services', 'socket.js');
const backend = readFileSync(join(ROOT, '..', 'backend', 'src', 'controllers', 'onlineController.js'), 'utf8');
const socketServer = readFileSync(
  join(ROOT, '..', 'backend', 'src', 'socket', 'liveClassSocket.js'), 'utf8'
);

test('the server announces every finish path with one neutral event', () => {
  const start = backend.indexOf('function broadcastLiveEnded');
  assert.ok(start > -1, 'the broadcaster exists');
  const fn = backend.slice(start, backend.indexOf('function emitGameUpdate', start));
  assert.match(fn, /row\.status !== 'finished' && row\.status !== 'aborted'/, 'only final statuses are announced');
  assert.match(fn, /io\.emit\('live-games-changed', \{ gameId: row\.id, status: row\.status \}\)/,
    'a global (all viewers) signal carrying only the id and status');
  assert.ok(!/name|resultReason|pgn|fen/.test(fn), 'no position or identity leaks to non-participants');

  const emit = backend.slice(backend.indexOf('function emitGameUpdate'), backend.indexOf('const START_FEN'));
  assert.match(emit, /broadcastLiveEnded\(io, row\)/,
    'every endpoint that already calls emitGameUpdate now announces the end too');
  assert.ok(
    emit.indexOf('broadcastLiveEnded(io, row)') > emit.indexOf("'game-update', wrapped"),
    'the end signal follows the per-player update'
  );
});

test('repeat emits for the same finish are collapsed', () => {
  const fn = backend.slice(backend.indexOf('function broadcastLiveEnded'), backend.indexOf('function emitGameUpdate'));
  assert.match(fn, /liveEndedSeen\.get\(row\.id\)/, 'de-duplicates per game');
  assert.match(fn, /last\.status === row\.status && Date\.now\(\) - last\.at < 10000/, 'short suppression window');
  assert.match(fn, /liveEndedSeen\.delete\(row\.id\)/, 'the guard map is cleaned up');
});

test('the live feed itself is active-only (server authority, not timers)', () => {
  const start = backend.indexOf('exports.listLive');
  const feed = backend.slice(start, backend.indexOf('exports.spectateGame', start));
  assert.match(feed, /g\.status = 'active'/, 'the global feed reads the authoritative status column');
  assert.ok(!/white_ms|black_ms|Date\.now\(\)/.test(feed.slice(feed.indexOf(': `g.status = \'active\'`'))),
    'a card is never included or excluded by a client-side clock');
});

test('finished rows are kept, never deleted', () => {
  assert.ok(!/DELETE\s+FROM\s+online_games/i.test(backend), 'the match row survives for Game History');
});

test('the client can subscribe to the end signal and unsubscribe', () => {
  assert.match(socket, /export function onLiveGamesChanged\(callback\) \{\s*return on\('live-games-changed', callback\);/,
    'one helper, built on the shared subscribe/off plumbing');
  assert.match(socket, /export function on\(event, cb\) \{[\s\S]*s\.on\(event, cb\);[\s\S]*return \(\) => s\.off\(event, cb\);/,
    'the returned unsubscribe removes exactly this listener');
});

test('the open list drops that one card immediately', () => {
  assert.match(board, /import \{[\s\S]*onLiveGamesChanged,[\s\S]*\} from '\.\.\/services\/socket';/,
    'AnalysisBoard imports the helper');
  const effect = board.slice(board.indexOf('keep the live-games modal fresh'), board.indexOf('broadcast live updates of my computer game'));
  assert.match(effect, /if \(activePopup !== 'live'\) return undefined;/, 'no listener while the popup is closed');
  assert.match(effect, /onLiveGamesChanged\(\(evt\) => \{[\s\S]*const id = evt\?\.gameId;/, 'reads the finished game id');
  assert.match(effect, /setLiveSessions\(\(prev\) => prev\.filter\(/, 'removes locally, without a refetch or flicker');
  assert.match(effect, /s\.type === 'online' && String\(s\.gameId\) === String\(id\)/,
    'only the finished match is removed; every other card stays');
  assert.match(effect, /return \(\) => \{ clearInterval\(t\); offEnded\(\); \};/,
    'both the poll and the socket listener are cleaned up on close');
});

test('polling remains the fallback and still filters to active games', () => {
  assert.match(board, /const rows = await listLiveSessions\(\);[\s\S]*filter\(\(s\) => s\.status === 'active'\)/,
    'any row the server reports as finished is excluded even without an event');
  const effect = board.slice(board.indexOf('keep the live-games modal fresh'), board.indexOf('broadcast live updates of my computer game'));
  assert.match(effect, /setInterval\(refreshLive, 5000\)/, 'the safety-net poll is unchanged');
});

test('a disconnect is not an ending', () => {
  assert.ok(!/live-games-changed/.test(socketServer),
    'only the game status moves a card off the list — not join/leave/disconnect handlers');
});

test('the live card keeps names, ratings, clocks and the Watch action', () => {
  const popup = board.slice(board.indexOf('── Live games'), board.indexOf('── Annotate & Save'));
  assert.match(popup, /s\.whiteName/, 'white player name');
  assert.match(popup, /s\.blackName/, 'black player name');
  assert.match(popup, /whiteRating/, 'white rating when present');
  assert.match(popup, /blackRating/, 'black rating when present');
  assert.match(popup, /Watch →/, 'watch action');
  assert.match(popup, /liveSessions\.length\} live/, 'live count badge');
});
