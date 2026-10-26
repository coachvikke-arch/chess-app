// Tests for the Sigma persistence WIRING
// (frontend/src/pages/GameReview.jsx, ChessProfile.jsx, AnalysisBoard.jsx) -
//   run with: node --test scripts/sigma-wiring.test.mjs   (from frontend/)
//
// sigma-persist.test.mjs proves the payload is right. These prove the payload
// is actually SENT: the three screens that can review a stored game each have
// to hand the review its (gameSource, gameId) origin, and the finish handler
// has to run with the CURRENT origin rather than the one captured on mount.
//
// Why source assertions: the bug was a stale React closure - a listener
// attached in a `useEffect(..., [])` captured the first render's `gameOrigin`,
// where it is still { gameSource: null, ... }, so `canPersist` was always false
// and no request ever went out. Reproducing that needs the whole page (router,
// auth context, engine pool); what must never regress is the shape of the fix,
// which is what is pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');

const reviewSrc = readFileSync(join(FRONTEND, 'src', 'pages', 'GameReview.jsx'), 'utf8');
const profileSrc = readFileSync(join(FRONTEND, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
const boardSrc = readFileSync(join(FRONTEND, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');

/* The one effect that attaches to the background runner. Its dep array is
   empty on purpose - the runner outlives renders - which is exactly why the
   callback inside it must go through a ref. */
const ATTACH_EFFECT = /attachReview\([\s\S]{0,3000}?\}\);[\s\S]{0,120}?return detach;/;

test('the runner listener applies the CURRENT review result, not the first render\'s', () => {
  const effect = reviewSrc.match(ATTACH_EFFECT);
  assert.ok(effect, 'the attachReview effect must still be recognisable');
  assert.match(effect[0], /applyReviewRef\.current\(snap\.result\)/,
    'the listener must call through the ref; a direct applyReviewResult(...) here is the mount-time copy, whose gameOrigin is still empty');
  assert.ok(!/[^.]applyReviewResult\(snap\.result\)/.test(effect[0]),
    'a direct call would resurrect the stale-closure bug: canPersist would never be true');
});

test('the ref is refreshed on every render, so the listener never lags behind', () => {
  assert.match(reviewSrc,
    /const applyReviewRef = useRef\(applyReviewResult\);\s*\n\s*useEffect\(\(\) => \{ applyReviewRef\.current = applyReviewResult; \}\);/,
    'the ref must be initialised with, and reassigned from, the latest applyReviewResult (an effect with NO dep array, so it runs after every render)');
});

test('filing a review still reads the origin it was filed against', () => {
  assert.match(reviewSrc,
    /if \(canPersist\(gameOrigin\.gameSource, gameOrigin\.gameRefId\)\) \{[\s\S]{0,400}?persistSigmaMoves\(\{/,
    'the save must be gated on the live gameOrigin and must actually POST');
});

test('a chess.com / Lichess game reviewed in the profile viewer files its Sigmas', () => {
  /* This screen runs its own review and never reaches the Review page, so it
     needs its own save - without it an imported game's brilliant moves were
     classified, drawn, and then dropped. */
  assert.match(profileSrc, /import \{ persistSigmaMoves, canPersist \} from '\.\.\/utils\/sigmaPersist';/,
    'ChessProfile must import the Sigma save');
  assert.match(profileSrc, /persistSigmaMoves\(\{\s*\n\s*review: res,\s*\n\s*gameSource: 'chess_profile',/,
    'the viewer must file against source chess_profile with the review it just produced');
  assert.match(profileSrc, /gameId: Number\(game\.id\)/,
    'the chess_games row id must be carried through as the game id');
});

test('a game opened from AnalysisBoard carries its origin across the navigation', () => {
  assert.match(boardSrc, /id=\$\{encodeURIComponent\(onlineGame\.id\)\}&src=online/,
    'AnalysisBoard must pass the source alongside the session id');
  assert.match(reviewSrc, /const origin = canPersist\(srcParam, idParam\)/,
    'GameReview must turn ?src=&id= into a validated origin, not leave it null');
  assert.match(reviewSrc, /if \(pgn\) loadPgnText\(pgn, undefined, origin\);/,
    'the origin must reach loadPgnText, which is the only thing that sets gameOrigin');
});
