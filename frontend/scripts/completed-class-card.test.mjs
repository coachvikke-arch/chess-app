// Regression tests for the student "Completed class" card.
//   run with: node --test scripts/completed-class-card.test.mjs   (from frontend/)
//
// The card must show the date it happened (large, highlighted, with weekday),
// the coach, the clock range and a duration CALCULATED from the timestamps.
// Anything unreadable has to drop its line instead of printing "Invalid Date",
// and only the student's completed card may change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { classDateParts, minutesOfDay, classDurationLabel } from '../src/utils/classTiming.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(ROOT, 'src', 'pages', 'LiveMeetings.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

test('the date reads as "20 OCT 2026" with its weekday', () => {
  assert.deepEqual(classDateParts('2026-10-20'), { label: '20 OCT 2026', weekday: 'Tuesday' });
  assert.deepEqual(classDateParts('2026-01-04'), { label: '04 JAN 2026', weekday: 'Sunday' });
});

test('the date is built from local parts, never UTC midnight', () => {
  /* new Date('2026-10-20') is UTC; west of Greenwich that renders as the 19th. */
  assert.equal(classDateParts('2026-10-20').label, '20 OCT 2026');
  assert.equal(page.includes("new Date('2026-10-20')"), false);
});

test('missing or impossible dates degrade to null', () => {
  for (const bad of [null, undefined, '', '   ', 'not-a-date', '2026-02-31', '2026-13-01']) {
    assert.equal(classDateParts(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('minutes of day are parsed from TIME strings and datetimes', () => {
  assert.equal(minutesOfDay('15:30:00'), 15 * 60 + 30);
  assert.equal(minutesOfDay('9:05'), 9 * 60 + 5);
  assert.equal(minutesOfDay('24:00'), null);
  assert.equal(minutesOfDay('12:61'), null);
  assert.equal(minutesOfDay(''), null);
});

test('the duration is computed, not hardcoded', () => {
  assert.equal(classDurationLabel('15:30:00', '15:31:00'), '1 minute');
  assert.equal(classDurationLabel('09:00', '10:30'), '1 hour 30 minutes');
  assert.equal(classDurationLabel('09:00', '10:00'), '1 hour');
  assert.equal(classDurationLabel('15:30', '15:30'), 'Less than a minute');
  assert.equal(classDurationLabel('23:30', '00:30'), '1 hour', 'a class may run past midnight');
});

test('an unusable timestamp drops the duration instead of inventing one', () => {
  assert.equal(classDurationLabel('', '15:31'), null);
  assert.equal(classDurationLabel('15:30', null), null);
  assert.equal(classDurationLabel('nonsense', '15:31'), null);
});

test('the student completed card uses the new layout', () => {
  assert.match(page, /if \(ls === 'completed'\) return <CompletedMeetingCard m=\{m\} \/>/,
    'only the completed variant takes the new card');
  assert.match(page, /className="completed-class-date-badge">\{date\.label\}/,
    'the highlighted date label is rendered');
  assert.match(page, /className="completed-class-weekday">\{date\.weekday\}/,
    'the weekday is rendered next to it');
  assert.match(page, /classDateParts\(m\.class_date\)/, 'the date comes from the class row');
  assert.match(page, /classDurationLabel\(m\.start_time, m\.end_time\)/,
    'the duration comes from the stored timestamps');
  assert.match(page, /Duration:<\/strong> \{duration\}/, 'the duration is labelled');
});

test('the card keeps the information it already had', () => {
  assert.match(page, /<Card title=\{m\.title\}/, 'class title is kept');
  assert.match(page, /Coach:<\/strong> \{m\.coach_name\}/, 'coach name is kept');
  assert.match(page, /Topic:<\/strong> \{m\.topic\}/, 'topic is kept');
  assert.match(page, /MeetingTypeNote/, 'the meeting-link explanation is kept');
  assert.match(page, /✓ Completed/, 'completed status is kept');
});

test('the card cannot overflow the screen side to side', () => {
  const block = css.slice(css.indexOf('.completed-class-date {'));
  assert.match(block, /flex-wrap:\s*wrap/, 'the date section wraps on narrow cards');
  assert.match(block, /overflow-wrap:\s*anywhere/, 'long names/topics wrap instead of widening the card');
  assert.match(block, /min-width:\s*0/, 'flex children may shrink below their content width');
  /* Only the date badge itself may refuse to wrap; the meta rows must not. */
  const meta = block.slice(block.indexOf('.completed-class-meta {'), block.indexOf('.completed-class-meta {') + 700);
  assert.ok(!/white-space:\s*nowrap/.test(meta), 'meta rows must be allowed to wrap');
});
