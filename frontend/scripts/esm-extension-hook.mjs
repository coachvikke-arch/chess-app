/**
 * Test-only ESM resolve hook.
 *
 * The app source uses extensionless relative imports (`from '../data/levels'`),
 * which Vite resolves but Node's ESM loader does not. This hook teaches Node the
 * same two rules Vite applies, so tests can import the real source files rather
 * than re-implementing them:
 *
 *   1. a relative specifier with no extension tries `<path>.js`, then `<path>/index.js`
 *   2. `.jsx` files are compiled to plain JS (they contain no JSX in the modules
 *      the tests touch — the hook only reaches them if a test imports one)
 *
 * Register with:
 *   import { register } from 'node:module';
 *   register('./resolve-happens.mjs', import.meta.url);
 *   // then dynamic-import the modules under test
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CANDIDATE_SUFFIXES = ['', '.js', '.jsx', '/index.js', '/index.jsx'];

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isRelative) return nextResolve(specifier, context);

  const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
  const base = path.resolve(path.dirname(parentPath), specifier);

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (!existsSync(candidate)) continue;
    const stats = statSync(candidate);
    if (!stats.isFile()) continue;
    return {
      url: pathToFileURL(candidate).href,
      shortCircuit: true,
      format: candidate.endsWith('.jsx') ? 'module' : undefined,
    };
  }

  return nextResolve(specifier, context);
}

/**
 * Minimal JSX-free loader for `.jsx`. If a test ever imports a component with
 * real JSX in it, this throws a clear error rather than a cryptic syntax error.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    if (/</.test(source) && /return\s*\(/.test(source)) {
      throw new Error(
        `resolve-happens.mjs cannot compile JSX in ${url}. Import pure logic modules in tests, not components.`,
      );
    }
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}