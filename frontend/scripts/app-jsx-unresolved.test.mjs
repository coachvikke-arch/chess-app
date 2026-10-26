// Guards App.jsx against unresolved JSX component references.
//   run with: node --test scripts/app-jsx-unresolved.test.mjs   (from frontend/)
//
// WHY THIS EXISTS: `/games/:gameId` rendered <GmGamePage />, a component that
// was never written AND never imported. Because the identifier was unresolved,
// Rollup treated it as a global reference rather than an error, so
// `npm run build` passed cleanly and the bug only appeared at runtime, as a
// white screen, for whoever reached that URL.
//
// The same scan then turned up a second one: FeatureRoute (a NAMED export of
// components/FeatureGate.jsx) was used on 17 routes without being imported.
//
// A JSX element does not evaluate its component type when it is created, so
// `<Undefined />` only throws when that route actually renders — which is
// exactly why this slipped through both the build and casual clicking.
//
// This asserts every component used in App.jsx is either imported or defined in
// the file. It is a source scan rather than a runtime test on purpose: the whole
// point is to catch the case that the build cannot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8');

/** Comments are stripped so prose like `<GmGamePage />` is not read as code. */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      /* Preserve line breaks so reported line numbers stay accurate. */
      out += '\n'.repeat((src.slice(i - 2, end === -1 ? src.length : end).match(/\n/g) || []).length);
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

const src = stripComments(raw);

function collectDefined() {
  const defined = new Set();

  /* import Default, { a, b as c } from '...' */
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    for (const name of clause.matchAll(/\{([^}]*)\}/g)) {
      for (const part of name[1].split(',')) {
        const cleaned = part.replace(/\btype\b/, '').trim();
        if (!cleaned) continue;
        defined.add((cleaned.split(/\bas\b/)[1] || cleaned).trim());
      }
    }
    const bare = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    for (const name of bare.split(/\s+/)) if (name) defined.add(name);
  }

  /* Local declarations: function Foo, const Foo = ..., class Foo */
  for (const m of src.matchAll(/(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g)) {
    defined.add(m[1]);
  }
  return defined;
}

/** Components actually used as JSX tags: <Foo, <Foo ...>, <Foo />, <Foo>text */
function collectUsed() {
  const used = new Map();
  for (const m of src.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)) {
    const name = m[1];
    /* Line number of the tag, for an actionable failure message. */
    const line = src.slice(0, m.index).split('\n').length;
    if (!used.has(name)) used.set(name, line);
  }
  return used;
}

test('every JSX component in App.jsx is imported or defined', () => {
  const defined = collectDefined();
  const used = collectUsed();
  const unresolved = [...used.entries()]
    .filter(([name]) => !defined.has(name))
    .map(([name, line]) => `${name} (line ${line})`);

  assert.deepEqual(
    unresolved,
    [],
    `App.jsx uses components that are neither imported nor defined: ${unresolved.join(', ')}. `
      + 'An unresolved identifier is treated as a global by Rollup, so the build passes and the route throws at runtime.',
  );
});

test('the scan actually detects an unresolved component', () => {
  /* Guards the guard: if the regexes stopped matching anything, this suite would
     pass vacuously while the app kept crashing. */
  const used = collectUsed();
  assert.ok(used.size > 40, `expected to scan many components, only found ${used.size}`);
  assert.ok(used.has('BotsPage'), 'the scanner is not seeing the bot routes');
  assert.ok(used.has('FeatureRoute'), 'the scanner is not seeing FeatureRoute');
  assert.ok(!collectDefined().has('NotARealComponentName'));
});

test('the bot routes are still registered', () => {
  assert.match(src, /path="\/play\/bots" element=\{<BotsPage \/>\}/);
  assert.match(src, /path="\/play\/bot\/:botId" element=\{<BotGamePage \/>\}/);
});

test('the dead GmGamePage route is gone and the catch-all remains', () => {
  assert.doesNotMatch(src, /GmGamePage/, 'the undefined GmGamePage route is back');
  assert.doesNotMatch(src, /path="\/games\/:gameId"/);
  /* Removing it must degrade to a not-found page, not a blank screen. */
  assert.match(src, /path="\*"/, 'the catch-all not-found route must still exist');
});