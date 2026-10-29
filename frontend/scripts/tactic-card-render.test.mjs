// The tactic card is ONE shared component for all 45 tactics: a visual change
// here must land identically on every page, and a data change must never need
// markup. These render Fork, Pin, Skewer and Back Rank Mate through the real
// component and assert the same chrome, the same teaching blocks and the same
// arrows come out each time.
//   run with: node --test scripts/tactic-card-render.test.mjs   (from frontend/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* Bundle the card the way the panel test bundles its component: JSX resolves,
   chess.js comes along for the replay timeline, and React stays shared with
   the test's own react-dom/server copy. Effects never run under static markup,
   so every render shows the opening explained state - which is exactly what a
   reader lands on. */
/* The board reads the piece theme from auth, so the test needs a provider. The
   real one touches localStorage on first render, which does not exist under
   node — a tiny in-memory stand-in is enough, since effects never run here and
   the user starts signed out (default piece theme). */
if (typeof localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

async function bundleCard() {
  const outfile = join(ROOT, 'node_modules', '.tactic-card.test.mjs');
  await build({
    stdin: {
      contents: [
        "export { default as Card } from './src/features/tactics/components/TacticCard.jsx';",
        "export { AuthProvider } from './src/context/AuthContext.jsx';",
        // AuthProvider redirects forced logouts with useNavigate, so the test
        // needs a router from the SAME module instance it bundled.
        "export { MemoryRouter } from 'react-router-dom';",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 'tactic-card-entry.js',
      loader: 'jsx',
    },
    absWorkingDir: ROOT,
    bundle: true,
    format: 'esm',
    outfile,
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
    /* AuthContext pulls in services/socket, which reads import.meta.env and
       window.location at module scope. Neither exists here, so the env is
       stubbed with a URL — that also short-circuits the window fallback. */
    define: { 'import.meta.env': '{"VITE_SOCKET_URL":"http://localhost"}' },
  });
  return import(pathToFileURL(outfile).href);
}

const tactics = JSON.parse(
  readFileSync(join(ROOT, 'src', 'features', 'tactics', 'data', 'tactics.json'), 'utf8'),
);
const bySlug = (slug) => tactics.find((t) => t.slug === slug);

let Card;
let AuthProvider;
let MemoryRouter;
before(async () => {
  ({ Card, AuthProvider, MemoryRouter } = await bundleCard());
});

/* Fork, Pin, Skewer, Back Rank Mate: one basic, one line, one check, one mate. */
const SAMPLE = ['fork', 'pin', 'skewer', 'back-rank-mate'];
const pad2 = (n) => String(n).padStart(2, '0');

const render = (slug, solved) =>
  renderToStaticMarkup(
    h(MemoryRouter, null,
      h(AuthProvider, null, h(Card, { tactic: bySlug(slug), solved, onExplained: () => {} }))),
  );

for (const slug of SAMPLE) {
  test(`${slug}: header chips, title and caption render the tactic's own words`, () => {
    const t = bySlug(slug);
    const html = render(slug, true);
    assert.ok(html.includes(`Tactic ${pad2(t.id)}`), 'number chip is missing');
    assert.ok(html.includes(t.category), 'category chip is missing');
    assert.ok(html.includes(`>${t.title}<`), 'title is missing');
    assert.ok(html.includes(t.caption), 'board caption is missing');
  });

  test(`${slug}: replay control, studied marker, blocks and tags are all present`, () => {
    const t = bySlug(slug);
    const html = render(slug, true);
    assert.ok(html.includes('Replay tactic'), 'replay button is missing');
    assert.ok(html.includes('studied'), 'studied marker is missing when solved');
    for (const label of ['What it is', 'Why it wins', 'Do this']) {
      assert.ok(html.includes(label), `${label} block is missing`);
    }
    assert.ok(html.includes(t.whatItIs), 'WHAT IT IS text is missing');
    assert.ok(html.includes(t.whyItWins), 'WHY IT WINS text is missing');
    assert.ok(html.includes(t.doThis), 'DO THIS text is missing');
    for (const tag of t.tags) {
      assert.ok(html.includes(`>${tag}<`), `tag ${tag} is missing`);
    }
  });

  test(`${slug}: the board draws exactly the tactic's own arrows`, () => {
    const t = bySlug(slug);
    const html = render(slug, true);
    assert.ok(html.includes('tactic-board'), 'the board svg is missing');
    /* One <polygon> per arrowhead: the diagram must show the stored idea. */
    const heads = html.match(/<polygon/g) || [];
    assert.equal(heads.length, t.arrows.length,
      `expected ${t.arrows.length} arrows, drew ${heads.length}`);
  });

  test(`${slug}: unsolved cards show no studied marker`, () => {
    assert.ok(!render(slug, false).includes('studied'), 'studied marker leaks when unsolved');
  });
}
