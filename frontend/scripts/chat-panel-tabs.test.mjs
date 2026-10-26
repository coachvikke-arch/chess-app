import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Chat panel tabs.
 *
 * The panel is ~300px wide in the classroom, so everything in it competes for the
 * same column. These tests pin the tab wiring: what is reachable as a tab, what
 * is pinned permanently, and that a tab body can never be pushed out of the panel.
 */

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const panel = read('src/components/liveclass/ChatPanel.jsx');
const css = read('src/index.css');

/* The tab ids the panel will restore from localStorage. */
const allowed = [...new Set([...panel.matchAll(/t === '([a-z]+)'/g)].map(([, id]) => id))].sort();

/* The chat-mode gate. The block ends at the first fragment close inside it -
   none of the buttons it holds nest a fragment, so that is a safe boundary. */
const gateStart = panel.indexOf("{isInstructor && tab === 'chat' && (");
const gate = gateStart >= 0 ? panel.slice(gateStart, panel.indexOf('</div>', gateStart)) : '';

/* The tab bar: the chip row inside the panel heading. */
const modesStart = panel.indexOf('className="live-chat-modes"');
const modesEnd = panel.indexOf('</div>', modesStart);
const bar = panel.slice(modesStart, modesEnd);

/* The participants tab body, from its definition to the start of the returned
   tree. The end anchor is the panel root, not `return (` - line 80 of the
   component is `return () => offs.forEach(...)`, which matches that first. */
const bodyStart = panel.indexOf('participantsBody =');
const bodyEnd = panel.indexOf('live-chat-panel ${asMobilePanel');
const tabBody = panel.slice(bodyStart, bodyEnd);

test('every tab the panel can restore from storage is one it can actually render', () => {
  /* The tab id is persisted in localStorage and read back on mount. A value the
     renderer does not handle falls through to the chat body, so a typo shows the
     instructor a chat panel with an empty-looking tab - silently. */
  assert.deepEqual(
    allowed,
    ['assignments', 'files', 'leaderboard', 'moves', 'participants'],
    'the restored set and the rendered set are the same set'
  );

  for (const id of allowed) {
    /* The tab bodies are toggled with an inline style, not a JSX ternary. */
    const rendered =
      panel.includes(`tab === '${id}' ? 'block'`) ||
      panel.includes(`(tab === '${id}' && isInstructor) ? 'block'`);
    assert.ok(rendered, `tab '${id}' is accepted from storage but has no render branch`);
  }
  /* ...and 'chat' must stay the fallback rather than growing a render branch, or
     a stored id with no branch would fall through to an empty panel. */
  assert.doesNotMatch(panel, /tab === 'chat' \? \(/, 'chat is reached by falling through');
  assert.match(panel, /\? t : 'chat';/, 'and an unknown stored id still lands on the chat');
});

test('every tab has a chip, including the way back to the messages', () => {
  /* The panel turned into tabs, and the only route back to the messages was
     clicking whichever chip was already lit - which reads as a toggle, not as
     "show me the chat". */
  const chips = [...panel.matchAll(/onClick=\{\(\) => openTab\('([a-z]+)'\)\}/g)].map(([, id]) => id);
  assert.deepEqual(
    [...new Set(chips)].sort(),
    ['assignments', 'chat', 'files', 'leaderboard', 'moves', 'participants'],
    'one chip per tab'
  );
  /* Chips only reach tabs that exist. A chip pointing at a removed tab would
     leave the panel stuck on an empty body. */
  for (const id of new Set(chips)) {
    assert.ok(allowed.includes(id) || id === 'chat', `the '${id}' chip points at a real tab`);
  }
  assert.match(panel, /\$\{tab === 'chat' \? 'live-chip-on' : ''\}/,
    'and the chat chip shows as active while the messages are up');
  /* Chat is the default view, so its chip leads. */
  assert.ok(
    panel.indexOf("openTab('chat')") < panel.indexOf("openTab('moves')"),
    'the chat chip comes before the others'
  );
});

test('the participants roster is a tab, not a strip pinned under the chat', () => {
  /* It used to render unconditionally after the tab body, so it was always on
     screen and the Standings/Files tabs never got the height. */
  assert.match(panel, /openTab\('participants'\)/, 'the chip opens it');
  assert.match(panel, /className={`live-chip \$\{tab === 'participants' \? 'live-chip-on' : ''\}`}/,
    'and shows as active while it is open');

  const afterTabBody = panel.slice(panel.lastIndexOf('</div>\n      )}'));
  assert.doesNotMatch(afterTabBody, /live-participants/,
    'the duplicate pinned copy below the tab body is gone');
  assert.equal((panel.match(/live-participants--tab/g) || []).length, 1,
    'the roster is rendered once, not twice');
});

test('the roster chip and the roster list read the same filtered list', () => {
  /* The chip carries the head-count and the tab body carries the rows. If these
     filtered separately they would drift, and the number on the chip would be
     the one the instructor trusts. */
  assert.match(panel, /const inRoom = \(participants \|\| \[\]\)\.filter\(\(p\) => p\.status !== 'left'\)/);
  assert.match(panel, /const roster = \[\.\.\.inRoom\]\.sort\(/, 'the rows come from the same filtered list');
  const counts = panel.match(/inRoom\.length/g) || [];
  assert.ok(counts.length >= 2, 'the chip and the panel head both count inRoom');
  /* A student must not be listed as in the room after leaving. */
  assert.doesNotMatch(panel, /participants\.filter\(\(p\) => p\.status !== 'left'\)\.length/,
    'no second, independent head-count');
});

test('only the participants list scrolls, inside a bounded panel', () => {
  /* `.live-chat-tabbody` is a flex column with `min-height: 0`. The merged panel
     must stay bounded and hand the scrolling to the LIST - otherwise a class of
     40 stretches the panel until the tabs are pushed off the top. */
  assert.match(panel, /className="live-chat-tabbody" style=\{\{ display: tab === 'participants' \? 'block' : 'none' \}\}/,
    'it renders inside the tab body');
  const tabRule = css.match(/\.live-participants--tab \{([^}]*)\}/);
  assert.ok(tabRule, 'the panel has its own rule');
  for (const decl of ['flex: 1 1 auto', 'min-height: 0', 'overflow: hidden']) {
    assert.ok(tabRule[1].includes(decl), `${decl} is set on the panel`);
  }
  const listRule = css.match(/\.live-participants-list \{([^}]*)\}/);
  assert.ok(listRule, 'the list has its own rule');
  for (const decl of ['min-height: 0', 'max-height:', 'overflow-y: auto']) {
    assert.ok(listRule[1].includes(decl), `${decl} is set on the list`);
  }
});

test('the chat-mode controls live on the chat tab, not in the tab bar', () => {
  /* Open / Instructor only / Clean set the chat mode and wipe the transcript.
     Neither means anything while the instructor is reading Standings, the move
     list or the roster - which is exactly where they used to sit, so the bar
     showed three controls for a panel that was not on screen. */
  assert.match(panel, /\{isInstructor && tab === 'chat' && \(/,
    'the mode controls are gated on the chat tab');

  assert.ok(gate.includes("setMode('open')"), 'the mode toggle is inside the gate');
  assert.ok(gate.includes("setMode('instructor-only')"), 'both of them');
  assert.ok(gate.includes('handleClearChat'), 'and the transcript wipe');
  assert.ok(!gate.includes('📚 Course'), 'Course is not dragged in with them');
  assert.ok(!gate.includes('👥 Grants'), 'nor Grants');

  /* Course switches panels, so it stays in the bar and remains reachable from any
     tab - an instructor mid-lesson should not have to return to Chat. */
  assert.ok(bar.includes('📚 Course'), 'the tab switches stay in the bar for every tab');
});

test('grants and the roster are one list, not two panels', () => {
  /* There used to be a grants block above the roster: the same people listed
     twice, once for the grant and once for the name. Now a single row carries
     both. */
  assert.doesNotMatch(panel, /live-grants-panel/, 'the separate grants panel is gone');
  assert.doesNotMatch(panel, /👥 Grants/, 'and so is the grants chip');
  assert.doesNotMatch(panel, /toggleGrants|showGrants|liveChatGrants/, 'including its toggle and stored flag');
  assert.doesNotMatch(panel, /const grantable =/, 'and its own student filter');

  /* One filtered roster feeds the count, the head and the rows; the rows are
     hosts first, then students by name. */
  assert.match(panel, /const inRoom = \(participants \|\| \[\]\)\.filter\(\(p\) => p\.status !== 'left'\)/);
  assert.match(panel, /const roster = \[\.\.\.inRoom\]\.sort\(/, 'the list is the roster, sorted');
  assert.match(panel, /const ah = a\.roleInClass === 'host' \? 0 : 1/);
  assert.match(panel, /const bh = b\.roleInClass === 'host' \? 0 : 1/);
  assert.match(panel, /return \(a\.name \|\| ''\)\.localeCompare\(b\.name \|\| ''\)/,
    'students sort by name');

  /* The participants tab renders exactly that one body, once. */
  assert.match(panel, /className="live-chat-tabbody" style=\{\{ display: tab === 'participants' \? 'block' : 'none' \}\}>\s*\{participantsBody\}/,
    'the tab renders the merged body');
  assert.equal((panel.match(/live-participants--tab/g) || []).length, 1,
    'the panel is rendered once');

  /* The grant control is per row and instructor-only; a student must not be able
     to grant themselves the black side. */
  const tabBody = panel.slice(bodyStart, bodyEnd);
  assert.ok(tabBody.includes('const canManage = isInstructor && !isHost;'),
    'gated on isInstructor and not a host');
  assert.ok(tabBody.includes('live-grant-dot'), 'the colour picker is in the row');
});

test('every participant action button is a touch target', () => {
  /* The panel is used on phones as well as the classroom display. */
  const rule = css.match(/\.live-participant-actions button \{([^}]*)\}/);
  assert.ok(rule, 'the action buttons have their own rule');
  assert.match(rule[1], /min-width: 36px/, 'at least 36px wide');
  assert.match(rule[1], /min-height: 36px/, 'and 36px tall');
  assert.match(css, /\.live-participant-actions button \{ min-width: 44px; min-height: 44px; \}/,
    'and grow to 44px on the smallest phones');
});

test('the mode controls sit under the panel heading, not inside the tab bar', () => {
  /* The tab bar is for choosing WHICH panel is showing. Three actions on the
     messages were mixed into it, so the whole row read as a list of tabs and
     the "Instructor only" state was invisible while you were on Standings. They
     get their own row immediately below the heading instead. */
  assert.ok(!bar.includes('setMode(') && !bar.includes('handleClearChat'),
    'nothing in the tab bar acts on the messages');
  assert.ok(bar.includes("openTab('chat')"), 'the bar still switches tabs');

  /* The gate has to come after the head closes - that is what puts it below. */
  assert.ok(gateStart > modesEnd, 'the mode controls render after the tab bar, as their own row');
  assert.match(panel, /<div className="live-chat-modebar">/,
    'in a row of its own, not appended to the bar');
});

test('the mode bar is styled as a sub-header, not a second heading', () => {
  /* It sits directly under the gold heading; a second gold band would read as a
     second title. The classroom theme overrides the dark default. */
  const rule = css.match(/\.live-chat-modebar \{([^}]*)\}/);
  assert.ok(rule, 'the row has its own rule');
  for (const decl of ['display: flex', 'gap: 5px', 'border-bottom']) {
    assert.ok(rule[1].includes(decl), `${decl} is set on the mode bar`);
  }
  assert.ok(!rule[1].includes('linear-gradient'),
    'the dark default stays flat, not another gold band');
  assert.match(css, /\.live-room \.live-chat-modebar \{[^}]*background: linear-gradient/,
    'the classroom theme gives it the page background instead');
  /* The chips themselves are styled by the existing `.live-chat-panel .live-chip`
     rules, which this row reuses - they must not need their own copy. */
  assert.doesNotMatch(css, /\.live-chat-modebar \.live-chip/,
    'no duplicate chip styling to drift out of sync');
});

test('the mode controls are also still instructor-only', () => {
  /* Scoping them to the chat tab must not have turned them on for students. */
  assert.ok(gate.startsWith("{isInstructor && tab === 'chat'"), 'gated on isInstructor as well');
});

test('the roster tab is open to students as well as the instructor', () => {
  /* The old strip was outside the isInstructor branch, so students could see the
     room. The chip has to stay outside it too or only admins can find the tab. */
  const chipAt = bar.indexOf("openTab('participants')");
  assert.ok(chipAt > 0, 'the chip exists');
  /* Scoped to the bar on purpose: the merged tab body now contains an
     `{isInstructor && (` block of its own for the grants, and a whole-file search
     would find that one first and pass/fail for the wrong reason. */
  const instructorBlock = bar.indexOf('{isInstructor && (');
  assert.ok(instructorBlock > -1, 'the bar still has an instructor-only group');
  assert.ok(chipAt < instructorBlock,
    'the chip sits before the instructor-only block, so students get it too');
  assert.match(panel, /\{isInstructor && <span className="live-participants-hint">/,
    'but the admin hint stays instructor-only');
  assert.match(panel, /\{canManage && \(/,
    'and so do the grant/remove buttons, which would otherwise let a student evict the host');
  assert.doesNotMatch(panel, /muteUser|admin:mute_participant|🔇/,
    'the mute feature is gone from the panel');
});