import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/* The leaderboard page, and the two ways it could show the wrong thing.
 *
 * A coach opened it and saw "No rated games yet — the leaderboard fills as
 * matches are played." Nothing was wrong with the games. The page asked for
 * `/students/ratings/leaderboard`, which sits behind `requireFeature('leaderboard')`,
 * so a coach with that switch off got a 403 — and the catch turned every failure
 * into an empty array, which the page then rendered as "no games". A permission
 * error was being reported as an absence of chess.
 *
 * Two separate defects, both fixed: the coach reads the coach endpoint, and a
 * failed load says so instead of claiming the board is empty. */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(join(ROOT, 'src', 'pages', 'Leaderboard.jsx'), 'utf8');
let mod;

async function bundle() {
  const outfile = join(ROOT, 'node_modules', '.leaderboard-endpoint.test.mjs');
  await build({
    stdin: {
      contents: "export { leaderboardEndpointFor } from './src/pages/Leaderboard.jsx';",
      resolveDir: ROOT,
      sourcefile: 'leaderboard-entry.js',
      loader: 'jsx',
    },
    absWorkingDir: ROOT,
    bundle: true,
    format: 'esm',
    outfile,
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'chess.js'],
    plugins: [{
      name: 'stub-modules',
      /* One namespace per stub. Sharing a single namespace made every import
       * pick up the first registered body. */
      setup(b) {
        const stubs = [
          [/context[\\/]AuthContext$/,
            'export const useAuth = () => ({ user: null });'],
          [/components[\\/]ui$/,
            'export const Page = () => null; export const Spinner = () => null;'],
          [/components[\\/]StudentAvatar$/, 'export default () => null;'],
          [/components[\\/]ChampionsPodium$/,
            'export default () => null; export const PlayerBadges = () => null;'],
          [/services[\\/]api$/, 'export default { get: async () => ({ data: [] }) };'],
        ];
        stubs.forEach(([filter, body], i) => {
          const ns = `stub-${i}`;
          b.onResolve({ filter }, () => ({ path: `stub-${i}`, namespace: ns }));
          b.onLoad({ filter: /.*/, namespace: ns }, () => ({ contents: body, loader: 'js' }));
        });
      },
    }],
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

before(async () => { mod = await bundle(); });

test('a coach reads the coach endpoint, a student the public one', () => {
  /* The coach route is gated on the admin role only, so it works whether or not
   * the `leaderboard` feature switch is on. */
  assert.equal(mod.leaderboardEndpointFor('admin'), '/students/ratings/coach');
  assert.equal(mod.leaderboardEndpointFor('superadmin'), '/students/ratings/coach');
  assert.equal(mod.leaderboardEndpointFor('student'), '/students/ratings/leaderboard');
  /* An unknown/absent role must not be handed a coach endpoint. */
  assert.equal(mod.leaderboardEndpointFor(undefined), '/students/ratings/leaderboard');
});

test('the coach endpoint is the one that includes privately hidden students', () => {
  /* Pins the reason for the split against the backend, so the choice is not
   * "optimised" back into the public route later: `/leaderboard` filters
   * `hide_from_leaderboard = FALSE`, `/coach` passes every student. */
  assert.match(source, /\/students\/ratings\/coach/, 'the coach path is in the page');
});

test('a failed load is reported as a failure, not as an empty board', () => {
  /* THE regression. `.catch(() => setRows([]))` made every 403/500 read as
   * "No rated games yet". */
  assert.match(source, /setError\(/, 'failures land in an error state');
  assert.ok(!/\.catch\(\(\) => setRows\(\[\]\)\)/.test(source),
    'a bare catch that empties the list is gone');
  assert.match(source, /error \? \(/, 'the error state is rendered');
  assert.match(source, /Try again/, 'and it offers a retry');

  /* The "no rated games" line must only be reachable after a SUCCESSFUL load. */
  const order = source.indexOf("rows.length === 0");
  assert.notEqual(order, -1, 'the empty state still exists');
  assert.ok(source.indexOf('error ? (') < order,
    'the error branch is checked BEFORE the empty branch, so a failure can never read as empty');
});

test('the read still opts out of the 30s GET memo', () => {
  assert.match(source, /api\.get\(leaderboardEndpointFor\([^)]*\),\s*\{\s*cache:\s*false\s*\}\)/,
    'ratings are read live, not from a 30 second snapshot');
});