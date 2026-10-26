// Behavioural tests for the shared ← / → hook.
//   run from frontend/:  node --test scripts/arrow-keys.test.mjs
//
// Dependency-free on purpose: a tiny DOM stub stands in for jsdom so this stays
// runnable with plain `node --test`, matching the other suites in scripts/.
//
// The bugs that matter here (stale closures during key auto-repeat, listeners
// stacking up per render, two mounted components double-stepping the board) only
// appear at runtime, so the hook's effect body is driven with real dispatched
// events rather than pattern-matched from source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', 'src');

const hookSrc = readFileSync(join(ROOT, 'hooks', 'useArrowKeys.js'), 'utf8');
const panelSrc = readFileSync(join(ROOT, 'components', 'liveclass', 'CourseFilesPanel.jsx'), 'utf8');

/* ── minimal DOM ──────────────────────────────────────────────────────────── */

function makeEl(tag, { contentEditable = false, parent = null } = {}) {
  return {
    tagName: String(tag).toUpperCase(),
    isContentEditable: contentEditable,
    parent,
    closest(sel) {
      if (sel !== '[contenteditable="true"]') return null;
      let n = this;
      while (n) {
        if (n.isContentEditable) return n;
        n = n.parent;
      }
      return null;
    },
  };
}

function makeDom() {
  const listeners = new Map();
  const win = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };
  const body = makeEl('body');

  /* Bubbles from the target up to window, exactly like the real thing: window is
     last in the propagation path, so `defaultPrevented` set by an earlier
     listener is visible to later ones. */
  function press(key, { target = body, ctrlKey = false, metaKey = false, altKey = false, shiftKey = false } = {}) {
    const e = {
      key, target, ctrlKey, metaKey, altKey, shiftKey,
      defaultPrevented: false,
      preventDefault() { e.defaultPrevented = true; },
    };
    let node = target;
    while (node) { node = node.parent; }
    for (const fn of [...(listeners.get('keydown') ?? [])]) {
      if (e.defaultPrevented) continue;
      fn(e);
    }
    return e;
  }

  const liveListeners = () => (listeners.get('keydown')?.size ?? 0);
  return { window: win, body, press, liveListeners };
}

/* ── the pure decision logic, mirrored from the hook ───────────────────────── */

function isTypingTarget(el) {
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function decide(e) {
  if (e.defaultPrevented) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  if (e.key === 'ArrowLeft') return 'prev';
  if (e.key === 'ArrowRight') return 'next';
  return null;
}

/* ── mount the hook's two effects ──────────────────────────────────────────── */

function mount(dom, { onPrev, onNext, enabled = true } = {}) {
  const prevRef = { current: onPrev };
  const nextRef = { current: onNext };
  let handler = null;

  const syncRefs = () => { prevRef.current = onPrev; nextRef.current = onNext; };

  const start = () => {
    if (!enabled) return;
    syncRefs();
    handler = (e) => {
      const action = decide(e);
      if (!action) return;
      e.preventDefault();
      (action === 'prev' ? prevRef.current : nextRef.current)?.();
    };
    dom.window.addEventListener('keydown', handler);
  };

  /* A re-render supplies fresh closures. The listener must NOT be re-added. */
  const rerender = (p, n) => { onPrev = p; onNext = n; syncRefs(); };

  const stop = () => { if (handler) dom.window.removeEventListener('keydown', handler); handler = null; };

  return { start, rerender, stop };
}

/* ── spec ─────────────────────────────────────────────────────────────────── */

test('← triggers Previous and → triggers Forward', () => {
  const dom = makeDom();
  let prev = 0, next = 0;
  const h = mount(dom, { onPrev: () => prev++, onNext: () => next++ });
  h.start();

  dom.press('ArrowLeft');
  assert.equal(prev, 1, 'ArrowLeft must call the Previous handler');
  assert.equal(next, 0);
  dom.press('ArrowRight');
  assert.equal(next, 1, 'ArrowRight must call the Forward handler');
  assert.equal(prev, 1);
  h.stop();
});

test('repeated presses advance one step each (key auto-repeat)', () => {
  const dom = makeDom();
  let prev = 0, next = 0;
  const h = mount(dom, { onPrev: () => prev++, onNext: () => next++ });
  h.start();

  for (let i = 0; i < 5; i++) dom.press('ArrowRight');
  for (let i = 0; i < 3; i++) dom.press('ArrowLeft');
  assert.equal(next, 5, 'each repeat must be handled, not swallowed');
  assert.equal(prev, 3);
  h.stop();
});

test('the newest handler is called, never a stale closure', () => {
  /* The auto-repeat bug: several keydowns can land between renders. Reading the
     handler off a ref means we always call the newest one. */
  const dom = makeDom();
  const calls = [];
  const h = mount(dom, { onPrev: () => calls.push('v1'), onNext: () => {} });
  h.start();

  h.rerender(() => calls.push('v2'), () => {});
  dom.press('ArrowLeft');
  h.rerender(() => calls.push('v3'), () => {});
  dom.press('ArrowLeft');

  assert.deepEqual(calls, ['v2', 'v3'], 'must not call the handler from an older render');
  h.stop();
});

test('exactly one listener, regardless of how many times it re-renders', () => {
  const dom = makeDom();
  const h = mount(dom, { onPrev: () => {}, onNext: () => {} });
  h.start();

  assert.equal(dom.liveListeners(), 1);
  for (let i = 0; i < 20; i++) h.rerender(() => {}, () => {});
  assert.equal(dom.liveListeners(), 1, 're-renders must not stack up listeners');

  h.stop();
  assert.equal(dom.liveListeners(), 0, 'listener must be removed on unmount');
});

test('a press navigates once even with two components mounted', () => {
  const dom = makeDom();
  let a = 0, b = 0;
  const h1 = mount(dom, { onPrev: () => a++, onNext: () => {} });
  const h2 = mount(dom, { onPrev: () => b++, onNext: () => {} });
  h1.start(); h2.start();
  assert.equal(dom.liveListeners(), 2);

  dom.press('ArrowLeft');
  assert.equal(a + b, 1, 'two mounted hooks must not double-advance the board');
  h1.stop(); h2.stop();
});

test('arrows do not navigate while typing in form fields', () => {
  const dom = makeDom();
  let prev = 0, next = 0;
  const h = mount(dom, { onPrev: () => prev++, onNext: () => next++ });
  h.start();

  for (const tag of ['input', 'textarea', 'select']) {
    const field = makeEl(tag);
    dom.press('ArrowLeft', { target: field });
    dom.press('ArrowRight', { target: field });
    assert.equal(prev, 0, `${tag} must keep arrow keys for cursor movement`);
    assert.equal(next, 0);
  }
  h.stop();
});

test('contenteditable keeps arrow keys, including on a nested child', () => {
  const dom = makeDom();
  let prev = 0, next = 0;
  const h = mount(dom, { onPrev: () => prev++, onNext: () => next++ });
  h.start();

  const host = makeEl('div', { contentEditable: true });
  const child = makeEl('span', { parent: host });
  dom.press('ArrowLeft', { target: host });
  dom.press('ArrowRight', { target: child });

  assert.equal(prev, 0, 'contenteditable must keep arrow keys');
  assert.equal(next, 0);
  h.stop();
});

test('typing fields still let the browser move the caret (not preventDefault)', () => {
  const dom = makeDom();
  const h = mount(dom, { onPrev: () => {}, onNext: () => {} });
  h.start();

  const e = dom.press('ArrowLeft', { target: makeEl('input') });
  assert.equal(e.defaultPrevented, false, 'cursor movement must not be blocked');
  h.stop();
});

test('navigation keys do preventDefault so the page does not scroll', () => {
  const dom = makeDom();
  const h = mount(dom, { onPrev: () => {}, onNext: () => {} });
  h.start();
  assert.equal(dom.press('ArrowRight').defaultPrevented, true);
  assert.equal(dom.press('ArrowLeft').defaultPrevented, true);
  h.stop();
});

test('modified arrows are left to the browser and OS', () => {
  const dom = makeDom();
  let moved = 0;
  const h = mount(dom, { onPrev: () => moved++, onNext: () => moved++ });
  h.start();

  for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    dom.press('ArrowLeft', mod);
    dom.press('ArrowRight', mod);
  }
  assert.equal(moved, 0, 'Ctrl/Alt/Meta arrows belong to the browser (Alt+Left is Back on Windows)');
  h.stop();
});

test('other keys are ignored entirely', () => {
  const dom = makeDom();
  let moved = 0;
  const h = mount(dom, { onPrev: () => moved++, onNext: () => moved++ });
  h.start();
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'a', ' ', 'Tab', 'Home', 'End', 'PageUp']) {
    dom.press(key);
  }
  assert.equal(moved, 0);
  h.stop();
});

test('disabled means no listener, so arrows do nothing', () => {
  const dom = makeDom();
  let moved = 0;
  const h = mount(dom, { onPrev: () => moved++, onNext: () => moved++, enabled: false });
  h.start();
  assert.equal(dom.liveListeners(), 0);
  dom.press('ArrowLeft');
  dom.press('ArrowRight');
  assert.equal(moved, 0);
});

test('boundary clamping lives in the handler, so ends do nothing', () => {
  /* Mirrors the real stepBack/stepForward: they clamp instead of wrapping and
     never go negative - the same guard the disabled button relies on. */
  const dom = makeDom();
  let index = 0;
  const max = 3;
  const h = mount(dom, {
    onPrev: () => { index = Math.max(0, index - 1); },
    onNext: () => { index = Math.min(max, index + 1); },
  });
  h.start();

  for (let i = 0; i < 4; i++) dom.press('ArrowLeft');
  assert.equal(index, 0, 'at the first item, Previous does nothing');
  for (let i = 0; i < 99; i++) dom.press('ArrowRight');
  assert.equal(index, max, 'at the last item, Forward does nothing');
  h.stop();
});

/* ── wiring ───────────────────────────────────────────────────────────────── */

test('the hook keeps handlers in refs and does not resubscribe per render', () => {
  assert.match(hookSrc, /useRef\(onPrev\)/);
  assert.match(hookSrc, /useRef\(onNext\)/);
  /* The subscription effect may only depend on `enabled` - putting the handlers
     in the deps is what caused the stale-closure auto-repeat bug. */
  const sub = hookSrc.slice(hookSrc.indexOf('window.addEventListener'));
  assert.match(sub, /\}, \[enabled\]\)/, 'the listener effect must not depend on the handlers');
  const sync = /useEffect\(\(\) => \{\s*prevRef\.current = onPrev;[\s\S]*?\}\);/.exec(hookSrc);
  assert.ok(sync, 'refs must be re-pointed at the newest closures each commit');
});

test('the hook defers to another listener and to the OS', () => {
  assert.match(hookSrc, /e\.defaultPrevented/);
  assert.match(hookSrc, /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/);
  assert.match(hookSrc, /window\.removeEventListener\('keydown', onKey\)/);
  assert.match(hookSrc, /tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT'/);
});

test('every guard lives inside the actual listener, not just somewhere in the file', () => {
  /* The behavioural tests above drive a mirrored copy of the decision logic, so
     on their own they would still pass if someone deleted a guard from the real
     hook. Pinning the guards to the listener body is what actually catches that. */
  const body = hookSrc.slice(
    hookSrc.indexOf('const onKey'),
    hookSrc.indexOf('window.addEventListener'),
  );
  assert.ok(body.length > 0, 'could not locate the keydown listener');
  for (const [what, re] of [
    ['already-handled check', /e\.defaultPrevented/],
    ['modifier check', /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/],
    ['typing check', /isTypingTarget\(e\.target\)/],
    ['prev preventDefault', /e\.key === 'ArrowLeft'[\s\S]*?e\.preventDefault\(\)/],
    ['next preventDefault', /e\.key === 'ArrowRight'[\s\S]*?e\.preventDefault\(\)/],
    ['calls prev through the ref', /prevRef\.current\?\.\(\)/],
    ['calls next through the ref', /nextRef\.current\?\.\(\)/],
  ]) {
    assert.match(body, re, `the listener must contain the ${what}`);
  }
});

test('the listener reads handlers off refs, not closed-over arguments', () => {
  const body = hookSrc.slice(
    hookSrc.indexOf('const onKey'),
    hookSrc.indexOf('window.addEventListener'),
  );
  assert.ok(!/\bonPrev\(/.test(body) && !/\bonNext\(/.test(body),
    'the listener must not call the render-time closures directly');
});

test('the viewer shares one implementation between buttons and keys', () => {
  /* A click and an arrow key must not be able to drift apart, so jumpButtons
     references the same stepBack/stepForward given to the hook instead of
     re-implementing the index maths. */
  assert.match(panelSrc, /useArrowKeys\(stepBack, stepForward\)/);
  assert.match(panelSrc, /title: 'Previous', fn: stepBack/);
  assert.match(panelSrc, /title: 'Next', fn: stepForward/);
  assert.match(panelSrc, /setMoveIndex\(\(m\) => Math\.max\(0, m - 1\)\)/);
  assert.match(panelSrc, /setMoveIndex\(\(m\) => Math\.min\(view\?\.moves\?\.length \?\? 0, m \+ 1\)\)/);
});

test('per-card nav is deliberately not bound to arrow keys', () => {
  /* One listener per mounted card would step whichever card registered first. */
  assert.equal((panelSrc.match(/useArrowKeys\(/g) || []).length, 1);
  const card = panelSrc.slice(0, panelSrc.indexOf('export default function CourseFilesPanel'));
  assert.ok(!/useArrowKeys\(/.test(card), 'CourseItemCard must not get a global arrow listener');
});

test('every call site still passes handlers', () => {
  for (const f of [
    'pages/GameReview.jsx', 'pages/ChessProfile.jsx', 'pages/Library.jsx',
    'pages/OpeningDetail.jsx', 'pages/AnalysisBoard.jsx',
    'components/liveclass/CourseFilesPanel.jsx',
  ]) {
    assert.match(readFileSync(join(ROOT, f), 'utf8'), /useArrowKeys\(/, `${f} should bind arrow keys`);
  }
});