// Regression tests for the Online Match opponent cards.
//   run with: node --test scripts/online-player-picker.test.mjs   (from frontend/)
//
// The picker used to be a bare <select>-style popup with names only. It now
// shows one card per player with the same photo/avatar the profile page uses,
// the rating for the selected clock, an online badge only when the server can
// prove it, a name search, and explicit loading/empty/error states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  RATING_CLASS_BY_FAMILY,
  filterOnlinePlayers,
  ratingForPlayer,
  ratingPoolLabel,
} from '../src/utils/onlinePlayers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const board = read('src', 'pages', 'AnalysisBoard.jsx');
const css = read('src', 'index.css');
const backend = readFileSync(join(ROOT, '..', 'backend', 'src', 'controllers', 'onlineController.js'), 'utf8');

const players = [
  { id: 1, name: 'Aarav', role: 'student', online: true, rapid_rating: 1310 },
  { id: 2, name: 'Bhavya', role: 'student', online: false, rapid_rating: null },
  { id: 3, name: 'Coach Meera', role: 'coach', online: true, rapid_rating: 1800 },
];

test('search is case-insensitive and matches part of the name', () => {
  assert.deepEqual(filterOnlinePlayers(players, { query: 'aar' }).map((p) => p.id), [1]);
  assert.deepEqual(filterOnlinePlayers(players, { query: '  COACH ' }).map((p) => p.id), [3]);
  assert.equal(filterOnlinePlayers(players, { query: 'zzz' }).length, 0);
  assert.equal(filterOnlinePlayers(players, { query: '' }).length, 3);
});

test('the current user can never be offered as an opponent', () => {
  assert.deepEqual(filterOnlinePlayers(players, { excludeId: 2 }).map((p) => p.id), [1, 3]);
  assert.deepEqual(filterOnlinePlayers(players, { excludeId: '2' }).map((p) => p.id), [1, 3],
    'the id matches regardless of string/number shape');
  assert.equal(filterOnlinePlayers(players, { query: 'Bhavya', excludeId: 2 }).length, 0);
});

test('filtering does not mutate the directory', () => {
  const copy = players.map((p) => ({ ...p }));
  filterOnlinePlayers(players, { query: 'a', excludeId: 1 });
  assert.deepEqual(players, copy);
  assert.deepEqual(filterOnlinePlayers(null, { query: 'a' }), [], 'a missing payload is empty, not a crash');
});

test('the card shows the rating for the selected clock pool', () => {
  const p = { bullet_rating: 980, blitz_rating: '1120', rapid_rating: 1310, classical_rating: null };
  assert.equal(ratingForPlayer(p, 'bullet'), 980);
  assert.equal(ratingForPlayer(p, 'blitz'), 1120, 'numeric strings from pg are accepted');
  assert.equal(ratingForPlayer(p, 'rapid'), 1310);
  assert.equal(ratingForPlayer(p, 'classical'), null, 'no pool yet — card shows Unrated');
  assert.equal(ratingForPlayer(null, 'rapid'), null);
  assert.equal(ratingForPlayer({ rapid_rating: 0 }, 'rapid'), null);
});

test('clock families map to the four rating pools', () => {
  assert.deepEqual(RATING_CLASS_BY_FAMILY, {
    Bullet: 'bullet', Blitz: 'blitz', Rapid: 'rapid', Classical: 'classical',
  });
  assert.equal(ratingPoolLabel('rapid'), 'Rapid');
  assert.equal(ratingPoolLabel(''), '');
});

test('the API sends photo, avatar and every rating pool', () => {
  const start = backend.indexOf('exports.listUsers');
  const sql = backend.slice(start, backend.indexOf('exports.listGames', start));
  for (const col of ['u.profile_image', 'u.avatar_config', 'bullet_rating', 'blitz_rating', 'rapid_rating', 'classical_rating']) {
    assert.ok(sql.includes(col), `${col} must be returned for the cards`);
  }
  assert.match(sql, /student_time_ratings/, 'ratings come from the real per-pool table');
  assert.match(sql, /u\.id <> \$1/, 'the caller is excluded server-side too');
});

test('one image per opponent: photo, else saved avatar, else default', () => {
  const avatar = read('src', 'components', 'PlayerAvatar.jsx');
  assert.match(avatar, /export default function PlayerAvatar/, 'PlayerAvatar exists');
  const photoAt = avatar.indexOf('player?.profile_image');
  const avatarAt = avatar.indexOf('<StudentAvatar');
  assert.ok(photoAt > -1 && avatarAt > photoAt, 'the uploaded photo wins; the avatar is only the fallback');
  assert.equal((avatar.match(/<img/g) || []).length, 1, 'never renders a photo and an avatar together');
  assert.equal((avatar.match(/<StudentAvatar/g) || []).length, 1, 'exactly one avatar fallback');
  assert.match(avatar, /seed=\{seed \|\| `user_\$\{player\?\.id \|\| ''\}`\}/,
    'default avatar is deterministic per player, with an explicit seed for the engine/side placeholders');
});

test('the card highlights the selection and proves online status', () => {
  assert.match(board, /online-pick-card-on/, 'selected card gets the highlight class');
  assert.match(board, /online-pick-check/, 'selected card shows a checkmark');
  assert.match(board, /aria-selected=\{selected\}/, 'listbox semantics carry the selection');
  assert.match(board, /player\.online === true &&/, 'online badge only when the server says so');
  assert.ok(!/offline/i.test(board.slice(board.indexOf('function OnlinePlayerCard'), board.indexOf('TIME_PRESETS'))),
    'no offline label is invented');
});

test('the directory has search plus loading, empty and error states', () => {
  assert.match(board, /placeholder="Search players by name…"/, 'search input');
  assert.match(board, /aria-label="Search players"/);
  assert.match(board, /Loading players…/, 'loading state');
  assert.match(board, /No other players are available yet\./, 'empty state');
  assert.match(board, /No players match “/, 'empty search state');
  assert.match(board, /online-pick-error" role="alert"/, 'API errors are announced');
  assert.match(board, /onClick=\{loadOnlineUsers\}>\s*Retry/, 'errors can be retried');
});

test('the rating follows the time control and selection drives the invite', () => {
  assert.match(board, /RATING_CLASS_BY_FAMILY\[timeControlFamily\(timeSel\)\]/, 'pool comes from the picked clock');
  assert.match(board, /online-pick-selected[\s\S]{0,400}Challenging/,
    'confirmation area names the opponent being challenged');
  assert.match(board, /onlineSelStudent\.current = String\(p\.id\)/,
    'clicking a card sets the id the API call uses');
  assert.match(board, /setOnlineSelId\(String\(p\.id\)\)/, 'clicking a card updates the highlight');
  assert.match(board, /setOnlineSelName\(p\.name\)/, 'clicking a card confirms the name');
  assert.match(board, /studentId: Number\(sid\)/, 'the existing createGame payload is unchanged');
  assert.ok(!/onlinePlayerOpen|online-player-row/.test(board), 'the old dropdown popup is gone');
});

test('the card grid never scrolls sideways', () => {
  const grid = css.slice(css.indexOf('.online-pick-grid {'), css.indexOf('.online-pick-card {'));
  assert.match(grid, /repeat\(2, minmax\(0, 1fr\)\)/, 'two columns on desktop');
  assert.match(grid, /max-height: 206px/, 'the grid scrolls instead of growing the modal');
  assert.match(grid, /overflow-y: auto/);
  assert.match(css, /@media \(max-width: 420px\) \{\s*\.online-pick-grid \{ grid-template-columns: minmax\(0, 1fr\);/,
    'one column on narrow phones');
  assert.match(css, /\.online-pick-name \{[^}]*text-overflow: ellipsis/, 'long names truncate instead of overlapping');
  assert.match(css, /\.online-pick-card \{[^}]*min-width: 0/, 'cards can shrink inside the grid');
});
