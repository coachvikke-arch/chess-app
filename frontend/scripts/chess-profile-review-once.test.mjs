/**
 * The Chess Profile page must never retry a review mark on its own.
 *
 * A production incident showed ~750 POST /api/reviewed-games in three seconds
 * from one tab. GameViewerCard reports a stored review as "complete" every time
 * it re-checks, and the old handler posted on every call; when a post failed
 * (stale game 404, or the rate limiter's 429) the badge rolled back, which
 * rendered again, which posted again. That loop alone consumed the API's
 * 2000-request/15-minute budget and 429'd the rest of the app for that IP.
 *
 * One attempt per game per mount breaks the cycle: the badge is cosmetic, so a
 * failed save may leave it off, but it may not be retried automatically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const profile = readFileSync(join(here, '..', 'src', 'pages', 'ChessProfile.jsx'), 'utf8');

test('a review mark is posted at most once per game per mount', () => {
  const mark = profile.slice(
    profile.indexOf('const reviewAttemptedRef'),
    profile.indexOf('const apply = async'),
  );
  assert.ok(mark, 'expected the attempt guard block');

  const guardAt = mark.indexOf('if (reviewAttemptedRef.current.has(key)) return;');
  const addAt = mark.indexOf('reviewAttemptedRef.current.add(key);');
  const postAt = mark.indexOf('await markReviewed(platform, String(gameId));');
  assert.ok(guardAt > -1, 'a repeated completion must return before posting');
  assert.ok(addAt > guardAt, 'the attempt is recorded before the request is sent');
  assert.ok(postAt > addAt, 'the request is the guarded action');
  assert.ok(
    !mark.slice(postAt).includes('reviewAttemptedRef.current.delete'),
    'a failure must not re-arm the automatic retry',
  );
});

test('the completion callback keeps one identity across renders', () => {
  /* The viewer card re-runs its "stored review" effect whenever this prop's
     identity changes; an inline arrow made that happen on every render. */
  assert.match(profile, /onReviewed=\{markGameReviewed\}/);
  assert.ok(!profile.includes('onReviewed={(gameId, platform) =>'));
});
