import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* An undefined custom property is the quietest kind of CSS bug there is: the
   declaration is still valid, the property is simply unset, and the element
   falls back to an inherited or initial value with nothing in the console. The
   Sidebar Order rows shipped exactly that way — laid out correctly, rendered in
   an unset colour, which read as "empty".
   This checks the token names themselves so the class of bug is caught at the
   source instead of by someone staring at a panel.

   Two details make the scan trustworthy:

   1. Declared tokens are collected from JSX as well as CSS. A good number are
      injected per component through a style prop, e.g.
      style={{ '--pm-gold': '#...' }}, so a CSS-only scan calls them all dead.
   2. Only a BARE reference counts. var(--x, #a8a29e) is a deliberate fallback
      and renders perfectly well; var(--x) is the bug. Counting fallbacks as
      dead was what made an earlier version of this file report 16 problems
      where there were 6. */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = new Set(['.css', '.html', '.js', '.jsx', '.ts', '.tsx']);
const SKIP = /node_modules|dist|coverage|\.git/;

function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSources(full, out);
    else if (SOURCES.has(extname(entry.name))) out.push(full);
  }
  return out;
}

const files = collectSources(ROOT);
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

const DECL = /['"]?(--[\w-]+)['"]?\s*:/g;
const declared = new Set();
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(DECL)) declared.add(m[1]);
}

/** Bare references only: the token name followed by a closing paren. */
const bare = new Map();
for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
  if (!bare.has(m[1])) bare.set(m[1], m.index);
}

const lineOf = (index) => css.slice(0, index).split('\n').length;

/* Pre-existing, known dead. Each one is left over from an earlier dark theme
   that used a numeric ramp; the theme is now light and --gold* means light cyan,
   so these names no longer exist. Fixing them is a colour decision that needs
   to be looked at, so they are tracked here rather than guessed at.
   Remove an entry once it is fixed — the last test enforces that. */
const KNOWN_DEAD = new Map([
  ['--gx', '@keyframes hero-glide entrance offset, the glide does not animate'],
  ['--gy', '@keyframes hero-glide entrance offset, the glide does not animate'],
  ['--gold-400', '.gr-tab-active text, the active GameReplay tab has no colour'],
  ['--gold-500', '.op-card-lines caption colour'],
  ['--ivory-400', '.perm-tab text colour'],
  ['--ivory-600', '.cr-breadcrumb span separator colour'],
]);

test('the scan found the sources it is supposed to', () => {
  assert.ok(files.length > 20, `only ${files.length} source files scanned`);
  /* Was >60 before the tactics card was rebuilt onto app tokens, which retired
     the seven --tactic-* declarations. The floor only guards a broken scan. */
  assert.ok(declared.size > 55, `only ${declared.size} custom properties declared — the scan is broken`);
  /* Most references in this stylesheet deliberately carry a fallback, so the
     bare count is a fraction of the total. Both are checked so that neither a
     broken regex nor a truncated file can slip through. */
  const total = [...css.matchAll(/var\(\s*--[\w-]+/g)].length;
  assert.ok(total > 60, `only ${total} var() references found — the scan is broken`);
  assert.ok(bare.size > 10, `only ${bare.size} bare references found — the scan is broken`);
  assert.ok(bare.size < total, 'no reference has a fallback, which is not true of this stylesheet');
});

test('the palette the panel depends on is intact', () => {
  for (const token of ['--ivory-50', '--ivory-100', '--ivory-300', '--ivory-500', '--ivory-700']) {
    assert.ok(declared.has(token), `${token} is no longer defined`);
  }
});

test('no rule references a custom property that is never defined', () => {
  const found = [...bare.keys()]
    .filter((name) => !declared.has(name) && !KNOWN_DEAD.has(name))
    .map((name) => `${name} (line ${lineOf(bare.get(name))})`);
  assert.deepEqual(
    found,
    [],
    `newly dead custom properties in use:\n  ${found.join('\n  ')}\n` +
      'Either declare the token, or give the reference a fallback with var(--token, value).',
  );
});

test('the documented dead tokens are still dead, so the list cannot rot', () => {
  const fixed = [...KNOWN_DEAD.keys()].filter((name) => declared.has(name) || !bare.has(name));
  assert.deepEqual(
    fixed,
    [],
    `these were fixed but are still listed as dead: ${fixed.join(', ')}\nRemove them from KNOWN_DEAD.`,
  );
});

test('the ivory ramp gap that hid the panel bug stays closed', () => {
  /* The palette deliberately skips 200 (50/100/300/500/700). Three rules used
     --ivory-200 anyway and nothing caught it, so keep the name explicit. */
  assert.equal(declared.has('--ivory-200'), false, '--ivory-200 is defined again; drop the rules that use it');
});
