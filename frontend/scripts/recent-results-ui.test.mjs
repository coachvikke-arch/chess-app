/* Recent Rated Results — the table on the Ratings page.
 *
 * WHAT THIS PINS
 * --------------
 *   1. OPPONENT NAMES ARE NEVER CLIPPED ON THE LEFT. The old cell let a long name
 *      widen the table until the wrapper scrolled, so the start of "IYAPPAN…"
 *      was off-screen. It is now a fixed-width, left-aligned box that truncates
 *      with an ellipsis and expands to the full name on tap/long-press.
 *   2. THE PAGE NEVER SCROLLS SIDEWAYS. The table keeps a min-width inside its
 *      own overflow-x-auto container, so only that container scrolls.
 *   3. THE CONTROL COLUMN IS CANONICAL. Rows render "Rapid"/"Blitz"/…
 *      from the row's time_class, not a raw "10+0" for one row and "Rapid" for
 *      the next.
 *   4. WHEN IS READABLE. Recent games are relative ("3d ago"); older ones are an
 *      explicit dd/mm/yyyy that no device locale can flip to MM/DD.
 *
 * The page is JSX, so this reads the source (the same approach as the other
 * UI contract tests) and evaluates the extracted pure `ago` helper.
 *
 * Run: node --test scripts/recent-results-ui.test.mjs   (from frontend/)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'src', 'pages', 'Ratings.jsx'), 'utf8');

function slice(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = SRC.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker ${endMarker}`);
  return SRC.slice(start, end);
}

/* Pull `function ago(...) { ... }` out of the source and run it directly. The
   helper is plain JS with no imports, so evaluating it is exact. */
function loadAgo() {
  const body = slice('function ago(iso)', '\nfunction ');
  return new Function(`${body}\nreturn ago;`)();
}

test('control labels cover every pool and prefer the stored class', () => {
  const map = slice('const CONTROL_LABEL', ';');
  for (const cls of ['bullet', 'blitz', 'rapid', 'classical']) {
    assert.match(map, new RegExp(`${cls}: '(Bullet|Blitz|Rapid|Classical)'`));
  }
  assert.match(SRC, /CONTROL_LABEL\[r\.time_class\] \|\| r\.time_control \|\| '—'/,
    'a row must render its canonical class, falling back to the stored label');
});

test('opponent cell is fixed, left-aligned, truncating and expandable', () => {
  const cell = slice('function OpponentCell', '\nfunction Delta');
  assert.match(cell, /<td className="py-2 pr-3 align-top">/);
  assert.match(cell, /className="block w-full text-left"/, 'left-aligned box, never a centred one');
  assert.match(cell, /title=\{label\}/, 'full name on desktop hover');
  assert.match(cell, /aria-expanded=\{open\}/);
  assert.match(cell, /onClick=\{\(\) => onToggle\(id\)\}/, 'tap to expand');
  assert.match(cell, /onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); onToggle\(id, true\); \}\}/,
    'long-press opens the same toggle');
  assert.match(cell, /minWidth: 0/, 'a shrinking flex/grid child may actually shrink');
  assert.match(cell, /maxWidth: '100%'/);
  assert.match(cell, /whiteSpace: open \? 'normal' : 'nowrap'/);
  assert.match(cell, /overflow: open \? 'visible' : 'hidden'/);
  assert.match(cell, /textOverflow: open \? 'clip' : 'ellipsis'/);
});

test('the table scrolls inside its own container, never the page', () => {
  assert.match(SRC, /<div className="overflow-x-auto" style=\{\{ maxWidth: '100%' \}\}>/);
  assert.match(SRC, /style=\{\{ tableLayout: 'fixed', minWidth: 720 \}\}/,
    'fixed layout makes the column widths real and gives truncation something to truncate');
  assert.match(SRC, /<OpponentCell\s+id=\{r\.id\}\s+name=\{r\.opponent_name\}/);
  /* One expanded row at a time, so the table height does not jump. */
  assert.match(SRC, /const \[openOpponent, setOpenOpponent\] = useState\(null\)/);
});

test('the When column shows relative time recently and dd/mm/yyyy after a week', () => {
  const ago = loadAgo();
  const now = Date.now();
  const at = (ms) => new Date(now - ms).toISOString();

  assert.equal(ago(at(30 * 1000)), 'just now');
  assert.equal(ago(at(5 * 60 * 1000)), '5m ago');
  assert.equal(ago(at(3 * 3600 * 1000)), '3h ago');
  assert.equal(ago(at(2 * 86400 * 1000)), '2d ago');

  const old = new Date(2026, 9, 27, 12, 0, 0); // 27 Oct 2026, local
  assert.equal(ago(old.toISOString()), '27/10/2026');

  const firstOfMonth = new Date(2026, 0, 5, 9, 0, 0);
  assert.equal(ago(firstOfMonth.toISOString()), '05/01/2026', 'day and month are zero-padded');

  assert.equal(ago(null), '—');
  assert.equal(ago('not a date'), '—');
  const code = slice('function ago(iso)', '\nfunction ').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('toLocaleDateString'),
    'the device locale must not decide dd/mm vs mm/dd');
});
