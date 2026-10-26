/* External meeting links that don't open.
 *
 * Run: node --test scripts/external-meeting-url.test.mjs
 *
 * THE BUG
 * -------
 * Class #72 ("hii") was saved with meeting_url = "meet.google.com/hrf-xufs-anf"
 * — no scheme. A URL without a scheme is resolved by the browser as a path
 * RELATIVE to the current origin, so the anchor
 *     <a href="meet.google.com/hrf-xufs-anf" target="_blank">
 * navigated to "<app-origin>/meet.google.com/hrf-xufs-anf": a 404 inside Knight
 * Path. The link rendered, the icon and label looked right, and clicking did
 * nothing useful. Nothing about the string itself hints at the problem, so the
 * URL is now normalised on the way OUT (render, window.open, SMS) rather than
 * trusted on the way in.
 *
 * WHAT IS LOCKED DOWN
 * -------------------
 *  1. the normaliser itself, exercised for real: bare host, https, protocol-
 *     relative, zoommtg:/mailto: schemes, whitespace, empty/absent
 *  2. every consumer hands the raw value through the normaliser (classroom bar,
 *     classroom overflow menu, Online Classes join button, both SMS paths)
 *  3. the classroom link stays a real <a href> with target="_blank" — it is an
 *     anchor so it works with middle-click, ctrl+click and "copy link", which a
 *     window.open onClick handler does not
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { normalizeMeetingUrl } from '../src/utils/meetingUrl.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const classroom = strip(read('src', 'pages', 'LiveClassroom.jsx'));
const meetings = strip(read('src', 'pages', 'LiveMeetings.jsx'));
const manage = strip(read('src', 'pages', 'ManageClasses.jsx'));
const classCtrl = strip(read('..', 'backend', 'src', 'controllers', 'classController.js'));
const liveCtrl = strip(read('..', 'backend', 'src', 'controllers', 'liveClassController.js'));

test('a host stored without a scheme gets https, so the browser leaves the app', () => {
  assert.equal(normalizeMeetingUrl('meet.google.com/hrf-xufs-anf'), 'https://meet.google.com/hrf-xufs-anf');
  assert.equal(normalizeMeetingUrl('zoom.us/j/1234567890'), 'https://zoom.us/j/1234567890');
  assert.equal(normalizeMeetingUrl('meet.google.com/hrf-xufs-anf '), 'https://meet.google.com/hrf-xufs-anf');
  assert.equal(normalizeMeetingUrl('   meet.google.com/x'), 'https://meet.google.com/x');
});

test('a URL that already carries a scheme is left exactly as it is', () => {
  assert.equal(normalizeMeetingUrl('https://meet.google.com/abc-defg'), 'https://meet.google.com/abc-defg');
  assert.equal(normalizeMeetingUrl('http://zoom.us/j/1'), 'http://zoom.us/j/1');
  /* Native-app and mail schemes are not http, and guessing one would break them. */
  assert.equal(normalizeMeetingUrl('zoommtg://zoom.us/join?confno=1'), 'zoommtg://zoom.us/join?confno=1');
  assert.equal(normalizeMeetingUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(normalizeMeetingUrl('tel:+15551234567'), 'tel:+15551234567');
  /* Protocol-relative is already unambiguous. */
  assert.equal(normalizeMeetingUrl('//meet.google.com/x'), '//meet.google.com/x');
  /* Case-insensitive scheme. */
  assert.equal(normalizeMeetingUrl('HTTPS://meet.google.com/x'), 'HTTPS://meet.google.com/x');
});

test('nothing to open yields an empty string, not a bare https://', () => {
  assert.equal(normalizeMeetingUrl(''), '');
  assert.equal(normalizeMeetingUrl('   '), '');
  assert.equal(normalizeMeetingUrl(null), '');
  assert.equal(normalizeMeetingUrl(undefined), '');
  assert.equal(normalizeMeetingUrl(42), '');
});

test('the classroom bar and its overflow-menu link both normalise', () => {
  /* One normalised value feeding both, so they can never disagree. */
  assert.match(classroom, /const meetingUrl = normalizeMeetingUrl\(boot\.classMeta\?\.meetingUrl\);/,
    'the room must derive one normalised URL from classMeta');
  const consumed = classroom.match(/href=\{meetingUrl\}/g) || [];
  assert.equal(consumed.length, 2,
    `both the bar link and the overflow-menu link must consume the normalised value, found ${consumed.length}`);
  assert.ok(!/href=\{boot\.classMeta\?\.meetingUrl\}/.test(classroom) &&
            !/href=\{boot\.classMeta\.meetingUrl\}/.test(classroom),
    'no link may consume the raw stored value');
});

test('the classroom link stays a real anchor so right-click and new-tab work', () => {
  /* A window.open onClick handler only serves a plain left click. The link now
     lives in the header (styled like the Pair button) rather than the external
     meeting bar, but it must stay a real <a href> either way. */
  assert.match(classroom, /<a\s+className="pvp-launch live-open-video"\s+href=\{meetingUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/);
  assert.doesNotMatch(classroom, /onClick=\{\(\)\s*=>\s*window\.open\(/,
    'the meeting link must not be re-implemented as window.open');
});

test('the Online Classes join button normalises both its sources', () => {
  assert.match(meetings, /let url = normalizeMeetingUrl\(m\.meeting_url\);/,
    'the listed URL must be normalised');
  assert.match(meetings, /if \(res\?\.meetingUrl\) url = normalizeMeetingUrl\(res\.meetingUrl\);/,
    'the URL echoed back by join-external must be normalised too');
});

test('a class is saved with a normalised URL, so the bad row stops recurring', () => {
  assert.match(manage, /meetingUrl: normalizeMeetingUrl\(form\.meetingUrl\)/);
});

test('both notification paths send a tappable link', () => {
  assert.match(classCtrl, /Join: \$\{normalizeMeetingUrl\(meetingUrl\)\}/,
    'the new-class notification must normalise');
  assert.match(liveCtrl, /Join the meeting: \$\{normalizeMeetingUrl\(classRow\.meeting_url\)\}/,
    'the class-is-live notification must normalise');
});

test('the normaliser is defined once per boundary, not copy-pasted', () => {
  assert.match(read('src', 'utils', 'meetingUrl.js'), /export function normalizeMeetingUrl/);
  assert.match(read('src', 'services', 'liveClassApi.js'), /export \{ normalizeMeetingUrl \} from '\.\.\/utils\/meetingUrl'/,
    'the API module must re-export the util rather than define a second copy');
  assert.match(read('..', 'backend', 'src', 'utils', 'meetingUrl.js'), /module\.exports = \{ normalizeMeetingUrl \}/);
});
