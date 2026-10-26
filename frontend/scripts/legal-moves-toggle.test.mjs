/* App-wide "Show Legal Moves" preference.
 *
 * Run: node --test scripts/legal-moves-toggle.test.mjs
 *
 * The Settings switch is a master gate on the visual hint only. ChessBoard ANDs
 * it with each board's own `showLegalMoves` prop so that, when off, BOTH hint
 * paths go quiet — the click-selected dots (legalTargets) and the in-flight drag
 * dots (getLegalTargets) — while selection, drag and move validation stay put.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SHOW_LEGAL_MOVES,
  getShowLegalMoves,
  setShowLegalMoves,
} from '../src/config/legalMoves.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

/* ------------------------------------------------------------------ *
 * The stored preference (default ON, explicit off)
 * ------------------------------------------------------------------ */

test('legal-move hints are ON by default', () => {
  assert.equal(DEFAULT_SHOW_LEGAL_MOVES, true);
  assert.equal(getShowLegalMoves(), true, 'no stored value falls back to on');
});

test('setShowLegalMoves toggles, and only an explicit false turns it off', () => {
  assert.equal(setShowLegalMoves(false), false);
  assert.equal(setShowLegalMoves(true), true);
  assert.equal(setShowLegalMoves(undefined), true, 'a missing value is treated as on');
  assert.equal(setShowLegalMoves(1), true);
});

test('the preference is device-local and fans out to listeners', () => {
  const src = read('src', 'config', 'legalMoves.js');
  assert.match(src, /knightpath-show-legal-moves/, 'own storage namespace');
  assert.match(src, /const listeners = new Set\(\)/, 'subscribers are tracked');
  assert.match(src, /export function useShowLegalMoves\(\)/, 'a reactive hook is exported');
});

/* ------------------------------------------------------------------ *
 * ChessBoard gates BOTH hint paths, and nothing else
 * ------------------------------------------------------------------ */

test('the board ANDs the global setting with its own prop', () => {
  const chess = read('src', 'components', 'ChessBoard.jsx');
  assert.match(chess, /import \{ useShowLegalMoves \} from '\.\.\/config\/legalMoves'/);
  assert.match(chess, /const showLegalMovesGlobal = useShowLegalMoves\(\);/);
  assert.match(chess, /const legalHintsOn = showLegalMovesGlobal && showLegalMoves;/);
});

test('selection hints follow the toggle', () => {
  const chess = read('src', 'components', 'ChessBoard.jsx');
  assert.match(
    chess,
    /legalTargets=\{legalHintsOn && !pendingPromo \? targets : undefined\}/,
    'the clicked-piece dots are gated by the setting',
  );
});

test('drag hints follow the same toggle', () => {
  const chess = read('src', 'components', 'ChessBoard.jsx');
  assert.match(
    chess,
    /getLegalTargets=\{interactive && legalHintsOn && !pendingPromo \?/,
    'the in-flight drag dots are gated by the setting',
  );
});

test('selection and move validation are left untouched', () => {
  const chess = read('src', 'components', 'ChessBoard.jsx');
  assert.match(
    chess,
    /if \(!interactive \|\| \(!showLegalMoves && !clickToMove\)\) return;/,
    'click-to-move still keys off the local prop, so a piece stays selectable',
  );
  assert.match(
    chess,
    /onPieceDrop=\{\(s, t\) => \(interactive && !setupMode \? doMove\(s, t\) : false\)\}/,
    'drag-to-move still routes through doMove (validation unchanged)',
  );
});

/* ------------------------------------------------------------------ *
 * The Settings row exists and is wired
 * ------------------------------------------------------------------ */

test('Settings offers a wired "Show Legal Moves" switch', () => {
  const settings = read('src', 'pages', 'Settings.jsx');
  assert.match(settings, /import \{ useShowLegalMoves, setShowLegalMoves \} from '\.\.\/config\/legalMoves'/);
  assert.match(settings, /const showLegalMoves = useShowLegalMoves\(\);/);
  assert.match(settings, /label="Show Legal Moves"/);
  assert.match(settings, /hint="Highlight possible moves when you select a piece"/);
  assert.match(settings, /checked=\{showLegalMoves\}/);
  assert.match(settings, /onChange=\{setShowLegalMoves\}/);
});
