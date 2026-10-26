// Tests for the MERGED staff menu
// (frontend/src/components/Sidebar.jsx, src/components/AdminAppShell.jsx) -
//   run with: node --test scripts/super-admin-menu.test.mjs   (from frontend/)
//
// The Super Admin reads ONE menu list, not two: the owner-only entries
// (Certificates, Certificate Settings) live inline in adminLinks with
// `superOnly`, coaches skip them, and the Super Admin skips the coach-only
// rows (`superHidden`). Two regressions this pins down:
//   1. Certificates / Certificate Settings only existed in the desktop rail, so
//      a Super Admin opening the menu on a phone had no way to reach them.
//   2. The coach-only "Student Reports" entry was listed in the academy-owner's
//      menu too, where it is a dead end (their rows come from the roster link).
//
// Why source assertions: both bugs are about WHICH array a menu renders. The
// rule is simple enough to state, and stating it here stops the phone menu and
// the desktop rail from drifting apart again (they are two separate renderings of
// the same link list, which is how the drift started).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');

const sidebarSrc = readFileSync(join(FRONTEND, 'src', 'components', 'Sidebar.jsx'), 'utf8');
const shellSrc = readFileSync(join(FRONTEND, 'src', 'components', 'AdminAppShell.jsx'), 'utf8');

test('the phone menu renders the academy-owner links, not just the console', () => {
  assert.match(shellSrc, /import Sidebar, \{ adminLinks \} from '\.\/Sidebar';/,
    'the phone menu must import the same link list the rail uses');
  assert.doesNotMatch(shellSrc, /superAdminLinks/,
    'the separate owner-only list is gone - merged into adminLinks');
  assert.doesNotMatch(sidebarSrc, /export const superAdminLinks/,
    'the separate owner-only export is gone - merged into adminLinks');
  assert.doesNotMatch(shellSrc, /SUPER_LINKS/,
    'no pinned shortcut list - the console entry is a row like the rest');
});

test('Certificates and Certificate Settings are owner-only rows of the one list', () => {
  assert.match(sidebarSrc, /to: '\/super\/certificates'[^}]*superOnly: true/,
    'Certificates must be flagged owner-only inside adminLinks');
  assert.match(sidebarSrc, /to: '\/super\/certificate-settings'[^}]*superOnly: true/,
    'Certificate Settings must be flagged owner-only inside adminLinks');
});

test('the console entry itself is an owner-only row, not a pinned shortcut', () => {
  assert.match(sidebarSrc, /to: '\/super', label: 'Super Admin'[^}]*superOnly: true/,
    'the /super entry must be a reorderable owner-only row inside adminLinks');
  assert.doesNotMatch(sidebarSrc, /to="\/super"/,
    'no hardcoded console shortcut may remain on the desktop rail');
  assert.doesNotMatch(shellSrc, /to="\/super"/,
    'no hardcoded console shortcut may remain on the phone menu');
});

test('one filter serves both roles on both menus', () => {
  const filter = /const visibleLinks = links\.filter\(\(l\) => \(isSuper \? !l\.superHidden : !l\.superOnly\)\);/;
  assert.match(sidebarSrc, filter,
    'the desktop rail must hide owner rows from coaches and coach rows from the owner');
  assert.match(shellSrc, filter,
    'and so must the phone menu, or the removed sections simply reappear on mobile');
  assert.match(shellSrc, /\{visibleLinks\.map\(\(/,
    'the phone menu must render the filtered list, not the raw links');
  assert.match(sidebarSrc, /\{visibleLinks\.map\(\(/,
    'the desktop rail must render the filtered list too');
});

test('Student Reports stays for coaches and is dropped for the Super Admin', () => {
  assert.match(sidebarSrc, /to: '\/admin\/reports', label: 'Student Reports'[^}]*superHidden: true/,
    'the entry must be flagged, not deleted - coaches still open /admin/reports');
});

test('the router keeps the report route - only the menu entry is gone', async () => {
  const appSrc = readFileSync(join(FRONTEND, 'src', 'App.jsx'), 'utf8');
  assert.match(appSrc, /path="\/admin\/reports"/,
    'the report page is still reachable for coaches and by direct link');
});
