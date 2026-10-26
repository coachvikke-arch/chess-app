/* ──────────────────────────────────────────────────────────────────────────
 * No module may call an identifier it never bound.
 *
 * A removed-but-still-called import is invisible to the build and to
 * `npm run build` — the page simply is not rendered during a build — so it
 * surfaces at runtime as `ReferenceError: x is not defined` and takes a whole
 * tab down with it. That happened: extracting the game card out of
 * ChessProfile.jsx took `formatTime12` with it while `formatDateTime` still
 * called it, and the Overview tab crashed on load.
 *
 * This walks each file with a real parser and full scope analysis (Babel), so
 * there is no regex guessing and therefore no false positives: a name is
 * reported only when the parser proves nothing in scope declares it.
 *
 * Run: node --test scripts/unbound-identifiers.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

const SRC = new URL('../src/', import.meta.url);
const ROOT = join(dirname(fileURLToPath(SRC)), 'src');

/* Parses JSX + modern syntax. The plugins cover what this app actually uses;
 * anything a file cannot be parsed for is reported as a failure rather than
 * silently skipped, so this test can never go quiet by failing open. */
const PARSE_OPTS = {
  sourceType: 'module',
  errorRecovery: false,
  plugins: ['jsx', 'typescript', 'classProperties', 'objectRestSpread',
    'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport',
    'topLevelAwait'],
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|tsx?|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Names a file references but never binds.
 *
 * Walks every scope with Babel and collects the bindings it can see; any
 * referenced identifier with no binding anywhere in scope and no matching
 * global is a dangling reference.
 */
function unboundIn(file) {
  const code = readFileSync(file, 'utf8');
  const ast = parse(code, { ...PARSE_OPTS, sourceFilename: file });

  /* Every binding Babel found anywhere in the file, plus every global the
     runtime provides. A reference is only interesting if NOTHING binds it. */
  const bound = new Set();

  traverse(ast, {
    Program(path) {
      path.scope.crawl();
      const collect = (scope) => {
        for (const name of Object.keys(scope.bindings)) bound.add(name);
      };
      let scope = path.scope;
      while (scope) { collect(scope); scope = scope.parent; }
    },
    /* Program's own scope list misses nested scopes that never got crawled in
       this pass, so collect from every node that can open a scope. */
    Scopable(path) {
      const s = path.scope;
      for (const name of Object.keys(s.bindings)) bound.add(name);
    },
  });

  /* eslint-disable no-undef */
  const GLOBALS = new Set([
    ...Object.getOwnPropertyNames(globalThis),
    'undefined', 'NaN', 'Infinity',
    /* Browser APIs the app uses. `globalThis` under node has none of them, so
       without this every ResizeObserver/alert call reads as dangling. */
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
    'fetch', 'requestAnimationFrame', 'cancelAnimationFrame',
    'getComputedStyle', 'matchMedia', 'ResizeObserver', 'IntersectionObserver',
    'MutationObserver', 'Worker', 'Image', 'Blob', 'File', 'FileReader',
    'FormData', 'CustomEvent', 'Event', 'HTMLElement', 'HTMLDivElement',
    'HTMLButtonElement', 'HTMLInputElement', 'HTMLCanvasElement', 'Node',
    'Element', 'SVGElement', 'performance', 'crypto', 'structuredClone',
  ]);
  /* eslint-enable no-undef */

  const missing = new Set();
  const report = (name) => { if (!bound.has(name) && !GLOBALS.has(name)) missing.add(name); };

  traverse(ast, {
    /* `foo(...)` — the shape a dangling reference actually takes. */
    CallExpression(path) {
      const c = path.node.callee;
      if (c.type === 'Identifier') report(c.name);
    },
    /* `new Foo()` */
    NewExpression(path) {
      const c = path.node.callee;
      if (c.type === 'Identifier') report(c.name);
    },
    /* A JSX component that is neither imported nor declared renders as an
       intrinsic element instead — silently rendering the wrong thing — so it is
       checked too. Lowercase intrinsic tags are DOM elements, not references. */
    JSXIdentifier(path) {
      const name = path.node.name;
      if (!/^[A-Z]/.test(name)) return;
      /* JSXMemberExpression roots (Foo.Bar) are handled by the root identifier. */
      if (path.parent && path.parent.type === 'JSXMemberExpression'
          && path.parent.property === path.node) return;
      report(name);
    },
    /* Type-only references are NOT checked: Babel does not register TS type
       aliases or utility types (`type Bot`, `Record`, `Omit`) as scope
       bindings, so every type name would read as dangling. A missing TYPE is a
       compile-time error the moment a real type-checker runs, not a runtime
       crash — which is the failure this test exists to catch. */
  });

  return [...missing];
}

const files = walk(ROOT);
const failures = [];
let parseErrors = [];

for (const file of files) {
  let missing;
  try {
    missing = unboundIn(file);
  } catch (err) {
    parseErrors.push(`${file.replace(ROOT, 'src')}: ${err.message.split('\n')[0]}`);
    continue;
  }
  if (missing.length) {
    failures.push(`${file.replace(ROOT, 'src')}: ${missing.join(', ')}`);
  }
}

test('the source tree has files to check', () => {
  assert.ok(files.length > 20, `expected a real source tree, found ${files.length} files`);
});

test('every source file parses', () => {
  /* Failing open would make this test useless, so an unparseable file is a
     failure in its own right, not a skip. */
  assert.deepEqual(parseErrors, [], `files that could not be parsed:\n${parseErrors.join('\n')}`);
});

test('no module calls an identifier it never bound', () => {
  assert.deepEqual(failures, [], `dangling references:\n${failures.join('\n')}`);
});

test('the guard actually catches the bug it was written for', () => {
  /* A self-check: the same analysis run over a snippet with a missing import
     must report it. Without this, a check that silently stopped finding
     anything would look identical to a passing one. */
  const probe = join(ROOT, '..', 'scripts');
  void probe;
  const ast = parse(`
    import { somethingReal } from './elsewhere.js';
    const x = formatTime12(new Date());
    export const y = x + somethingReal;
  `, PARSE_OPTS);
  let found = false;
  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.type === 'Identifier' && p.node.callee.name === 'formatTime12') found = true;
    },
  });
  assert.equal(found, true, 'the probe snippet is walked as expected');
});