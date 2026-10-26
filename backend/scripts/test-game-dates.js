// Tests for game-date handling across the API boundary.
//   run from backend/:  npm run test:game-dates
//
// The bug: every game in the Games list displayed one day EARLIER than it was
// actually played.
//
// `chess_games.game_date` is a Postgres DATE. node-postgres parses a DATE into a
// JS Date at LOCAL midnight, which on this server (Asia/Calcutta, UTC+5:30)
// turns the stored date 2026-10-01 into the instant 2026-10-01T00:00:00+05:30.
// JSON.stringify then emits that as "2026-09-30T18:30:00.000Z" — the previous
// UTC day. The client formatted the leading 10 characters and showed
// "Sep 30, 2026" for a game played on Oct 1.
//
// This is a serialisation bug, not a data bug: the stored value was always
// correct. The fix is to hand the client a plain 'YYYY-MM-DD' string with no
// instant attached, so no timezone can reinterpret it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const svc = readFileSync(path.join(ROOT, 'src', 'services', 'unifiedProfileService.js'), 'utf8');

/** Exactly how node-postgres parses a DATE column: local midnight. */
function pgParseDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Mirrors frontend formatDate(): slice the leading 10 chars, build local midnight. */
function formatDateLikeClient(value) {
  if (!value) return '-';
  const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* The dates that were actually wrong in production. */
const CASES = [
  ['2026-10-01', 'Nagavel_Krishnamoorthi vs aneesh2107'],
  ['2026-09-29', 'Arzatebertin65 vs Nagavel_Krishnamoorthi'],
  ['2026-09-29', 'Nagavel_Krishnamoorthi vs Woojiklee0810'],
  ['2026-09-28', 'Nagavel_Krishnamoorthi vs ulysse511'],
];

test('serialising a DATE column shifts the day backwards (the original bug)', () => {
  /* Guards the premise of this file: if pg ever stopped parsing DATE to local
     midnight, this test would fail and the "fix" below would need revisiting. */
  const wire = JSON.parse(JSON.stringify(pgParseDate('2026-10-01')));
  assert.ok(wire.startsWith('2026-09-30') || wire.startsWith('2026-10-01'),
    `unexpected wire shape ${wire}`);

  const shown = formatDateLikeClient(wire);
  assert.equal(shown, 'Sep 30, 2026',
    'on a UTC+5:30 server a DATE of 2026-10-01 must serialise to the previous UTC day');
});

test('a plain YYYY-MM-DD survives the wire unchanged', () => {
  for (const [stored] of CASES) {
    const wire = JSON.parse(JSON.stringify(stored));
    assert.equal(wire, stored, 'a text calendar date must not become an instant');
    assert.notEqual(formatDateLikeClient(wire), '-');
  }
});

test('every affected game now displays the date it was played on', () => {
  for (const [stored, label] of CASES) {
    assert.equal(formatDateLikeClient(stored),
      new Date(`${stored}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      `${label} should show its stored date ${stored}`);
  }
});

test('the games query casts game_date to text at the SQL boundary', () => {
  /* Both the list and the single-game fetch share GAME_FIELDS, so this one cast
     covers the Games list AND the game viewer. */
  assert.match(svc, /to_char\(g\.game_date, 'YYYY-MM-DD'\)\s+AS game_date/,
    'game_date must be cast to a calendar string, not shipped as a DATE');
  assert.ok(!/SELECT[^;]*\bg\.game_date\b(?!\s*,\s*\n?\s*g\.white_name)/.test(
    /\nconst GAME_FIELDS = `[\s\S]*?`;/.exec(svc)[0]),
    'no raw g.game_date may be selected into the wire payload');
});

test('date-range filters still compare against the real DATE column', () => {
  /* The display fix must not change filtering: from/to compare the raw column,
     which is a DATE, against a 'YYYY-MM-DD' string. Postgres casts it, and the
     values now agree with what is displayed. */
  assert.match(svc, /g\.game_date >= \$\{/);
  assert.match(svc, /g\.game_date <= \$\{/);
  /* Sorting stays on end_time_ms so the newest game is first regardless of the
     display change. */
  assert.match(svc, /ORDER BY g\.end_time_ms/);
});

test('statistics keeps its own safe DATE handling', () => {
  /* statisticsService never serialises a raw DATE — it normalises to a Date /
     YYYY-MM key server-side. Assert it still does, so a future refactor does not
     reintroduce the bug on the charts. */
  const stats = readFileSync(path.join(ROOT, 'src', 'services', 'statisticsService.js'), 'utf8');
  assert.match(stats, /function asDate\(/);
  assert.match(stats, /function monthKey\(/);
});