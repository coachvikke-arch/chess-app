// Tests for the GM Games "Undo import" (remove a player pack) feature —
//   run with: node --check scripts/gm-undo-import.test.mjs   (from frontend/)
//
// Two silent-failure hazards are guarded here, both of which would look fine in
// the UI while doing the wrong thing on the server:
//
//  1. ROUTE ORDER. Express matches in declaration order. `router.delete('/:id')`
//     is already registered, so if `DELETE /import/player` were added AFTER it,
//     "/import/player" would match '/:id' first (the "import" segment) and the
//     request would be treated as "delete the game whose id is literally
//     'import'" — i.e. undo would silently do nothing, or worse, the wrong
//     thing, with no error.
//  2. BLAST RADIUS. The delete must be scoped to the `player` column and the
//     name must be validated against the known pgnmentor list, so the route can
//     never become an arbitrary "DELETE ... WHERE player = <anything>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BACK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
const FRONT = join(dirname(fileURLToPath(import.meta.url)), '..');
const routes = readFileSync(join(BACK, 'src', 'routes', 'gmGameRoutes.js'), 'utf8');
const ctrl = readFileSync(join(BACK, 'src', 'controllers', 'gmGameController.js'), 'utf8');
const api = readFileSync(join(FRONT, 'src', 'services', 'gmGamesApi.js'), 'utf8');
const page = readFileSync(join(FRONT, 'src', 'pages', 'AdminGmGames.jsx'), 'utf8');
const css = readFileSync(join(FRONT, 'src', 'index.css'), 'utf8');

const idx = (src, needle) => {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `missing: ${needle}`);
  return i;
};

/* Body of the FIRST rule for a literal selector, e.g. '.gm-player-pack-name'. */
const ruleFor = (src, sel) => {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = src.match(re);
  assert.ok(m, `no CSS rule found for ${sel}`);
  return m[1];
};

test('the player-delete route is registered BEFORE the /:id catch-all', () => {
  /* The whole point: Express takes the FIRST match. Registered after '/:id',
     "/import/player" would be captured as id="import". */
  const playerRoute = idx(routes, "router.delete('/import/player'");
  const idRoute = idx(routes, "router.delete('/:id'");
  assert.ok(playerRoute < idRoute,
    "DELETE '/import/player' MUST be declared before DELETE '/:id'");
});

test('the undo route is admin-gated like every other write', () => {
  const line = routes.split('\n').find((l) => l.includes("router.delete('/import/player'"));
  assert.match(line, /roleMiddleware\('admin'\)/,
    'the undo route must require the admin role');
});

test('the delete is scoped to the player column (not a blanket table wipe)', () => {
  assert.match(ctrl, /DELETE FROM gm_games WHERE player = \$1/i,
    'must delete only rows whose player matches the parameter');
  assert.ok(!/DELETE FROM gm_games\s*(;|$)/im.test(ctrl.replace(/WHERE player = \$1/g, '')),
    'there must be no unqualified DELETE FROM gm_games');
});

test('the player name is validated against the known list', () => {
  /* Guards the route against being used as an arbitrary mass-delete. */
  const fn = ctrl.slice(idx(ctrl, 'exports.removePlayerGames'));
  assert.match(fn, /PGNMENTOR_PLAYERS\.find/,
    'the name must be resolved against the known player list');
  assert.match(fn, /Unknown player/,
    'an unknown name must be rejected with a clear 400');
});

test('the handler reports how many rows it removed', () => {
  /* The UI toasts this count, and also uses the returned ids to close the
     viewer if the open game was among the deleted ones. */
  const fn = ctrl.slice(idx(ctrl, 'exports.removePlayerGames'));
  assert.match(fn, /deleted:\s*result\.rows\.length/);
  assert.match(fn, /ids:\s*result\.rows\.map/);
});

test('the client sends the player in the BODY, not the path', () => {
  /* A name in the path would need encoding and could collide with '/:id'. */
  assert.match(api, /api\.delete\('\/gm-games\/import\/player',\s*\{\s*data:\s*\{\s*player\s*\}\s*\}\)/,
    'removeGmPlayerGames must DELETE the fixed path with { player } in the body');
});

test('undo is only offered for a player that actually has games', () => {
  assert.match(page, /\{player\.count > 0 && \(\s*<button[\s\S]*?gm-player-pack-undo/,
    'the Undo button must render only when player.count > 0');
  assert.match(page, /runPlayerRemove\(player\.name,\s*player\.count\)/,
    'the confirm must be given the real game count');
});

test('the undo button is SYMBOL-ONLY, not a text button', () => {
  /* A full "↩ Undo import" label made the row too wide: every item in the row
     except the name is `flex-shrink: 0`, so the wide second button pushed the
     player's NAME to zero width and the rows rendered blank. Icon-only is the
     fix, but the control must stay perceivable. */
  const at = idx(page, 'className="gm-player-pack-undo"');
  const btn = page.slice(at - 400, at + 900);
  assert.ok(!/:\s*'↩ Undo import'/.test(btn),
    "the visible label must be the symbol alone, not '↩ Undo import'");
  assert.match(btn, /aria-label=\{`Undo import/,
    'an icon-only button needs an aria-label naming the action and the player');
  assert.match(btn, /title=\{`Undo import/,
    'and a title tooltip for mouse users');
});

test('the player NAME is guaranteed space in the row', () => {
  /* `.gm-player-pack-name` had `min-width: 0` and the default `flex-shrink: 1`,
     i.e. it was the ONLY shrinkable item in the row, so it collapsed to nothing
     once the undo button was added. It now has `flex: 1 1 auto` plus a real
     min-width floor, and still ellipsises a long name. */
  const name = ruleFor(css, '.gm-player-pack-name');
  assert.match(name, /flex\s*:\s*1\s+1\s+auto/,
    'the name must grow to fill the row and shrink only gently');
  assert.ok(!/min-width\s*:\s*0\s*;/.test(name),
    'min-width:0 would let the name collapse to zero width again');
  assert.match(name, /min-width\s*:\s*[\d.]+rem/,
    'the name needs a non-zero min-width floor');
  assert.match(name, /text-overflow\s*:\s*ellipsis/,
    'a long name must ellipsise rather than overflow the row');
});

test('the undo button is a fixed compact square', () => {
  const undo = ruleFor(css, '.gm-player-pack-undo');
  assert.match(undo, /width\s*:\s*\d+px/);
  assert.match(undo, /height\s*:\s*\d+px/);
  assert.match(undo, /padding\s*:\s*0/,
    'no horizontal padding — the declared width must be the whole footprint');
  assert.match(undo, /flex-shrink\s*:\s*0/,
    'it must keep its size rather than being squeezed');
});

test('the player list is exactly TWO columns, so rows never overlap', () => {
  /* `auto-fill minmax(200px,1fr)` fitted THREE ~230px columns inside the old
     720px modal — narrower than one row needs, so the Import and ↩ buttons
     collided with the name. Two fixed columns + a wider modal gives each row
     consistent room. */
  /* Strip /* … *\/ comments first: the rule body is quoted verbatim, so the
     explanatory comment above would otherwise satisfy a naive /auto-fill/ test. */
  const list = ruleFor(css, '.gm-pgn-list').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(list, /grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    'the player list must be exactly two columns');
  assert.ok(!/auto-fill/.test(list),
    'auto-fill is what produced the uneven 3-column overlap');
});

test('the player modal is wide enough for two columns', () => {
  const modal = ruleFor(css, '.gm-pgn-modal');
  const m = modal.match(/min\((\d+)px/);
  assert.ok(m, 'the modal width must be a min() px/vw clamp');
  assert.ok(Number(m[1]) >= 900,
    `the modal must be at least 900px to fit two full rows (got ${m[1]}px)`);
});

test('removing asks for confirmation and closes a now-deleted open game', () => {
  const fn = page.slice(idx(page, 'const runPlayerRemove'));
  assert.match(fn, /window\.confirm/,
    'a destructive bulk delete must be confirmed');
  assert.match(fn, /setSelected\(/,
    'the viewer must close if the open game was just deleted');
  assert.match(fn, /refresh\(\)/,
    'the list must be refreshed after removal');
});
