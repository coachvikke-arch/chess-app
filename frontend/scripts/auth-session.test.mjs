/**
 * Session-persistence guard.
 *
 * The requirement is: once you are signed in, you stay signed in until you
 * click Logout. Two bugs broke that.
 *
 * 1. AuthProvider's boot check did `.catch(() => setUser(null))`, so ANY failure
 *    of /auth/me - backend restart, dropped connection, 500 - nulled the user
 *    while leaving the token in localStorage. The UI showed the login screen
 *    for a session that was still valid, and a refresh signed you back in.
 *
 * 2. /login rendered the sign-in form even for an authenticated visitor. The
 *    /login entry survives in history after signing in, and BackButton does
 *    navigate(-1), so backing out of a page could land on that entry and look
 *    like a forced logout.
 *
 * These assert on the real source text, which is what actually shipped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');

const auth = read('src', 'context', 'AuthContext.jsx');
const login = read('src', 'pages', 'Login.jsx');

test('AuthProvider boot check does not sign the user out on a generic failure', () => {
  const boot = auth.match(/api\.get\('\/auth\/me'\)[\s\S]*?\.finally\(/);
  assert.ok(boot, 'could not find the /auth/me boot check');

  assert.doesNotMatch(
    boot[0],
    /\.catch\(\(\)\s*=>\s*\{?\s*setUser\(null\)/,
    'a bare .catch that nulls the user logs out on network errors and 500s',
  );
  assert.match(
    boot[0],
    /status\s*===\s*401/,
    'the boot check must branch on a real 401 before ending the session',
  );
});

test('a non-401 boot failure keeps the cached identity and the token', () => {
  const boot = auth.match(/api\.get\('\/auth\/me'\)[\s\S]*?\.finally\(/)[0];
  const catchBlock = boot.slice(boot.indexOf('.catch('), boot.indexOf('.finally('));

  /* Exactly one hard clear, and it must sit inside the 401 branch, ahead of
     the cached-user fallback that handles everything else. */
  const clears = catchBlock.match(/setUser\(null\)/g) || [];
  assert.equal(clears.length, 1,
    'the catch block must clear the user exactly once — inside the 401 branch');

  const branch = catchBlock.indexOf('status === 401');
  const clear = catchBlock.indexOf('setUser(null)');
  const fallback = catchBlock.indexOf('readStoredUser()');
  assert.ok(branch !== -1 && clear !== -1 && fallback !== -1, 'expected all three markers');
  assert.ok(branch < clear, 'setUser(null) must be guarded by the 401 check');
  assert.ok(clear < fallback, 'the cached-user fallback must come after the 401 branch');

  assert.match(
    catchBlock,
    /setUser\(\(prev\)\s*=>\s*prev\s*\?\?\s*readStoredUser\(\)\)/,
    'a transient failure must fall back to the cached user rather than nulling it',
  );
  assert.doesNotMatch(
    catchBlock.slice(fallback),
    /removeItem\(/,
    'a transient failure must never clear the stored token',
  );
});

test('an invalid token really does end the session', () => {
  assert.match(
    auth,
    /status\s*===\s*401\)[\s\S]*?localStorage\.removeItem\('token'\)[\s\S]*?localStorage\.removeItem\('user'\)[\s\S]*?setUser\(null\)/,
    'a confirmed 401 must clear the token, the user and the React state',
  );
});

test('explicit logout still works', () => {
  /* Logout now delegates to clearSession() so the explicit logout and the
     forced (session-revoked) logout can never drift apart. clearSession is the
     single place that must drop the stored credentials and null the React
     state. */
  assert.match(
    auth,
    /const logout = \(\) => \{[\s\S]*?clearSession\(\)/,
    'clicking Logout must end the session',
  );
  assert.match(
    auth,
    /const clearSession = useCallback\(\(\) => \{[\s\S]*?localStorage\.removeItem\('token'\)[\s\S]*?localStorage\.removeItem\('user'\)[\s\S]*?setUser\(null\)/,
    'clearSession must clear the token, the user and the React state',
  );
});

test('Login redirects an already-signed-in visitor away from the form', () => {
  assert.match(login, /const \{ login, user, loading: authLoading \} = useAuth\(\)/,
    'Login needs the auth user and loading flag');
  assert.match(
    login,
    /useEffect\(\(\) => \{[\s\S]*?!authLoading && user[\s\S]*?navigate\(homeForRole\(user\.role\), \{ replace: true \}\)/,
    'Login must bounce an authenticated visitor to their dashboard',
  );
  assert.match(login, /if \(!authLoading && user\) return null;/,
    'Login must not flash the form before redirecting');
});

test('Login still authenticates a signed-out visitor', () => {
  assert.match(login, /const user = await login\(form\.identifier, form\.password\)/,
    'the submit handler must still call login()');
  assert.match(login, /navigate\(homeForRole\(user\.role\)\)/,
    'the post-login destination must still be the role home');
});

test('the back button navigates without touching the session', () => {
  const back = read('src', 'components', 'BackButton.jsx');
  assert.doesNotMatch(back, /logout\(\)/,
    'BackButton must never call logout()');
  assert.doesNotMatch(back, /removeItem\(/,
    'BackButton must never clear stored credentials');
});