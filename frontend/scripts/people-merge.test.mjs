/**
 * People directory must live inside Messages, not as its own section.
 *
 * The People page was a standalone route duplicating what the Messages page
 * already had as a tab: the same /api/chat/users call, the same contact list,
 * the same "Message" button. Two entry points to one directory means two
 * sidebars to keep in sync and a second set of 403s when the feature is off.
 *
 * These tests pin the consolidation:
 *   - no standalone People route or sidebar entry survives
 *   - the old URL still works, by redirecting into the Messages People tab
 *   - MessagesPage really does read ?tab=people, so the redirect lands on the
 *     directory rather than silently dropping the user on the inbox
 *
 * Run with: npm run test:people-merge
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = (p) => join(here, '..', 'src', ...p.split('/'));
const read = (p) => readFileSync(srcPath(p), 'utf8');

const app = read('App.jsx');
const sidebar = read('components/Sidebar.jsx');
const studentShell = read('components/StudentAppShell.jsx');
const messages = read('pages/MessagesPage.jsx');

/* ── the old page is gone ──────────────────────────────────────────────── */

test('the standalone PeoplePage component no longer exists', () => {
  assert.equal(existsSync(srcPath('pages/PeoplePage.jsx')), false, 'PeoplePage.jsx is still on disk');
});

test('nothing imports PeoplePage', () => {
  for (const [name, src] of [['App.jsx', app]]) {
    assert.equal(
      /import\s+\w*PeoplePage\s+from/.test(src),
      false,
      `${name} still imports PeoplePage — the build would fail or render a dead route`,
    );
  }
});

/* ── no standalone route or sidebar entry ──────────────────────────────── */

test('neither shell still links to a standalone /people section', () => {
  assert.equal(
    /to:\s*'\/admin\/people'/.test(sidebar),
    false,
    'admin sidebar still has a People entry',
  );
  assert.equal(
    /to:\s*'\/student\/people'/.test(studentShell),
    false,
    'student sidebar still has a People entry',
  );
});

test('/people is no longer a rendered route, only a redirect', () => {
  for (const p of ['/admin/people', '/student/people']) {
    const re = new RegExp(`path="${p.replace('/', '\\/')}"\\s+element=\\{<ProtectedRoute[^>]*>\\s*<Navigate`);
    assert.ok(re.test(app), `${p} should redirect straight to Messages, not render a page`);
  }
});

test('both /people redirects land on the Messages People tab', () => {
  assert.match(app, /\/admin\/messages\?tab=people/);
  assert.match(app, /\/student\/messages\?tab=people/);
});

/* ── MessagesPage honours ?tab=people ──────────────────────────────────── */

test('MessagesPage reads the tab from the query string', () => {
  assert.match(messages, /useSearchParams/, 'MessagesPage does not use useSearchParams');
  assert.match(
    messages,
    /searchParams\.get\('tab'\)\s*===\s*'people'/,
    'MessagesPage does not read ?tab=people',
  );
});

test('MessagesPage still has both tabs', () => {
  assert.match(messages, /'inbox'\s*,\s*'people'/, 'the inbox/people tab list changed');
  /* It must keep rendering the people panel itself, or the redirect lands on
     an empty area. */
  assert.match(messages, /listContacts/, 'MessagesPage no longer loads the contact list');
});

test('switching tabs keeps the URL in sync', () => {
  /* Without this, a reload or a shared link loses the panel the user was on. */
  assert.match(messages, /p\.set\('tab',\s*'people'\)/);
  assert.match(messages, /p\.delete\('tab'\)/);
});

/* ── the directory is not duplicated ───────────────────────────────────── */

test('only MessagesPage calls the contact-list endpoint', () => {
  const files = ['pages/MessagesPage.jsx', 'components/ChatContext.jsx'];
  const callers = files.filter((f) => existsSync(srcPath(f)) && /listContacts|\/chat\/users/.test(read(f)));
  assert.ok(
    callers.includes('pages/MessagesPage.jsx'),
    'MessagesPage should be the consumer of the contact list',
  );
  /* The old standalone page was the duplicate; if it ever returns, it will be
     the only other caller, so assert the count stays at one page. */
  const pages = ['pages/MessagesPage.jsx', 'pages/PeoplePage.jsx'];
  const present = pages.filter((f) => existsSync(srcPath(f)));
  assert.equal(present.length, 1, `expected one directory page, found: ${present.join(', ')}`);
});