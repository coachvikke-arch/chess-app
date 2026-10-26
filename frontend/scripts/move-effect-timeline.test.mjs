/* MoveEffect timeline — pure maths, no browser.
 *
 * Run: node --test scripts/move-effect-timeline.test.mjs
 *
 * The overlay is one clock (t = ms from dim start) feeding a handful of pure
 * functions. Those functions are what actually decide whether the piece is in
 * flight, where the ripple front is, and when a piece wobbles, so they are
 * tested here directly instead of through a DOM. Every assertion is a property
 * of the reference choreography, not a snapshot of an implementation detail.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { T, RIPPLE, WOBBLE, G, MOVE_EFFECTS, effectConfig } from '../src/effects/moveEffect/config.js';
import {
  clamp, lerp, invLerp, easeInOutCubic, easeOutBack,
  rippleRadiusSq, ripplePassSeconds, squareDistance, rippleOpacity,
  wobbleAt, flightAt, morphScale, badgeScale, pillWidthFactor,
  pillLabelOpacity, swordScale, swordArrowScale, pathSquares,
  squarePoint, sideOf,
} from '../src/effects/moveEffect/timeline.js';

const EPS = 1e-9;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('master timeline is strictly ordered and internally consistent', () => {
  assert.equal(T.dimStart, 0);
  assert.ok(T.dimEnd > T.dimStart);
  assert.ok(T.flyStart >= T.dimStart && T.flyStart < T.dimEnd, 'flight starts while dimming');
  assert.ok(T.flyEnd > T.flyStart);
  assert.ok(T.hoverEnd > T.flyEnd);
  assert.ok(T.dropEnd === T.landing, 'landing is the end of the drop');
  assert.ok(T.captureGone < T.landing, 'captured piece goes before the landing');
  assert.ok(T.landing + T.badgePopMs <= T.pillGrowEnd, 'the seal finishes as the pill grows');
  assert.ok(T.pillGrowEnd < T.labelFadeStart);
  assert.ok(T.labelFadeStart < T.labelFadeEnd);
  assert.ok(T.pillCollapseStart >= T.labelFadeEnd, 'collapse follows the label fade');
  assert.ok(T.pillCollapseEnd < T.swordStart, 'pill is gone before the sword');
  assert.ok(T.swordStart < T.swordArrowStart, 'the sword pops, then the arrow grows from it');
  assert.ok(T.swordStart + T.swordMs < T.end, 'the sword finishes before the effect ends');
  assert.ok(T.swordArrowEnd < T.end, 'the arrow finishes before the effect ends');
  assert.ok(T.settle > T.landing && T.settle < T.pillCollapseStart, 'board is released mid-pill');
  assert.ok(T.end > T.settle);
});

test('config exposes the retunable engine constants', () => {
  for (const key of ['maxSq', 'k', 'fadeFromSq', 'fadeToSq', 'flashMs']) {
    assert.ok(RIPPLE[key] > 0, `RIPPLE.${key}`);
  }
  assert.ok(RIPPLE.fadeFromSq < RIPPLE.fadeToSq);
  assert.ok(RIPPLE.maxSq > RIPPLE.fadeToSq);
  for (const key of ['deg', 'decay', 'freq', 'scale']) assert.ok(WOBBLE[key] > 0, `WOBBLE.${key}`);
  assert.ok(WOBBLE.kingMultiplier > 1);
  for (const key of ['badgeSq', 'pillWidthSq', 'pillHeightSq', 'swordSq', 'arrowSq']) {
    assert.ok(G[key] > 0, `G.${key}`);
  }
});

test('easing helpers clamp and hit their endpoints', () => {
  close(clamp(5, 0, 1), 1);
  close(clamp(-5, 0, 1), 0);
  close(invLerp(0, 100, 50), 0.5);
  close(invLerp(0, 100, 200), 1);
  close(lerp(10, 20, 0.25), 12.5);
  close(easeInOutCubic(0), 0);
  close(easeInOutCubic(0.5), 0.5);
  close(easeInOutCubic(1), 1);
  close(easeOutBack(0), 0);
  close(easeOutBack(1), 1);
  assert.ok(easeOutBack(0.7) > 1, 'easeOutBack overshoots');
});

test('ripple radius is monotonic, bounded and invertible', () => {
  assert.equal(rippleRadiusSq(0), 0);
  assert.equal(rippleRadiusSq(-1), 0);
  let prev = 0;
  for (let s = 0.05; s <= 3; s += 0.05) {
    const r = rippleRadiusSq(s);
    assert.ok(r > prev, 'radius grows');
    assert.ok(r < RIPPLE.maxSq, 'radius never reaches maxSq');
    prev = r;
  }
  for (const d of [0, 0.5, 2, 6, 9, 10]) {
    const s = ripplePassSeconds(d);
    assert.ok(Number.isFinite(s));
    close(rippleRadiusSq(s), d, 1e-9);
  }
  assert.equal(ripplePassSeconds(RIPPLE.maxSq), Infinity);
  assert.equal(ripplePassSeconds(RIPPLE.maxSq + 1), Infinity);
});

test('ripple visual fades out between 6 and 9 squares', () => {
  close(rippleOpacity(0), 1, EPS);
  close(rippleOpacity(6), 1, EPS);
  close(rippleOpacity(7.5), 0.5, 1e-9);
  close(rippleOpacity(9), 0, EPS);
  close(rippleOpacity(12), 0, EPS);
});

test('square distances and side-of-origin', () => {
  close(squareDistance('e4', 'e4'), 0);
  close(squareDistance('e4', 'd5'), Math.SQRT2);
  close(squareDistance('a1', 'h8'), Math.hypot(7, 7));
  assert.equal(squareDistance(null, 'e4'), Infinity);
  assert.equal(sideOf('h4', 'd4'), 1);
  assert.equal(sideOf('a4', 'd4'), -1);
  assert.equal(sideOf('d4', 'd4'), 1);
});

test('squarePoint mirrors the board for black', () => {
  assert.deepEqual(squarePoint('a1', 'white'), { x: 0.5, y: 7.5 });
  assert.deepEqual(squarePoint('h8', 'white'), { x: 7.5, y: 0.5 });
  assert.deepEqual(squarePoint('a1', 'black'), { x: 7.5, y: 0.5 });
  assert.deepEqual(squarePoint('h1', 'black'), { x: 0.5, y: 0.5 });
  assert.equal(squarePoint('', 'white'), null);
  assert.equal(squarePoint('j9', 'white'), null);
});

test('flight: idle → hover → drop → landed', () => {
  const from = { x: 0.5, y: 7.5 }; // a1
  const to = { x: 4.5, y: 3.5 };   // e5

  const idle = flightAt(0, from, to, 1);
  assert.deepEqual({ x: idle.x, y: idle.y }, from);
  assert.equal(idle.phase, 'idle');

  const hover = flightAt(T.flyEnd, from, to, 1);
  close(hover.x, to.x - G.hoverSideSq);
  close(hover.y, to.y - G.hoverLiftSq);
  close(hover.scale, G.flyScale);
  assert.equal(hover.phase, 'hover');

  const drop = flightAt(T.hoverEnd, from, to, -1);
  close(drop.x, to.x + G.hoverSideSq, 1e-9);
  close(drop.y, to.y - G.hoverLiftSq);
  assert.equal(drop.phase, 'drop');

  const landed = flightAt(T.landing, from, to, 1);
  assert.deepEqual({ x: landed.x, y: landed.y }, to);
  close(landed.scale, 1);
  assert.equal(landed.phase, 'landed');
});

test('flight is continuous through both phase boundaries', () => {
  const from = { x: 3.5, y: 3.5 };
  const to = { x: 6.5, y: 1.5 };
  for (const boundary of [T.flyEnd, T.hoverEnd, T.landing]) {
    const a = flightAt(boundary - 0.5, from, to, 1);
    const b = flightAt(boundary + 0.5, from, to, 1);
    assert.ok(Math.abs(a.x - b.x) < 0.05, `x jumps at ${boundary}`);
    assert.ok(Math.abs(a.y - b.y) < 0.05, `y jumps at ${boundary}`);
    assert.ok(Math.abs(a.scale - b.scale) < 0.05, `scale jumps at ${boundary}`);
  }
});

test('wobble starts at zero, oscillates, decays and can be stronger', () => {
  assert.deepEqual(wobbleAt(-1, 1), { rotate: 0, scale: 1 });
  const at0 = wobbleAt(0, 1);
  close(at0.rotate, 0);
  close(at0.scale, 1 + WOBBLE.scale);

  const early = wobbleAt(0.03, 1);
  assert.ok(Math.abs(early.rotate) > 0, 'it rotates');
  const late = wobbleAt(0.3, 1);
  assert.ok(Math.abs(late.rotate) < Math.abs(early.rotate), 'it decays');
  assert.ok(Math.abs(late.scale - 1) < Math.abs(early.scale - 1));

  const mirrored = wobbleAt(0.05, -1);
  close(mirrored.rotate, -wobbleAt(0.05, 1).rotate, 1e-9);

  const strong = wobbleAt(0.05, 1, { strong: true });
  assert.ok(Math.abs(strong.rotate) > Math.abs(wobbleAt(0.05, 1).rotate), 'king wobbles harder');
});

test('badge, morph, pill and sword envelopes', () => {
  close(badgeScale(T.landing), 0, 1e-12);
  close(badgeScale(T.landing + T.badgePopMs), 1, 1e-6);
  close(badgeScale(T.end), 1, 1e-6);

  close(morphScale(T.landing), 1.3, 1e-9);
  close(morphScale(T.landing + 220), 1, 1e-9);

  close(pillWidthFactor(T.pillGrowStart - 1), 0, 1e-12);
  close(pillWidthFactor(T.pillGrowEnd), 1, 1e-9);
  close(pillWidthFactor(T.pillCollapseStart), 1, 1e-9);
  close(pillWidthFactor(T.pillCollapseEnd), 0, 1e-9);

  close(pillLabelOpacity(T.pillGrowStart), 0, 1e-12);
  close(pillLabelOpacity(T.pillGrowEnd), 1, 1e-9);
  close(pillLabelOpacity(T.labelFadeStart), 1, 1e-9);
  close(pillLabelOpacity(T.labelFadeEnd), 0, 1e-9);

  close(swordScale(T.swordStart), 0, 1e-12);
  close(swordScale(T.swordStart + T.swordMs), 1, 1e-6);
  close(swordArrowScale(T.swordArrowStart), 0, 1e-9);
  close(swordArrowScale(T.swordArrowEnd), 1, 1e-6);
});

test('path squares: straight line for sliders and pawns, L for a knight', () => {
  assert.deepEqual(pathSquares('e2', 'e4', 'p'), ['e2', 'e3', 'e4']);
  assert.deepEqual(pathSquares('a1', 'd4', 'b'), ['a1', 'b2', 'c3', 'd4']);
  assert.deepEqual(pathSquares('h1', 'a1', 'r').length, 8);
  assert.deepEqual(pathSquares('b1', 'c3', 'n'), ['b1', 'c1', 'c2', 'c3']);
  assert.deepEqual(pathSquares('g1', 'f3', 'n'), ['g1', 'f1', 'f2', 'f3']);
  assert.deepEqual(pathSquares('e4', 'e4', 'q'), ['e4']);
  assert.deepEqual(pathSquares(null, 'e4', 'q'), []);
  assert.deepEqual(pathSquares('e4', 'e4', 'q', 'h8'), ['e4']);
});

test('per-event configs are complete and resolve by type', () => {
  for (const type of ['brilliant', 'checkmate', 'promotion']) {
    const cfg = effectConfig(type);
    assert.equal(cfg.type, type);
    for (const key of ['accent', 'accentDeep', 'seal', 'badge', 'label', 'highlightTo', 'highlightFrom']) {
      assert.ok(cfg[key], `${type}.${key}`);
    }
    assert.ok(['to', 'king'].includes(cfg.rippleOrigin));
  }
  assert.equal(effectConfig('checkmate').rippleOrigin, 'king');
  assert.equal(effectConfig('promotion').morph, true);
  assert.equal(MOVE_EFFECTS.brilliant.sacrificeBadge, true);
  assert.equal(MOVE_EFFECTS.checkmate.sacrificeBadge, false);
  /* unknown verdicts must still render something sensible */
  assert.equal(effectConfig('nonsense').type, 'brilliant');
  assert.equal(effectConfig(undefined).type, 'brilliant');
});
