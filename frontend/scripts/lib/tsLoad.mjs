/* Shared TypeScript test loader (node --test, from frontend/).
 *
 * Transpiles a TS lib with esbuild and imports it. The transpiled file is
 * written to a temp dir, so relative imports are rewritten to absolute file
 * URLs first (with .js appended — app sources import extensionless, which
 * Vite resolves but node ESM does not), and a bare `chess.js` specifier is
 * repointed at a global instead. Imports that need a browser can be dropped
 * via `drop` regexes. */
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export async function loadTsLib(url, { drop = [] } = {}) {
  const basePath = dirname(fileURLToPath(url));
  let source = readFileSync(url, 'utf8');
  for (const pattern of drop) source = source.replace(pattern, '');
  source = source.replace(
    /^import\s+\{\s*Chess\s*\}\s+from\s+['"][^'"]+['"];?[ \t]*\r?\n/m,
    'const Chess = globalThis.__Chess;'
  );
  source = source.replace(
    /^(\s*import\s+(?:[^'"]+\s+from\s+)?['"])(\.[^'"]*)(['"])/gm,
    (_, head, rel, tail) => {
      const withExt = /\.[a-z]+$/i.test(rel) ? rel : `${rel}.js`;
      return `${head}${pathToFileURL(join(basePath, withExt)).href}${tail}`;
    }
  );
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const file = join(mkdtempSync(join(tmpdir(), 'ts-lib-')), 'lib.mjs');
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}
