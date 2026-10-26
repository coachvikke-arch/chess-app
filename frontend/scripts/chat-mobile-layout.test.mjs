// Tests for the CHAT SCREEN's mobile layout
// (frontend/src/pages/MessagesPage.jsx, src/index.css, index.html) -
//   run with: node --test scripts/chat-mobile-layout.test.mjs   (from frontend/)
//
// Why source assertions: the bug was geometric - on a phone the card had no
// height (only `md:h-[600px]`), so `flex-1` on the message list resolved against
// an auto-height parent, the list grew to its content, and the composer was
// pushed off the bottom of the page. What must never regress is the SHAPE of the
// fix: which box is measured against the visual viewport, which children are
// allowed to shrink, and which padding keeps the composer clear of the home
// indicator. Reproducing the layout itself needs a browser (see the manual
// check); the wiring is what is pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');

const pageSrc = readFileSync(join(FRONTEND, 'src', 'pages', 'MessagesPage.jsx'), 'utf8');
const css = readFileSync(join(FRONTEND, 'src', 'index.css'), 'utf8');
const html = readFileSync(join(FRONTEND, 'index.html'), 'utf8');

test('the viewport meta asks the phone to shrink to the keyboard', () => {
  assert.match(html,
    /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"/,
    'viewport-fit=cover makes env(safe-area-inset-bottom) resolve on notched phones, and interactive-widget=resizes-content resizes the layout viewport on Android Chrome');
});

test('the chat column is a flex column with a real height on phones', () => {
  assert.match(css, /\.chat-screen\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/,
    '.chat-screen must be a flex column so the card takes the leftover height');
  const mobile = css.match(/@media \(max-width: 768px\)\s*\{\s*\.chat-screen\s*\{[^}]*\}/);
  assert.ok(mobile, 'the phone height rule must live behind the 768px breakpoint');
  assert.match(mobile[0], /height:\s*100dvh;/,
    '100dvh must be the value that wins, or the composer hides behind a collapsing URL bar');
  assert.match(css, /\.chat-card\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/,
    'the card needs flex:1 plus min-height:0 or it refuses to shrink and pushes the composer out of the card');
  assert.match(pageSrc, /className="chat-screen w-full"/,
    'the page must use the full content width');
  assert.doesNotMatch(pageSrc, /max-w-4xl/,
    'the old narrow container limit must stay removed');
});

test('the column height comes from the visual viewport, not the layout one', () => {
  assert.match(pageSrc, /const bottom = vv \? vv\.offsetTop \+ vv\.height : window\.innerHeight;/,
    'iOS leaves the layout viewport alone when the keyboard opens - only visualViewport.height shrinks');
  assert.match(pageSrc, /window\.visualViewport/,
    'the page must read visualViewport at all, or iOS in-app webviews are unsupportable');
  assert.doesNotMatch(pageSrc, /isPhone\(\)/,
    'the fitted height is not phone-only: tablets and desktop must fill the shell without a page scroll');
  assert.match(pageSrc, /style=\{screenH \? \{ height: `\$\{screenH\}px` \} : undefined\}/,
    'the measured height must reach the DOM as an inline style');
  assert.match(pageSrc, /requestFullHeight\(true\)/,
    'Messages must claim the full-height shell content area, with no shell padding or Back row above it');
});

test('space the document would otherwise scroll is reserved, not counted twice', () => {
  assert.match(pageSrc, /getComputedStyle\(sib\)\.position !== 'fixed'/,
    'the toast rail is position:fixed - adding its height shrank the chat column by ~300px on phones');
  assert.match(pageSrc, /Number\.isFinite\(next\) && next >= 320/,
    'a nonsense or collapsed measurement must be ignored rather than rendered');
});

test('the soft keyboard re-fits the column and keeps the newest message visible', () => {
  assert.match(pageSrc, /const onViewport = \(\) => \{[\s\S]{0,300}?sync\(\);[\s\S]{0,300}?list\.scrollTop = list\.scrollHeight;/,
    'the visual-viewport resize handler must re-fit AND pin the list to the newest message');
  assert.match(pageSrc, /vv\?\.addEventListener\('resize', onViewport\);/,
    'the resize must be observed on the visual viewport');
});

test('the thread is the only scrolling container', () => {
  assert.match(css, /\.chat-list\s*\{[^}]*min-height:\s*0;[^}]*overscroll-behavior:\s*contain;[^}]*\}/,
    '.chat-list needs min-height:0 (flex children default to min-height:auto) plus overscroll containment so a flick does not scroll the page behind');
  assert.match(css, /\.chat-scroll\s*\{[^}]*-webkit-overflow-scrolling:\s*touch;/,
    'iOS momentum scrolling needs the -webkit- property on every chat scroller');
  assert.match(pageSrc, /className="chat-list flex-1 min-h-0 overflow-y-auto/,
    'both message lists must carry .chat-list and be the only shrinkable scroller');
  assert.match(pageSrc, /chat-composer shrink-0 px-3/,
    'the composer must be flex-shrink-0, or the list takes its space and the send row leaves the screen');
  assert.match(css, /\.chat-scroll-thin\s*\{[^}]*scrollbar-width:\s*thin;/,
    'the inbox and thread need a thin, visible scrollbar so the scroll affordance is clear');
});

test('the composer clears the home indicator and iOS cannot zoom on focus', () => {
  assert.match(css, /\.chat-composer\s*\{[^}]*padding-bottom:\s*calc\(8px \+ env\(safe-area-inset-bottom\)\);/,
    'the send row needs the safe-area inset or the home indicator sits on top of it');
  assert.match(css, /\.chat-screen input:not\(\[type="checkbox"\]\):not\(\[type="file"\]\),\s*\n\.chat-screen textarea\s*\{\s*font-size:\s*16px;/,
    'inputs under 16px make iOS Safari zoom the page on focus');
});

test('a phone shows one pane at a time so the composer gets the whole screen', () => {
  assert.match(pageSrc, /const threadOpen = groupOpen \|\| dmOpen \|\| requestTarget != null;/,
    'the rail/thread swap needs a single definition of "a conversation is open" - including the request prompt, or a blocked-row tap renders into a hidden pane and looks dead');
  assert.match(pageSrc, /threadOpen \? 'hidden min-\[769px\]:flex' : 'flex'/,
    'with a thread open the inbox rail must yield on phones but stay visible from 769px');
  assert.match(pageSrc, /threadOpen \? 'flex' : 'hidden min-\[769px\]:flex'/,
    'with no thread open the desktop thread pane must still render its empty state');
  assert.match(css, /\.chat-rail\s*\{[^}]*width:\s*32%;/,
    'the two-panel layout must give the conversation list about a third of the width');
});

test('a new message still pulls the thread to the bottom', () => {
  assert.match(pageSrc,
    /const pin = \(\) => \{ el\.scrollTop = el\.scrollHeight; \};\s*\n\s*pin\(\);[\s\S]{0,400}?\}, \[messages, groupMessages, threadFor, activeGroupId\]\)/,
    'the auto-scroll effect must survive the layout change - it is what keeps an opened thread at the newest message');
  assert.match(pageSrc, /const frame = requestAnimationFrame\(pin\);[\s\S]{0,200}?clearTimeout\(settle\)/,
    'it must re-pin after layout settles: the column is re-fitted AFTER the messages render, so a single assignment scrolls against the old height and strands the newest message below the fold');
});