/* No hook may name a value that is bound below it.
 *
 * A hook's dependency array is read while the component RENDERS, so naming a
 * value declared further down the component body is a temporal-dead-zone read:
 * `Cannot access 'x' before initialization`, thrown before the component ever
 * paints. The classroom board hit this for real — its fit effect spent
 * `infoCardWidth`, and the board was a blank screen until the declaration moved
 * up above it.
 *
 * The usual lint rule misses it, because to a linter the two bindings look like
 * an ordinary closure.
 *
 * Run: node --test scripts/hook-order.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');

const BUILTINS = new Set([
  'Math', 'JSON', 'Object', 'Array', 'Number', 'String', 'Boolean', 'window', 'document',
  'console', 'Date', 'Set', 'Map', 'WeakMap', 'Symbol', 'Promise', 'Error', 'RegExp',
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'globalThis', 'require',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'parseInt', 'parseFloat', 'isNaN',
  'URL', 'Intl', 'AbortController', 'BigInt',
]);

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(full);
  }
  return out;
}

/* Strip strings, template literals and comments so brace counting is honest —
   a `}` inside a string would otherwise close a scope that never closed. */
function stripNoise(line) {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

const opensScope = (line) => (
  /^(?:export\s+)?(?:default\s+)?function\b/.test(line)
  || /^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/.test(line)
  || /^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?function\b/.test(line)
  || /^(?:export\s+)?const\s+\w+\s*=\s*\w+\s*=>/.test(line)
);

/**
 * Per top-level function scope: the bindings it declares, and the hooks whose
 * dependency arrays name them. Scoping matters — `MiniDrillBoard({ fen, moves })`
 * and `QuizPuzzleModal`'s `fen` are unrelated names in unrelated components, and
 * treating them as one scope turns every one of them into a false positive.
 */
function scopesIn(lines) {
  const scopes = [];
  let depth = 0;
  let current = null;
  let base = 0;

  lines.forEach((raw, i) => {
    const line = stripNoise(raw);
    const n = i + 1;
    if (depth === 0 && opensScope(line)) {
      current = { decls: new Map(), deps: [], inHook: false };
      base = 0;
    }
    /* Only the scope's OWN statements count. A `const` inside a nested function —
       a handler, a memo callback — shadows the outer name and is not the
       binding a hook's dependency array could be reading. Ignoring them is what
       keeps this check about component bodies only. */
    const own = current && depth === base + 1;

    const decl = own ? line.match(/^\s+const\s+(?:\[([^\]]+)\]|(\w+))\s*=/) : null;
    if (decl) {
      if (decl[1]) {
        decl[1].split(',').forEach((part) => {
          const name = part.trim().split('=')[0].trim();
          if (name) current.decls.set(name, n);
        });
      } else {
        current.decls.set(decl[2], n);
      }
    }
    /* A hook's dependency list. The hook CALL is recognised at the scope's own
     * depth; its closing `}, [deps]);` can be several levels deeper (an arrow
     * body and its parens all count), so it is matched by "we are inside a hook
     * that has not reported yet" rather than by a fixed depth. */
    if (own && /\buse[A-Z]\w*\(/.test(line)) current.inHook = true;
    if (current && current.inHook) {
      /* Both spellings report here: the one-line `useEffect(() => {…}, [a, b]);`
       * and the multi-line `useEffect(() => {\n …\n }, [a, b]);`. Both end in
       * `}, [deps]);`, so one pattern covers both. */
      const dep = line.match(/\}, \[([^\]\s][^\]]*)\]\);\s*(\/\/.*)?$/);
      if (dep && dep[1].trim()) {
        current.deps.push([n, dep[1]]);
        current.inHook = false;
      }
    }

    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    }
    if (depth === 0 && current) {
      if (current.deps.length) scopes.push(current);
      current = null;
    }
  });
  if (current && current.deps.length) scopes.push(current);
  return scopes;
}

const forwardsIn = (scopes) => {
  const out = [];
  for (const scope of scopes) {
    for (const [line, deps] of scope.deps) {
      for (const raw of deps.split(',')) {
        const name = raw.trim().replace(/\?.*/, '').replace(/\..*/, '').trim();
        if (!name || BUILTINS.has(name)) continue;
        const at = scope.decls.get(name);
        if (at !== undefined && at > line) out.push([line, name, at]);
      }
    }
  }
  return out;
};

test('no hook names a binding declared below it', () => {
  const offenders = [];
  for (const file of sourceFiles(srcRoot)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const [line, name, at] of forwardsIn(scopesIn(lines))) {
      offenders.push(`${relative(root, file)}:${line} uses '${name}', declared at line ${at}`);
    }
  }
  assert.deepEqual(offenders, [], `hook dependency arrays read bindings declared below them:\n  ${offenders.join('\n  ')}`);
});

test('the guard catches the bug it was written for', () => {
  /* The shape that crashed the classroom board. If the guard stops flagging it,
     the guard is broken. */
  const bad = [
    'export default function Board() {',
    '  const [size, setSize] = useState(0);',
    '  useEffect(() => { fit(size, cardWidth); }, [size, cardWidth]);',
    '  const [cardWidth, setCardWidth] = useState(0);',
    '  return null;',
    '}',
  ];
  const flagged = forwardsIn(scopesIn(bad));
  assert.equal(flagged.length, 1, 'the guard must flag a dep bound below its hook');
  assert.equal(flagged[0][1], 'cardWidth', 'and name the offending binding');

  /* The same code in the right order must pass. */
  const good = [
    'export default function Board() {',
    '  const [cardWidth, setCardWidth] = useState(0);',
    '  const [size, setSize] = useState(0);',
    '  useEffect(() => { fit(size, cardWidth); }, [size, cardWidth]);',
    '  return null;',
    '}',
  ];
  assert.deepEqual(forwardsIn(scopesIn(good)), [], 'the guard must not flag correctly ordered deps');

  /* And the multi-line form, which is how the board actually spells it. */
  const multiline = [
    'export default function Board() {',
    '  const [size, setSize] = useState(0);',
    '  useEffect(() => {',
    '    fit(size);',
    '  }, [size, cardWidth]);',
    '  const [cardWidth, setCardWidth] = useState(0);',
    '  return null;',
    '}',
  ];
  assert.equal(forwardsIn(scopesIn(multiline)).length, 1, 'the multi-line form must be read too');
});

test('a binding in one component is not a binding in another', () => {
  /* `fen` is declared twice in this file on purpose. Reading across components
     would report both as forward references and bury the real finding. */
  const twoComponents = [
    'function Mini({ fen, moves }) {',
    '  const game = useMemo(() => build(fen, moves), [fen, moves]);',
    '  return game;',
    '}',
    '',
    'function Modal({ fen }) {',
    '  const solution = useMemo(() => solve(fen), [fen]);',
    '  return solution;',
    '}',
  ];
  assert.deepEqual(forwardsIn(scopesIn(twoComponents)), [], 'props from another component are not forward references');
});

test('the classroom board binds its measurement above the fit that spends it', () => {
  /* The concrete crash, named so a future move of that declaration is caught
     here rather than in a lesson. */
  const board = readFileSync(join(srcRoot, 'components', 'liveclass', 'SharedChessBoard.jsx'), 'utf8');
  const widthAt = board.indexOf('const [infoCardWidth');
  const refAt = board.indexOf('const infoCardRef');
  const fitAt = board.indexOf('}, [manualSize, infoCardWidth, framedBoard]);');
  const measureAt = board.indexOf('}, [infoCardEl]);');
  assert.ok(widthAt !== -1 && fitAt !== -1, 'both the measurement and the fit must exist');
  assert.ok(widthAt < fitAt, 'infoCardWidth must be bound before the fit effect names it');
  assert.ok(refAt !== -1 && refAt < measureAt, 'the card ref must be bound before the measure effect names it');
});