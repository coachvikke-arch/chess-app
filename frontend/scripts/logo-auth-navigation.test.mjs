// Regression tests for the logo destination while signed in.
//   run with: node --test scripts/logo-auth-navigation.test.mjs   (from frontend/)
//
// Reported bug: clicking the academy logo dropped a signed-in user back on the
// public landing page (whose only calls to action are "Login"), which read as
// having been logged out. The logo now resolves to the session's own dashboard;
// signed-out visitors still get "/".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { homeForRole } from '../src/utils/roles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const navbar = read('src', 'components', 'Navbar.jsx');
const app = read('src', 'App.jsx');
const auth = read('src', 'context', 'AuthContext.jsx');
const guard = read('src', 'components', 'ProtectedRoute.jsx');

test('each role has a real dashboard to land on', () => {
  assert.equal(homeForRole('student'), '/student/dashboard');
  assert.equal(homeForRole('admin'), '/admin/dashboard');
  assert.equal(homeForRole('superadmin'), '/admin/dashboard');
});

test('the public header logo follows the session', () => {
  assert.match(navbar, /const logoLink = user \? dashLink : '\/'/,
    'signed in → dashboard, signed out → public home');
  assert.match(navbar, /<Link to=\{logoLink\}/, 'the logo uses that destination');
  assert.ok(!/<Link to="\/" aria-label=\{APP_NAME\}/.test(navbar),
    'the hard-coded public target is gone');
});

test('the landing header logo follows the session too', () => {
  assert.match(app, /<Link\s+to=\{user \? dashLink : '\/'\}/,
    'the landing logo resolves through the same rule');
});

test('logo navigation is a client-side link, so the session survives it', () => {
  /* <Link> goes through the router: no reload, no leftover token to re-read.
     A window.location assignment would re-boot the app and can race /auth/me. */
  assert.ok(!/window\.location[^\n]*logo/i.test(navbar));
  assert.match(navbar, /import \{ Link \} from 'react-router-dom'/);
});

test('explicit logout still clears the session', () => {
  assert.match(auth, /const logout = \(\) => \{[\s\S]{0,260}clearSession\(\)/,
    'logout must still revoke and clear');
  assert.match(auth, /localStorage\.removeItem\('token'\)/, 'the token is removed');
  assert.match(auth, /localStorage\.removeItem\('user'\)/, 'the cached identity is removed');
});

test('auth checking is untouched: guards still decide on the session', () => {
  assert.match(guard, /if \(loading\)/,
    'the guard waits for /auth/me instead of guessing');
  assert.match(guard, /if \(!user\)/,
    'only a genuinely missing session is sent to /login');
});
