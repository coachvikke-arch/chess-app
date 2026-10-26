// Guards the `./data/bots` resolution trap
//   run with: node --test scripts/bot-catalogue-resolution.test.mjs   (from frontend/)
//
// HISTORY: `src/data/bots.js` used to hold a 4-bot stub. Both Vite and Rollup
// resolve an extensionless `./data/bots` to `.js` BEFORE `.ts`, so the stub
// silently shadowed the real 30-bot `bots.ts` — the app ran the wrong roster and
// several progression tests failed for reasons that pointed nowhere near the
// cause.
//
// `bots.js` is now a one-line re-export of `bots.ts`. That is deliberate: it
// keeps a browser tab that still holds the pre-deletion module graph working,
// without reintroducing a second source of truth.
//
// These tests resolve the catalogue the way application code does and assert
// BOTH entry points yield the identical 30-bot roster, so the shim can never
// quietly become a divergent copy again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src', 'data');

/* Absolute, because the entry file is written to a temp directory and
 * esbuild resolves relative specifiers against the importing file. */
const SPEC_EXTENSIONLESS = join(DATA, 'bots');
const SPEC_JS = join(DATA, 'bots.js');
const SPEC_TS = join(DATA, 'bots.ts');

/** Bundle a throwaway entry file and import the result. */
async function loadVia(specifier) {
  const dir = mkdtempSync(join(tmpdir(), 'bots-resolve-'));
  try {
    const entry = join(dir, 'entry.mjs');
    const out = join(dir, 'out.mjs');
    writeFileSync(entry, `export * from ${JSON.stringify(specifier)};`);
    await build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      outfile: out,
      logLevel: 'silent',
      /* bots.ts calls import.meta.glob (Vite-only). Stubbed here because the
       * catalogue values under test do not involve avatars. */
      define: { 'import.meta.glob': '__stub' },
      banner: { js: 'const __stub = () => ({});' },
    });
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the extensionless import every app module uses gives the full roster', async () => {
  /* This is the specifier that silently resolved to the old stub. */
  const mod = await loadVia(SPEC_EXTENSIONLESS);
  assert.equal(mod.BOTS.length, 30, 'the extensionless import did not reach the 30-bot catalogue');

  const counts = {};
  for (const b of mod.BOTS) counts[b.difficulty] = (counts[b.difficulty] || 0) + 1;
  /* Five per tier is what makes the defeat ladder satisfiable: Advanced needs 5
     Intermediate wins, so a 4-bot tier would make it unreachable. */
  for (const tier of ['Beginner', 'Casual', 'Intermediate', 'Advanced', 'Expert', 'Master']) {
    assert.equal(counts[tier], 5, `${tier} has ${counts[tier]} bots, expected 5`);
  }
});

test('the legacy .js path resolves to the same catalogue, not a copy', async () => {
  const viaJs = await loadVia(SPEC_JS);
  const viaTs = await loadVia(SPEC_TS);
  assert.equal(viaJs.BOTS.length, 30, 'bots.js no longer re-exports the catalogue');
  assert.deepEqual(
    viaJs.BOTS.map((b) => b.id),
    viaTs.BOTS.map((b) => b.id),
    'the shim exposes a different roster than bots.ts',
  );
  assert.deepEqual(viaJs.DIFFICULTY_BANDS, viaTs.DIFFICULTY_BANDS, 'the shim exposes different bands');
});

test('the shim does not import itself', async () => {
  /* `export * from './bots'` inside bots.js would resolve back to bots.js and
     import itself. The `.ts` specifier is what prevents that. */
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(join(ROOT, 'src', 'data', 'bots.js'), 'utf8')
  );
  const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, 'the shim re-exports nothing');
  for (const spec of specifiers) {
    assert.notEqual(spec, './bots', "the shim must use the explicit '.ts' specifier or it imports itself");
    assert.match(spec, /\.ts$/, `the shim should only re-export bots.ts, found ${spec}`);
  }
});

test('only the catalogue and the shim exist in src/data', async () => {
  const fs = await import('node:fs');
  const entries = fs.readdirSync(join(ROOT, 'src', 'data'));
  const botFiles = entries.filter((f) => f.startsWith('bots'));
  assert.deepEqual(botFiles.sort(), ['bots.js', 'bots.ts'], `unexpected files in src/data: ${botFiles}`);
});