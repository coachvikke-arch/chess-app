/**
 * Undefined JSX component check.
 *
 * WHY THIS EXISTS
 *
 * `GameReplay.tsx` rendered `<Spinner>` on its loading and early-return paths but
 * never imported it. That is a ReferenceError at RUNTIME, not a compile error:
 *
 *   - the production build passes (Rollup only resolves what it can see),
 *   - the component renders fine until the async load resolves,
 *   - TypeScript would not catch it if `noImplicitAny` were off, and there is no
 *     linter configured at all in this project.
 *
 * The bug therefore survived until someone opened Admin → GM Games and watched
 * a real page die. This test is the cheap stand-in for a linter: it finds JSX
 * elements whose component name is never imported, declared or defined.
 *
 * Run with: npm run test:jsx-identifiers
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

const JSX_EXT = new Set(['.jsx', '.tsx']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (JSX_EXT.has(full.slice(full.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

/**
 * A capitalised name immediately after `<` is only a JSX element when the `<` is
 * NOT a TypeScript generic. `useRef<HTMLDivElement>(null)` matches naively and
 * produced three false positives on first run, so the character before the `<`
 * is required to be something that cannot precede a generic argument.
 */
const JSX_TAG = /(?<![A-Za-z0-9_$.])<([A-Z][A-Za-z0-9_]*)(?=[\s/>])/g;

/** Comments are stripped first: App.jsx documents a removed route by naming a
 *  component that no longer exists, and a checker that reads prose as code is
 *  worse than no checker. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

function definedNames(source) {
  const names = new Set();
  /* Any `import { ... } from` — including `import Default, { A, B } from`, which
   * is why the braces are matched anywhere rather than only right after
   * `import`. */
  for (const m of source.matchAll(/\{([^}]*)\}\s*from\s*['"]/g)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim().replace(/^type\s+/, '');
      if (!piece) continue;
      const as = piece.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]).trim());
    }
  }
  /* import Default from '...' and import * as NS from '...' */
  for (const m of source.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  /* declarations, including TypeScript type aliases and interfaces */
  for (const m of source.matchAll(/(?:function|class|const|let|var|type|interface|enum)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    names.add(m[1]);
  }
  return names;
}

const files = walk(srcDir);

test('there are JSX files to check', () => {
  assert.ok(files.length > 20, `only found ${files.length} JSX files - the walker is broken`);
});

test('every JSX component used is imported or defined in its own file', () => {
  const problems = [];
  for (const file of files) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const defined = definedNames(source);
    const seen = new Set();
    for (const m of source.matchAll(JSX_TAG)) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      if (defined.has(name)) continue;
      problems.push(`${relative(srcDir, file)}: <${name}> is used but never imported or defined`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `JSX components used without an import (a runtime ReferenceError waiting to happen):\n${problems.join('\n')}`,
  );
});

test('Spinner is resolvable wherever it is used', () => {
  /* Named explicitly because this is the one that actually broke. */
  const problems = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (/<Spinner[\s/>]/.test(source) && !definedNames(source).has('Spinner')) {
      problems.push(relative(srcDir, file));
    }
  }
  assert.deepEqual(problems, [], `Spinner used without an import in: ${problems.join(', ')}`);
});