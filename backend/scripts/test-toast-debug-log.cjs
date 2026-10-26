/* Executes the real Toast.jsx showToast through the duplicate-toast scenario
 * and prints the [toast-debug] log output.
 *
 * Run: node scripts/test-toast-debug-log.cjs
 * Asserts: first popup shows, same-key repeat is suppressed, different key shows.
 */
const path = require('path');
const esbuild = require('../../frontend/node_modules/esbuild');

const entry = path.join(__dirname, 'toast-harness-entry.jsx');
const stubReact = path.join(__dirname, 'toast-harness-stub-react.cjs');
const stubJsx = path.join(__dirname, 'toast-harness-stub-jsx.cjs');

const outFile = path.join(__dirname, '.toast-harness-bundle.cjs');
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  alias: { react: stubReact, 'react/jsx-runtime': stubJsx },
  jsx: 'automatic',
  logLevel: 'silent',
});

const { runScenario } = require(outFile);
console.log('--- [toast-debug] log for one match request (game 1491, user 7) ---');
const { id1, id2, id3 } = runScenario();
console.log('--- scenario result ---');
console.log(`arena game-invite toast id: ${id1} (expected: a number = shown)`);
console.log(`bell match-request popup id: ${String(id2)} (expected: null = suppressed duplicate)`);
console.log(`unrelated request toast id: ${id3} (expected: a number = shown)`);

let fail = 0;
if (typeof id1 !== 'number') { console.log('FAIL: first popup was not shown'); fail += 1; }
if (id2 !== null) { console.log('FAIL: duplicate popup was not suppressed'); fail += 1; }
if (typeof id3 !== 'number') { console.log('FAIL: unrelated request was suppressed'); fail += 1; }
console.log(fail === 0 ? 'toast dedupe scenario: PASS (1 popup, not 2)' : 'toast dedupe scenario: FAIL');

try { require('fs').unlinkSync(outFile); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
