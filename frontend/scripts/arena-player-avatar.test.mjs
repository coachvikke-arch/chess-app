// Regression tests for the Play Arena player rows.
//   run with: node --test scripts/arena-player-avatar.test.mjs   (from frontend/)
//
// The rows above and below the board used to print a "B"/"W" letter in a
// rounded square. They now show each side's actual profile picture: the
// opponent's photo beside the opponent's colour, mine beside mine, with the
// shared photo -> saved avatar -> deterministic default fallback and the
// colour carried by the ring instead of a letter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const board = read('src', 'pages', 'AnalysisBoard.jsx');
const avatarSrc = read('src', 'components', 'PlayerAvatar.jsx');
const popup = read('src', 'components', 'PostGameResultPopup.jsx');
const backend = readFileSync(join(ROOT, '..', 'backend', 'src', 'controllers', 'onlineController.js'), 'utf8');

test('the B/W letter badges are gone from both player rows', () => {
  assert.ok(!/topColor === 'black' \? 'B' : 'W'/.test(board), 'top row no longer prints a letter');
  assert.ok(!/orientation === 'black' \? 'B' : 'W'/.test(board), 'bottom row no longer prints a letter');
  const rows = board.slice(board.indexOf('top player card'), board.indexOf('className="ab-note"'));
  assert.match(rows, /<PlayerAvatar player=\{topProfile\}/, 'the opponent seat renders the shared avatar component');
  assert.match(rows, /<PlayerAvatar player=\{bottomProfile\}/, 'my seat renders the shared avatar component');
});

test('each seat gets the right person, not a swapped pair', () => {
  assert.match(backend, /myProfile: playerProfile\(row, isCreator \? 'admin' : 'student'\)/,
    'myProfile is the viewer\'s own account');
  assert.match(backend, /opponentProfile: row\.is_bot \? null : playerProfile\(row, isCreator \? 'student' : 'admin'\)/,
    'opponentProfile is the other account; a bot has none');
  assert.match(board, /const bottomProfile = inOnline \|\| onlineFinished\s*\?\s*\(onlineGame\.myProfile \|\| selfProfile\)/,
    'my row prefers the game\'s own view of me, then the signed-in user');
  assert.match(board, /const topProfile = inOnline \|\| onlineFinished \? \(onlineGame\.opponentProfile \|\| null\)/,
    'the opponent row reads the opponent, never the viewer');
});

test('the backend ships both accounts\' photo and avatar with the match', () => {
  const start = backend.indexOf('async function getGameRow');
  const sql = backend.slice(start, backend.indexOf('function parsePgn', start));
  for (const col of [
    'au.profile_image AS admin_profile_image',
    'au.avatar_config AS admin_avatar_config',
    'su.profile_image AS student_profile_image',
    'su.avatar_config AS student_avatar_config',
  ]) {
    assert.ok(sql.includes(col), `${col} must be selected`);
  }
  const payloadAt = backend.indexOf('function playerProfile');
  assert.ok(payloadAt > -1, 'the profile builder exists');
  const payload = backend.slice(payloadAt, backend.indexOf('function spectatePayload', payloadAt));
  assert.match(payload, /profile_image/, 'the profile carries the uploaded photo');
  assert.match(payload, /avatar_config/, 'the profile carries the saved avatar');
  assert.match(payload, /id,\s*name,/, 'the profile carries a stable id for the default seed');
});

test('one image per seat, in the profile page\'s priority order', () => {
  /* The component was extracted so the board rows and the result popup share
     ONE avatar implementation instead of drifting apart. */
  const avatar = avatarSrc;
  assert.match(avatar, /export default function PlayerAvatar/);
  assert.match(avatar, /if \(player\?\.profile_image\)/, 'uploaded photo first');
  assert.match(avatar, /<StudentAvatar[\s\S]*config=\{player\?\.avatar_config\}/, 'saved avatar second');
  assert.match(avatar, /seed=\{seed \|\| `user_\$\{player\?\.id \|\| ''\}`\}/, 'deterministic default last');
  assert.equal((avatar.match(/<img/g) || []).length, 1);
  assert.equal((avatar.match(/<StudentAvatar/g) || []).length, 1);
});

test('the board rows and the result popup share that one component', () => {
  assert.match(board, /import PlayerAvatar from '\.\.\/components\/PlayerAvatar'/,
    'the board must not keep its own copy');
  assert.ok(!/function PlayerAvatar\(/.test(board), 'no second implementation in the page');
  assert.match(popup, /import PlayerAvatar from '\.\/PlayerAvatar'/,
    'the post-game popup renders the same picture logic');
  const playerRow = popup.slice(popup.indexOf('function PlayerRow'), popup.indexOf('/* ── the card'));
  assert.match(playerRow, /<PlayerAvatar player=\{player\.profile\} seed=\{player\.seed\} size=\{30\}/,
    'one image per player row, never a photo stacked behind an avatar');
});

test('the engine and an unknown side still get a stable placeholder', () => {
  assert.match(board, /const topAvatarSeed = computerOn \? `bot_\$\{computerLevel\}` : `side_\$\{topColor\}`/,
    'the computer and the analysis opponent each have a fixed fallback identity');
  assert.match(board, /const bottomAvatarSeed = user \? `user_\$\{user\.id\}` : 'user_self'/,
    'my placeholder is seeded from my account');
  const selfAt = board.indexOf('const selfProfile = user');
  assert.ok(selfAt > -1, 'signed-in user supplies the photo/avatar when the payload is older');
  assert.match(board.slice(selfAt, selfAt + 300), /profile_image: user\.profile_image/);
  assert.match(board.slice(selfAt, selfAt + 300), /avatar_config: user\.avatar_config/);
});

test('names, You and the colour labels survive the swap', () => {
  assert.match(board, /onlineGame\.myName \?\? 'You'/, 'name and You fallback');
  assert.match(board, /\{opponentName\}/, 'opponent name still printed');
  const bottom = board.slice(board.indexOf('{/* bottom player card'), board.indexOf('className="ab-note"'));
  assert.match(bottom, /You, \{orientation === 'black' \? 'Black' : 'White'\}/, 'You + colour label kept');
  assert.match(bottom, /<ClockBox[\s\S]*?color=\{orientation\}/, 'clock still bound to my colour');
  const top = board.slice(board.indexOf('{/* top player card'), board.indexOf('{/* bottom player card'));
  assert.match(top, /topColor === 'black' \? 'Black' : 'White'/, 'colour label kept on the opponent row');
  assert.match(top, /<ClockBox[\s\S]*?color=\{topColor\}/, 'opponent clock unchanged');
});

test('the photo circle is circular, ringed by colour, and cannot overflow the row', () => {
  const css = read('src', 'pages', 'AnalysisBoard.jsx');
  assert.match(css, /\.ab-avatar\{[^}]*border-radius:50%/, 'circular, not the old rounded square');
  assert.match(css, /\.ab-avatar\{[^}]*overflow:hidden/, 'the photo is clipped to the circle');
  assert.match(css, /\.ab-avatar-black\{[^}]*box-shadow:0 0 0 2px #1E293B/, 'black seats keep a dark ring');
  assert.match(css, /\.ab-avatar-white\{[^}]*box-shadow:0 0 0 2px #CBD5E1/, 'white seats keep a light ring');
  assert.match(css, /\.ab-player-row\{[^}]*height:48px/, 'row height unchanged, so the board does not move');
  assert.match(css, /\.ab-player-meta\{[^}]*min-width:0/, 'the name may truncate instead of pushing the clock out');
  assert.match(css, /\.ab-player-name\{[^}]*text-overflow:ellipsis/, 'long names ellipsize');
});
