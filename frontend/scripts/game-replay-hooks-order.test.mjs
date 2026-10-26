/**
 * Rules-of-hooks guard for GameReplay.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `GameReplay` called `useArrowKeys(...)` from inside an IIFE in its JSX, which
 * sat AFTER three early returns (`fetched.status === 'loading'`, `!game`,
 * `!moves.length`). useArrowKeys calls useRef, so the component registered 29
 * hooks while loading and 30 once the game arrived. React cannot reconcile that:
 * the loading -> loaded transition threw "Rendered more hooks than during the
 * previous render" and crashed /admin/gm-games.
 *
 * A build passes, TypeScript passes, and the page looks fine right up until the
 * async load resolves — which is exactly why this needs a static check rather
 * than a click-through.
 *
 * Run with: npm run test:hooks-order
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'components', 'GameReplay.tsx'), 'utf8');

const lines = src.split(/\r?\n/);
const lineOf = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;

test('GameReplay calls useArrowKeys exactly once', () => {
  const calls = lines.filter((l) => /^\s*useArrowKeys\(/.test(l));
  assert.equal(calls.length, 1, `expected 1 top-level call, found ${calls.length}: ${calls.join(' | ')}`);
});

test('useArrowKeys is NOT called inside an IIFE or JSX expression', () => {
  /* The specific shape that caused it: `{(() => { ... useArrowKeys(...) })()}`. */
  const inIife = lines.some((l) => /\(\(\)\s*=>\s*\{/.test(l) && l.includes('useArrowKeys'));
  assert.equal(inIife, false, 'useArrowKeys is inside an IIFE again');
  assert.equal(
    /useArrowKeys\([^)]*\)\s*;?\s*\}\)\(\)\}/.test(src),
    false,
    'useArrowKeys still inside a JSX IIFE expression',
  );
});

test('useArrowKeys is called before every early return in the component', () => {
  const hookLine = lineOf('useArrowKeys(stepBack, stepForward);');
  assert.ok(hookLine > 0, 'useArrowKeys call not found');

  const earlyReturns = lines
    .map((l, i) => ({ line: l, n: i + 1 }))
    /* Component-body early returns only: `if (...) return <JSX>;` at 2-space indent. */
    .filter(({ line }) => /^ {2}if \(.*\)\s*return /.test(line))
    .map(({ n }) => n);

  assert.ok(earlyReturns.length > 0, 'expected the component to have early returns');

  for (const r of earlyReturns) {
    assert.ok(
      hookLine < r,
      `early return on line ${r} precedes the useArrowKeys call on line ${hookLine}; ` +
        'any render that returns early skips the hook and changes the hook count',
    );
  }
});

test('no hook call sits inside a JSX IIFE anywhere in the component', () => {
  /* General guard for the whole file. The IIFE must be recognised as the JSX
     form `{(() => {` — a bare `(() => {` also matches `useEffect(() => {`, which
     is a hook callback, not an IIFE. */
  const OPEN = /\{\s*\(\(\)\s*=>/;
  const CLOSE = /\}\)\(\)\}/;
  const hookNames = /\b(useState|useEffect|useMemo|useRef|useCallback|useArrowKeys|useLayoutEffect)\s*\(/;

  const offenders = [];
  let inside = false;
  for (const [i, line] of lines.entries()) {
    if (!inside && OPEN.test(line)) inside = true;
    if (inside && hookNames.test(line) && !/^\s*\/\//.test(line)) {
      offenders.push(`line ${i + 1}: ${line.trim()}`);
    }
    if (inside && CLOSE.test(line)) inside = false;
  }
  assert.deepEqual(offenders, [], `hooks called inside a JSX IIFE:\n${offenders.join('\n')}`);
});

/* Comment-stripped source with LINE NUMBERS PRESERVED.
 *
 * Two things this has to get right:
 *   - comments must go, or prose about a hook ("MUST stay above the early
 *     returns... a hook placed after...") reads as a hook call;
 *   - line numbers must survive, or a failure points the reader at the wrong
 *     line. Blanking each comment with as many newlines as it occupied keeps
 *     every real line at its original index.
 */
function codeWithLineNumbers() {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^\s*\/\/.*$/gm, blank)
    .split(/\r?\n/);
}

test('no component body early return precedes ANY hook call', () => {
  /* THE GENERAL GUARD.
   *
   * The tests above only ever checked `useArrowKeys`, so a hook added later
   * anywhere below an early return passed the whole file. That is exactly how a
   * `useMemo` computing the score sheet landed after the loading/`!game`/
   * `!moves.length` returns and threw "Rendered more hooks than during the
   * previous render" in production while this suite stayed green.
   */
  const code = codeWithLineNumbers();

  /* Component-body early returns only: `if (...) return <JSX>;` at 2-space indent.
     Anything deeper is inside a callback or JSX expression, not the body. */
  const earlyReturns = code
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /^ {2}if \(.*\)\s*return /.test(line))
    .map(({ n }) => n);

  assert.ok(earlyReturns.length > 0, 'expected the component to have early returns');
  const firstReturn = Math.min(...earlyReturns);

  /* A hook call at component-body indent, however it is assigned:
     `useEffect(`, `const x = useMemo(`, `const [a, b] = useState(`. */
  const HOOK = /\b(useState|useEffect|useLayoutEffect|useMemo|useRef|useCallback|useArrowKeys)\s*[(<]/;
  const offenders = [];
  for (const [i, line] of code.entries()) {
    if (!/^ {2}\S/.test(line)) continue;
    if (!HOOK.test(line)) continue;
    if (i + 1 > firstReturn) offenders.push(`line ${i + 1}: ${line.trim()}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `hook(s) called after the early return on line ${firstReturn}; any render that ` +
      `returns early skips them and changes the hook count:\n${offenders.join('\n')}`,
  );
});

test('every early return is above the last hook call', () => {
  /* The same invariant stated from the other side, so a failure names both ends
     of the violation rather than just the hook. */
  const code = codeWithLineNumbers();

  const HOOK = /\b(useState|useEffect|useLayoutEffect|useMemo|useRef|useCallback|useArrowKeys)\s*[(<]/;
  const hookLines = code
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /^ {2}\S/.test(line) && HOOK.test(line))
    .map(({ n }) => n);

  const returnLines = code
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /^ {2}if \(.*\)\s*return /.test(line))
    .map(({ n }) => n);

  assert.ok(hookLines.length > 0, 'expected hooks in the component body');
  const lastHook = Math.max(...hookLines);
  const strays = hookLines.filter((h) => h > Math.min(...returnLines));
  assert.deepEqual(
    strays,
    [],
    `hook call(s) after the first early return: ${strays.join(', ')} (first return at ` +
      `${Math.min(...returnLines)}, last hook at ${lastHook})`,
  );
});

test('useCallback is imported, since the handlers are now memoised', () => {
  assert.match(src, /import \{[^}]*\buseCallback\b[^}]*\} from 'react'/);
});

test('stepBack and stepForward are declared once, outside the JSX', () => {
  assert.equal(lines.filter((l) => /const stepBack = useCallback/.test(l)).length, 1);
  assert.equal(lines.filter((l) => /const stepForward = useCallback/.test(l)).length, 1);
});

test('the replay controls still exist', () => {
  assert.ok(src.includes('gm-controls'), 'replay controls markup disappeared');
  assert.ok(src.includes('aria-label="Replay controls"'));
});