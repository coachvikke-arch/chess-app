// Regression tests for the redesigned promotion picker (the "board popup") —
//   run with: node --test scripts/promotion-picker.test.mjs   (from frontend/)
//
// The picker was replaced wholesale: ChessBoard used to render an inline column
// of green buttons positioned with hand-rolled maths. It is now a reusable
// PromotionPicker component. These assert the new contract so the move logic
// (which stayed in ChessBoard) can never drift from the UI again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const picker = read('src', 'components', 'board', 'PromotionPicker.jsx');
const board = read('src', 'components', 'ChessBoard.jsx');
const css = read('src', 'index.css');
const settings = read('src', 'pages', 'Settings.jsx');
const autoQueen = read('src', 'config', 'autoQueen.js');

const rule = (sel) => {
  const i = css.indexOf(`${sel} {`);
  assert.notEqual(i, -1, `${sel} rule must exist`);
  return css.slice(i, css.indexOf('}', i));
};

test('PromotionPicker is a reusable component with the documented props', () => {
  for (const prop of ['color', 'square', 'orientation', 'boardWidth', 'inset', 'onSelect', 'onCancel']) {
    assert.match(picker, new RegExp(`\\b${prop}\\b`), `must accept the ${prop} prop`);
  }
  assert.match(picker, /export default function PromotionPicker/);
  assert.match(picker, /export const PROMO_PIECES/);
  for (const code of ["'q'", "'r'", "'b'", "'n'"]) {
    assert.ok(picker.includes(`code: ${code}`), `piece ${code} must be offered`);
  }
});

test('Queen sits on the promotion square and the stack flips on the bottom edge', () => {
  // display row mirrors with orientation, rank 8 → top for white
  assert.match(picker, /orientation === 'white' \? 8 - rank : rank - 1/);
  // bottom half of the displayed board stacks upward, keeping all 4 on board
  assert.match(picker, /const stackUp = row >= 4/);
  // the panel is clamped inside the board on both axes
  assert.match(picker, /clamp\(rawLeft, inset, inset \+ boardWidth - card\)/);
  assert.match(picker, /inset \+ boardWidth - panelH/);
  // cards are at least a 48px touch target
  assert.match(picker, /Math\.max\(Math\.round\(sq\), 48\)/);
});

test('picker is touch- and keyboard-accessible', () => {
  assert.match(picker, /aria-label="Choose promotion piece"/);
  assert.match(picker, /role="menuitem"/);
  assert.match(picker, /aria-label=\{`Promote to \$\{p\.name\}`\}/);
  assert.match(picker, /e\.key === 'Escape'/);
  assert.match(picker, /e\.key === 'Enter'/);
  assert.match(picker, /ArrowUp|ArrowDown/);
  assert.match(picker, /onClick=\{\(\) => choose\(p\.code\)\}/);
});

test('cancel and select route through the caller-supplied callbacks', () => {
  assert.match(picker, /function cancel\(\) \{ close\(onCancel\)/);
  assert.match(picker, /later\(\(\) => onSelect\?\.\(code\), PICK_MS\)/);
  assert.match(picker, /pp-scrim/);
});

test('ChessBoard renders the picker instead of an inline column', () => {
  assert.match(board, /import PromotionPicker from '\.\/board\/PromotionPicker'/);
  assert.match(board, /<PromotionPicker/);
  // the old inline picker and its ad-hoc geometry are gone
  assert.ok(!board.includes('pickerTop'), 'old pickerTop geometry must be removed');
  assert.ok(!board.includes('PROMO_PIECES'), 'piece list now lives in the picker');
  assert.ok(!/Promotion picker overlay/.test(board), 'old inline picker block must be removed');
  // the move logic is untouched: still applied through handlePromoPick
  assert.match(board, /onSelect=\{handlePromoPick\}/);
  assert.match(board, /onCancel=\{cancelPromo\}/);
});

test('auto-queen skips the picker but keeps the same move path', () => {
  assert.match(board, /const autoQueen = useAutoQueen\(\)/);
  const gated = board.match(/if \(autoQueen\) return applyMove\(source, target, 'q'\)/g) || [];
  assert.ok(gated.length >= 1, 'click/drop promotion must apply a Queen when auto-queen is on');
  assert.match(board, /if \(autoQueen\) return doMove\(source, target\)/);
  assert.match(autoQueen, /export function getAutoQueen/);
  assert.match(autoQueen, /export function setAutoQueen/);
  assert.match(autoQueen, /export function useAutoQueen/);
  assert.match(settings, /label="Auto-queen"/);
  assert.match(settings, /checked=\{autoQueen\}/);
});

test('stylesheet defines the glassy cards, motion and reduced-motion guard', () => {
  const scrim = rule('.pp-scrim');
  assert.match(scrim, /rgba\(6, 12, 16, 0\.55\)/, 'scrim must dim ~55%');
  const card = rule('.pp-card');
  assert.match(card, /backdrop-filter: blur/, 'cards must be glassy');
  assert.match(card, /border-radius/, 'cards must be rounded');
  assert.match(css, /\.pp-card:hover[\s\S]*?scale\(1\.1\)/, 'hover scales to 1.1');
  for (const kf of ['pp-in', 'pp-out', 'pp-card-in', 'pp-pick', 'pp-scrim-in', 'pp-scrim-out']) {
    assert.ok(css.includes(`@keyframes ${kf}`), `@keyframes ${kf} must exist`);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.pp-card[\s\S]*?animation: none/);
});
