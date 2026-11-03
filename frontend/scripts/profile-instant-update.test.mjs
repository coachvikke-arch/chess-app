// Pins the "photo and avatar update instantly" wiring.
//   run with: npm run test:profile-sync   (from frontend/)
//
// In the deployed app a new profile photo or avatar only appeared after logging
// out and back in. The profile pages patched their own local copy of the user and
// then called refreshUser(), but the student avatar endpoint answered with just
// `{ avatar_config }` — so the auth cache, the header, the sidebar and every list
// kept the picture from before the change.
//
// The contract these tests hold:
//   · AuthContext owns a single publish point (applyUser) that writes the context,
//     localStorage, the GET cache and a profile:changed broadcast.
//   · Both profile pages hand it the SERVER's user object, never a patched copy.
//   · The photo URL carries a stable ?v= stamp from the row's own updated_at.
//   · The surfaces that draw avatars from their own snapshots refetch on the
//     broadcast instead of waiting for a navigation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (rel) => readFileSync(join(ROOT, 'src', rel), 'utf8');

test('AuthContext publishes a mutation into state, storage and the caches', () => {
  const s = SRC('context/AuthContext.jsx');
  assert.match(s, /const applyUser = useCallback\(\(nextUser\) => \{/, 'one publish point');
  assert.match(s, /localStorage\.setItem\('user', JSON\.stringify\(nextUser\)\)/, 'the reload copy changes too');
  assert.match(s, /clearHttpCache\(\);/, 'a profile write cannot invalidate other scopes by itself');
  assert.match(s, /window\.dispatchEvent\(new CustomEvent\('profile:changed', \{ detail: nextUser \}\)\)/);
  assert.match(s, /setUser\(nextUser\);/);
  assert.match(s, /refreshUser,\s*\n\s*applyUser,/, 'exposed on the context');
  /* The pages must not be left guessing at what the server did. */
  assert.doesNotMatch(s, /setUser\(\(prev\) => \(\.\.\.prev, profile_image/, 'no local photo patch in the context');
});

test('both profile pages hand the server response to the context', () => {
  for (const page of ['pages/Profile.jsx', 'pages/AdminProfile.jsx']) {
    const s = SRC(page);
    assert.match(s, /const \{ user: authUser, refreshUser, applyUser, logout \} = useAuth\(\);/, `${page}: applyUser in scope`);
    assert.match(s, /const publishProfile = \(nextUser\) => \{[\s\S]*applyUser\(nextUser\);[\s\S]*setProfile\(nextUser\);/, `${page}: one helper, server values`);
    /* Every mutation route takes the same path — no page-local patching left. */
    assert.equal((s.match(/publishProfile\(res\.data\.user\)/g) || []).length, 4, `${page}: upload, remove, avatar save, avatar reset`);
    assert.doesNotMatch(s, /setProfile\(\(p\) => \(\{ \.\.\.p, profile_image/, `${page}: no half-updated local copy`);
    assert.doesNotMatch(s, /setProfile\(\(p\) => \(\{ \.\.\.p, avatar_config/, `${page}: no half-updated local copy`);
  }
});

test('the student page writes through the student routes and the admin page through /auth', () => {
  assert.match(SRC('pages/Profile.jsx'), /api\.patch\('\/students\/me\/avatar'/);
  assert.match(SRC('pages/Profile.jsx'), /api\.delete\('\/students\/me\/avatar'/);
  assert.match(SRC('pages/AdminProfile.jsx'), /api\.patch\('\/auth\/me\/avatar'/);
  assert.match(SRC('pages/AdminProfile.jsx'), /api\.delete\('\/auth\/me\/avatar'/);
  for (const page of ['pages/Profile.jsx', 'pages/AdminProfile.jsx']) {
    const s = SRC(page);
    assert.match(s, /api\.post\('\/auth\/me\/photo', body\)/, `${page}: upload`);
    assert.match(s, /api\.delete\('\/auth\/me\/photo'\)/, `${page}: remove photo`);
  }
});

test('a profile photo URL is versioned from the row, never from the clock', () => {
  const s = SRC('utils/profileImage.js');
  assert.match(s, /export function profileImageSrc\(url, version\)/);
  assert.match(s, /return `\$\{url\}\$\{url\.includes\('\?'\) \? '&' : '\?'\}v=\$\{stamp\}`;/);
  /* A Date.now() here would refetch the picture on every render of every list. */
  assert.doesNotMatch(s, /Date\.now\(\)/, 'the stamp has to be stable across renders');
  assert.match(s, /export function profileImageFromUser\(user\)[\s\S]*user\?\.updated_at/, 'the stamp comes from updated_at');

  const users = ['pages/Profile.jsx', 'pages/AdminProfile.jsx', 'components/ProfileMenu.jsx', 'components/PlayerAvatar.jsx'];
  for (const file of users) {
    const c = SRC(file);
    assert.match(c, /import \{ profileImageFromUser \} from/, `${file}: uses the helper`);
    assert.doesNotMatch(c, /src=\{(?:user|player)\.profile_image\}/, `${file}: no raw URL left`);
  }
});

test('surfaces that cache their own avatars reload on the broadcast', () => {
  const hook = SRC('hooks/useProfileChanged.js');
  assert.match(hook, /window\.addEventListener\('profile:changed', run\)/);
  assert.match(hook, /const handler = useRef\(onChanged\)/, 'a fresh inline callback must not resubscribe');

  const subscribers = {
    'pages/Leaderboard.jsx': ['useProfileChanged(() => {', 'loadChamp();', '[user?.role, profileTick]'],
    'pages/Ratings.jsx': ['useProfileChanged(() => setProfileTick((t) => t + 1));', '}, [profileTick]);'],
    'context/ChatContext.jsx': ['listContacts(searchQueryRef.current).then((d) => setContacts(d?.users || []))', 'refreshConversations();'],
    'components/liveclass/ClassroomLeaderboard.jsx': ['useProfileChanged(refresh);'],
  };
  for (const [file, needles] of Object.entries(subscribers)) {
    const s = SRC(file);
    assert.match(s, /import \{ useProfileChanged \} from/, `${file}: imports the hook`);
    for (const needle of needles) assert.ok(s.includes(needle), `${file}: ${needle}`);
  }
});

test('the photo and avatar stay mutually exclusive, and the row drives it', () => {
  /* The exclusivity rule is enforced by the SQL in one statement per endpoint;
     the frontend only has to stop inventing its own copy of the answer. */
  const auth = readFileSync(join(ROOT, '..', 'backend', 'src', 'controllers', 'authController.js'), 'utf8');
  assert.match(auth, /SET profile_image = \$1, avatar_config = NULL/);
  assert.match(auth, /SET avatar_config = \$1, profile_image = NULL/);
  assert.match(auth, /UPDATE users SET avatar_config = NULL, profile_image = NULL/);
});
