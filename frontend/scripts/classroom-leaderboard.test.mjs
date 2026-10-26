import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const backend = join(root, '..', 'backend');

const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const readBE = (...p) => readFileSync(join(backend, ...p), 'utf8');

const banner = read('src', 'components', 'liveclass', 'ClassroomJoinToasts.jsx');
const board = read('src', 'components', 'liveclass', 'ClassroomLeaderboard.jsx');
const chat = read('src', 'components', 'liveclass', 'ChatPanel.jsx');
const room = read('src', 'pages', 'LiveClassroom.jsx');
const podium = read('src', 'components', 'ChampionsPodium.jsx');
const api = read('src', 'services', 'liveClassApi.js');
const ctx = read('src', 'utils', 'botGameContext.js');
const css = read('src', 'index.css');

const ctrl = readBE('src', 'controllers', 'liveClassController.js');
const routes = readBE('src', 'routes', 'classRoutes.js');
const botCtrl = readBE('src', 'controllers', 'botController.js');
const botSvc = readBE('src', 'lib', 'botProgressService.js');
const migration = readBE('migrations', 'add_class_leaderboard.sql');

/** The leaderboard query on its own, so a test can assert about the SQL without
 *  matching the same words in the surrounding comments and response mapping. */
const sql_of = (source) => source.match(/const CLASS_LEADERBOARD_SQL = `([\s\S]*?)`;/)[1];

/* ------------------------------------------------------------------ *
 * Join notification
 * ------------------------------------------------------------------ */

test('join notices ride the existing participant_joined broadcast', () => {
  /* No new socket event is introduced: the room already announces arrivals, so
     this only renders what is broadcast. If the server event name ever changes,
     this fails rather than silently showing nothing. */
  assert.match(banner, /on\('participant_joined'/, 'subscribes to participant_joined');
  assert.match(banner, /\{ userId, name, role, joinedAt \}|p\.name/, 'reads the name off the payload');
});

test('the notice is a shared toast, not a bespoke panel', () => {
  /* It must use the app's own toast system so arrivals look and behave like
     every other notification (same stacking, dismiss, corner) rather than
     being a one-off styled element. */
  assert.match(banner, /import \{ useToast \} from '\.\.\/Toast'/, 'uses the shared toast provider');
  assert.match(banner, /const \{ showToast \} = useToast\(\)/, 'reads showToast');
  assert.match(banner, /showToast\(`\$\{name\} joined the class\.`/, 'and raises the toast with the name');
  assert.match(banner, /duration: JOIN_TOAST_MS/, 'with a lifetime');
  assert.match(banner, /tone: 'info'/, 'and a tone');

  /* Renders nothing - all the state lives in the toast provider. */
  assert.match(banner, /return null;/, 'renders no DOM of its own');
  assert.doesNotMatch(banner, /className=/, 'no bespoke markup');
});

test('it does not hand-roll dismissal or stacking', () => {
  /* The shared provider already does both, and doing it again here is how two
     notification systems end up fighting over the same corner.

     Strip comments first: prose about "the same dismiss" is fine, calling
     setTimeout or useState in this file is not. Matching the bare word would
     fail on our own documentation. */
  const code = banner
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\/\/.*$/gm, ' ');
  for (const owned of ['setTimeout', 'clearTimeout', 'useState', 'inflight', 'dismiss(']) {
    assert.ok(!code.includes(owned), `${owned} should not be reimplemented here`);
  }
});

test('the coach is distinguished from a student', () => {
  assert.match(banner, /p\.role === 'host'/, 'reads the role');
  assert.match(banner, /Coach joined/, 'and titles the notice accordingly');
});

test('a missing name does not render "undefined joined"', () => {
  assert.match(banner, /\(p\.name \|\| ''\)\.trim\(\) \|\| 'Someone'/, 'falls back to Someone');
});

test('you are never told that you joined', () => {
  /* participant_joined goes to the whole room including the joiner, so without
     this the instructor sees "You joined the class" on every reconnect. */
  assert.match(banner, /Number\(p\.userId\) === Number\(user\.id\)/, 'self is filtered out');
});

test('the instructor is the audience, and that is one flag away from everyone', () => {
  assert.match(banner, /instructorOnly\s*=\s*true/, 'defaults to instructor-only');
  assert.match(banner, /if \(instructorOnly && !isInstructor\) return undefined/, 'and gates on isInstructor');
});

test('the join listener is mounted in the room, not inside the chat panel', () => {
  assert.match(room, /<ClassroomJoinToasts \/>/, 'the room renders it');
  /* Nothing in ChatPanel should import it, or students would get two. */
  assert.doesNotMatch(chat, /ClassroomJoinToasts/, 'the chat panel does not also render it');
});

test('the toast provider is mounted above the classroom route', () => {
  /* Without this the listener silently does nothing: showToast would be a no-op
     and joins would go unannounced with no error anywhere. */
  const app = read('src', 'App.jsx');
  const open = app.indexOf('<ToastProvider>');
  const close = app.indexOf('</ToastProvider>');
  assert.ok(open > -1 && close > open, 'ToastProvider is mounted');
  const route = app.indexOf('/live-class/:id');
  assert.ok(route > open && route < close, 'and the classroom route is nested inside it');
});

/* ------------------------------------------------------------------ *
 * Classroom leaderboard - placement and access
 * ------------------------------------------------------------------ */

test('the leaderboard is a tab beside Chat / Files / Moves', () => {
  assert.match(chat, /openTab\('leaderboard'\)/, 'the chip opens it');
  assert.match(chat, /tab === 'leaderboard'[\s\S]{0,200}?ClassroomLeaderboard/, 'the tab body renders it');
  assert.match(chat, /t === 'moves' \|\| t === 'leaderboard'/, 'and it survives the persisted-tab allowlist');
});

test('students can reach the tab, not just the instructor', () => {
  /* The neighbouring chips (Open / Instructor only / Clean / Course) all sit inside
     a `{isInstructor && ( ... )}` block. The standings tab must be declared BEFORE
     that block opens, otherwise a student gets no button and the panel is
     unreachable for the people it is meant to motivate.

     Both offsets are taken from inside the chip bar. A whole-file search for
     `{isInstructor && (` now finds the grants block in the participants tab body
     first, which is defined above the bar - so this would compare against the
     wrong block and quietly stop testing what it claims to. */
  const modesStart = chat.indexOf('className="live-chat-modes"');
  const bar = chat.slice(modesStart, chat.indexOf('</div>', modesStart));
  const instructorAt = bar.indexOf('{isInstructor && (');
  const tabAt = bar.indexOf("openTab('leaderboard')");
  assert.ok(instructorAt > -1, 'the instructor-only chip block exists');
  assert.ok(tabAt > -1, 'the standings tab button exists');
  assert.ok(tabAt < instructorAt, 'the standings tab is declared BEFORE the instructor-only block');
  /* And it is a real tab body, not a button that leads nowhere. */
  assert.match(chat, /tab === 'leaderboard'/, 'the tab state is handled');
});

test('the leaderboard is visible to everyone in the room, so it does not re-gate on role', () => {
  /* Deliberate: students are who the board is meant to motivate. Asserted so a
     later "let's restrict this" change is a conscious decision, not a slip. */
  assert.doesNotMatch(board, /isInstructor/, 'no instructor gate in the panel');
  assert.doesNotMatch(board, /canModerate/, 'no moderation gate either');
});

/* ------------------------------------------------------------------ *
 * Classroom leaderboard - it reuses the real leaderboard UI
 * ------------------------------------------------------------------ */

test('the podium is the shared component, not a copy', () => {
  assert.match(board, /import ChampionsPodium/, 'imports the shared podium');
  assert.match(board, /<ChampionsPodium[\s\S]{0,200}?eloLabel="PTS"/, 'and points-mode labels it');
  assert.match(board, /stats=\{podiumStats\}/, 'with class stats instead of career stats');
  assert.match(board, /showPeak=\{false\}/, 'and no meaningless peak for a class board');
  /* The markup is inherited, not re-implemented: no hand-rolled gold/silver/bronze. */
  assert.doesNotMatch(board, /lb-gold|lb-silver|lb-bronze|lb-crown/, 'does not re-create podium styling');
});

test('the podium extension is backwards compatible', () => {
  assert.match(podium, /stats,/, 'accepts stats');
  assert.match(podium, /showPeak = true/, 'peak stays on by default');
  assert.match(podium, /\{showPeak &&/, 'and is conditionally rendered');
  /* Default strip preserved, or the main leaderboard and dashboard change. */
  assert.match(podium, /label: 'Streak'[\s\S]{0,120}?label: 'W\/L\/D'[\s\S]{0,120}?label: 'Games'/,
    'the original Streak/W-L-D/Games strip is still the default');
  assert.match(podium, /\{rank === 1 && <span className="lb-champ">\{ribbon \|\| 'Current Champion'\}<\/span>\}/,
    'the ribbon is overridable but keeps its default');
});

test('the board reads the shared .lb-* styling rather than inventing its own', () => {
  assert.match(board, /className="lb-grid lb-grid--class lb-head"/, 'uses the shared table classes');
  assert.match(board, /className=\{`lb-grid lb-grid--class lb-row/, 'for rows too');
  assert.match(css, /\.lb-grid \{/, 'the shared grid still exists');
  assert.match(css, /\.lb-grid--class \{ grid-template-columns: \d+px minmax\(0, 1fr\) \d+px \d+px \d+px/,
    'with a 5-column classroom variant: rank | player | status | drills | points');
});

test('the columns fit the rail the board actually renders in', () => {
  /* THE BUG THIS EXISTS FOR
     The tracks were 40 + 104 + 74 + 74. With gaps and padding that is ~346px of
     fixed width, but this board is a tab inside the chat rail, and
     .live-room-desktop makes that rail a fixed 300/360/390px column. So the
     player column - the only one that can be truncated gracefully - was left
     about 8px, and every status arrived as a stub.

     Checked per tier against the rail that tier actually serves: the base rule
     for containers over 330px (the 360px rail is its narrowest case) and the
     container-query rule for the 300px rail. Padding here is the ROW's, counted
     once - the cells have none of their own, so a track's width is its content
     width. Getting that backwards understates every column by twice the padding. */
  const tiers = [
    /* Each `rule` is a block of CSS text; the grid's own properties are read from
       it below. In the compact block the grid rule comes first, so the first
       `gap:`/`padding:` found belong to the grid and not to the rules below it. */
    { name: 'base', rail: 360, rule: css.match(/\.lb-grid--class \{([^}]*)\}/)[1] },
    {
      name: 'narrow rail',
      rail: 300,
      rule: css.match(/@container lbclass \(max-width: 330px\) \{([\s\S]*?)\n\}/)[1],
    },
  ];
  const AVATAR = 26; // .lb-player .lb-photo, which the name sits beside

  for (const { name, rail, rule } of tiers) {
    const tracks = rule.match(/grid-template-columns: ([^;]+);/)[1].trim().split(/\s+(?![^(]*\))/);
    const gap = Number(rule.match(/gap: (\d+)px/)[1]);
    const pad = Number(rule.match(/padding: (\d+)px/)[1]);
    assert.equal(tracks.length, 5, `${name}: still five columns`);
    /* The name column is the flexible one, so it absorbs whatever is left. */
    assert.match(tracks[1], /^minmax\(0, 1fr\)$/, `${name}: the player column is the flexible track`);

    const fixed = tracks.filter((t) => !/fr/.test(t)).reduce((sum, t) => sum + Number(t.replace('px', '')), 0);
    const chrome = fixed + gap * (tracks.length - 1) + pad * 2;
    const forName = rail - chrome;
    assert.ok(chrome < rail, `${name}: fixed columns (${chrome}px) must fit the ${rail}px rail`);
    /* 33px is the avatar plus its gap. Font metrics cannot be measured from
       source, so this asserts only what is certain: the avatar is visible and
       the name has somewhere to start. */
    assert.ok(forName >= AVATAR + 7, `${name}: only ${forName}px left for the player column`);
  }
});

test('the status track fits its longest label, icon included', () => {
  /* "Not joined" is the widest thing in that column. It carries an icon and sits
     in a cell with ellipsis, so if the track cannot hold it the word the coach is
     scanning for arrives as "Not joi...". */
  const statusW = Number(css.match(/\.lb-grid--class \{ grid-template-columns: \d+px minmax\(0, 1fr\) (\d+)px/)[1]);
  const gap = Number(css.match(/\.lb-status \{[^}]*gap: (\d+)px/)[1]);
  const needed = 60 /* "Not joined" at 11px bold */ + 12 /* icon */ + gap;
  assert.ok(statusW >= needed, `status track ${statusW}px cannot hold ${needed}px of label`);
});

test('the narrow step-down is a container query, not a viewport one', () => {
  /* The old rule was `@media (max-width: 520px)`, which never fired for this
     panel: a 390px rail can sit on a 1920px viewport, so the viewport said
     "plenty of room" while the rail said otherwise. The panel is the container,
     so the panel is the query. */
  assert.match(css, /\.lb-classroom \{[^}]*container-type: inline-size/, 'the panel is a container');
  assert.match(css, /container-name: lbclass/, 'and it is named');
  assert.match(css, /@container lbclass \(max-width: 330px\)/, 'the compact step-down keys off it');
  assert.doesNotMatch(css, /@media \(max-width: 520px\) \{\s*\.lb-grid--class/, 'the viewport rule is gone');
  /* Give ground in the order things are read, and drop the sub-line rather than
     truncating a label - the same count is in the ratio and the API row. */
  const compact = css.slice(css.indexOf('@container lbclass'), css.indexOf('@container lbclass') + 500);
  assert.match(compact, /\.lb-sub \{ display: none/, 'the attempted sub-line goes first');
  assert.match(compact, /\.lb-status \{ font-size: 10px/, 'and the status label steps down rather than clipping');
});

test('the attempted sub-line is short enough for its own column', () => {
  /* "2 attempted" at 10px is wider than the drills track, and .lb-sub is nowrap
     with no ellipsis - so it spilled into the Points column instead of
     truncating. The count is unchanged; only the word got shorter. */
  assert.match(board, /`\$\{num\(r\.puzzles_attempted\)\} tried`/, '"tried", not "attempted"');
  assert.doesNotMatch(board, /attempted`\s*:\s*'not started'/, 'and the empty state is short too');
  const drillsW = Number(css.match(/\.lb-grid--class \{ grid-template-columns: \d+px minmax\(0, 1fr\) \d+px (\d+)px/)[1]);
  assert.ok(drillsW >= 40, `the drills track (${drillsW}px) must hold "2 tried" over "2/2"`);
});

test('the rank track fits a three-digit rank at the size it is rendered', () => {
  /* A class can run past 99 students, so "#187" has to fit - and the rank was
     briefly shrunk to a 24px track, which "#187" overflows at 15px. */
  assert.match(css, /\.lb-classroom \.lb-rank \{ font-size: 13px/, 'the classroom steps the rank font down');
  const rankW = Number(css.match(/\.lb-grid--class \{ grid-template-columns: (\d+)px/)[1]);
  assert.ok(rankW >= 30, `the rank track (${rankW}px) must hold "#187"`);
});

test('the grid columns and the header cells agree', () => {
  /* A mismatch here is invisible in the source and obvious on screen: the last
     column silently wraps under the previous one instead of aligning. Counted
     from the markup, not trusted from the CSS. */
  const trackCount = (s) => (css.match(/\.lb-grid--class \{ grid-template-columns: ([^;]+);/) || [])[1]
    ?.trim().split(/\s+(?![^(]*\))/).length;

  const header = board.match(/lb-grid--class lb-head">([\s\S]*?)<\/div>/)[1];
  const cells = header.split('<span').length - 1;
  assert.equal(cells, 5, 'five header cells');
  assert.equal(trackCount(css), 5, 'five grid tracks');
  assert.equal(trackCount(css.replace(/@media[\s\S]*/, '')), 5, 'and five in the desktop rule');
});

test('the status styles exist for all four states', () => {
  for (const cls of ['lb-st-done', 'lb-st-wip', 'lb-st-joined', 'lb-st-away']) {
    assert.match(css, new RegExp(`\\.${cls} \\{`), `${cls} is styled`);
  }
  assert.match(board, /className=\{`lb-status \$\{st\.cls\}`\}/, 'the row picks its colour from the status');
});

test('the classroom header is light, and only in the classroom', () => {
  /* It inherited the shared .lb-head near-black slab (rgba(10,20,14,.85)), which
     put a heavy dark bar on top of the dark rows and left the dim #a3a3a3 labels
     as the least readable text in the panel. Asserted scoped, because editing
     .lb-head in place would silently restyle the public leaderboard page too. */
  assert.match(css, /\.lb-classroom \.lb-head \{[^}]*background: linear-gradient\(180deg, #f4f7f9, #e3ebef\)/,
    'a light fill for the classroom header');
  assert.match(css, /\.lb-classroom \.lb-head \{[^}]*color: #1d3b49/, 'with dark label text to stay readable');

  const shared = css.match(/^\.lb-head \{([^}]*)\}/m)[1];
  assert.match(shared, /background: rgba\(10,20,14,\.85\)/, 'the shared dark header is untouched');
  assert.match(shared, /color: #a3a3a3/, 'including its label colour');

  /* A light bar over a body whose top border was drawn to meet the dark slab
     leaves a visible seam, so the seam is closed rather than left to chance. */
  assert.match(css, /\.lb-classroom \.lb-body \{[^}]*border-top/, 'and the seam under it is handled');
});

test('the classroom champion card is scaled down, and the size comes from a prop', () => {
  /* ChessAvatar writes `width`/`height` as an INLINE style, so a stylesheet rule
     for `.lb-avatar` cannot shrink it - `.lb-gold .lb-avatar { width: 84px }` has
     been dead weight for as long as it has existed. A caller that needs a smaller
     card has to pass the number, so that it is passed and that the default is
     untouched for the two other podiums. */
  assert.match(podium, /avatarSize \?\? \(rank === 1 \? 84 : 70\)/,
    'the shared default still sizes the other cards');
  assert.doesNotMatch(podium, /size=\{rank === 1 \? 84 : 70\}/,
    'the hard-coded size that ignored callers is gone');

  /* 84 shared -> 42 (half) -> 25 (40% off that). Asserted as the relationship, not
     as a literal, so the next reduction is measured against the last one. Ceiling
     rather than a bare ratio: these are whole pixels, so 216 * 0.6 = 129.6 can
     only be honoured as 130. */
  const avatar = Number(board.match(/avatarSize=\{(\d+)\}/)[1]);
  assert.ok(avatar <= Math.ceil(42 * 0.6), `the avatar is down to ${avatar}px, from 84`);
  assert.ok(avatar / 42 <= 0.6, 'and at least 40% off the half-size card');

  /* A 42px picture in a 252px card is not a smaller card, it is the same card
     with a small picture - so the box has to shrink by the same factor. */
  const width = Number(css.match(/\.lb-classroom \.lb-pcard \{[^}]*max-width: (\d+)px/)[1]);
  assert.ok(width <= Math.ceil(216 * 0.6), `the card is ${width}px, at least 40% off 216`);
});

test('no text on the champion card drops below a legible size', () => {
  /* Forty percent off the half-size card is 6.9px for the name, which renders as
     a grey smudge on the light theme. The box shrinks by the full 40%; the type
     shrinks until it hits the floor, and no further. */
  const sizes = [...css.matchAll(/\.lb-classroom \.lb-(?:name|elo|elo b|mini|tier|crown|champ)[^{]*\{([^}]*)\}/g)]
    .flatMap(([, body]) => [...body.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)].map(([, v]) => Number(v)));
  assert.ok(sizes.length >= 7, `found ${sizes.length} font sizes on the card`);
  for (const v of sizes) {
    assert.ok(v >= 8, `${v}px is below the 8px legibility floor`);
  }
});

test('the champion card cannot overlap its neighbours, whatever the text length', () => {
  /* The overlap kept coming back on the instructor side: fixing one absolute
     child at a time does not hold, because every one of them can sit on top of a
     sibling or on the panel chrome as soon as the text inside changes length.
     The card lays out on an explicit grid instead, so nothing is out of flow. */
  const card = css.match(/\.lb-classroom \.lb-pcard \{([^}]*)\}/)[1];
  assert.match(card, /display: grid/, 'the card is a grid');
  assert.match(card, /align-content: start/, 'rows are packed, not stretched');
  /* `.lb-gold` lifts the card -16px (-20 on hover) into the line above it. The
     lift only exists to clear the other two podium cards, and there is one card. */
  assert.match(card, /transform: none/, 'the gold lift is cancelled');
  assert.match(css, /\.lb-classroom \.lb-pcard:hover \{[^}]*transform: none/, 'including on hover');
  /* flex: 1 1 208px let it grow into the rail; the table below needs that room. */
  assert.match(card, /flex: 0 1 auto/, 'the card no longer grows into the rail');

  /* Every child that the shared card positions absolutely is pinned to a row.
     Derived from the shared rules rather than listed by hand, so a new absolute
     child added to ChampionsPodium cannot slip through un-neutralised. */
  const absolutelyPositioned = [...css.matchAll(/^\.(lb-[a-z]+) \{([^}]*position: absolute[^}]*)\}/gm)]
    .map(([, sel, body]) => [sel, body]);
  assert.ok(absolutelyPositioned.length >= 3,
    `the shared card still has absolute children (found ${absolutelyPositioned.length})`);
  for (const [sel] of absolutelyPositioned) {
    const rule = css.match(new RegExp(`\\.lb-classroom ${sel.replace('.', '\\.')} \\{([^}]*)\\}`));
    if (!rule) continue; /* e.g. .lb-medal, which the classroom never renders */
    assert.match(rule[1], /position: static/, `${sel} leaves absolute positioning`);
  }

  /* And every rendered child owns an explicit row, so nothing can be pulled out
     of flow and land on a neighbour. */
  for (const [sel, area] of [
    ['.lb-tier', '1 / 1'],
    ['.lb-champ', '1 / 2'],
    ['.lb-crown', '2 / 1 / auto / -1'],
    ['.lb-avatar', '3 / 1 / auto / -1'],
    ['.lb-name', '4 / 1 / auto / -1'],
    ['.lb-elo', '5 / 1 / auto / -1'],
    ['.lb-mini', '6 / 1 / auto / -1'],
  ]) {
    const rule = css.match(new RegExp(`\\.lb-classroom ${sel.replace('.', '\\.')} \\{([^}]*)\\}`))[1];
    assert.ok(rule.includes(`grid-area: ${area}`), `${sel} owns row ${area}`);
  }

  /* The gold glow paints OUTSIDE the border box, so it lands on the subtitle
     above and the roster header below no matter how the card is laid out. */
  assert.match(card, /box-shadow: 0 1px 3px/, 'the 24px cyan glow is gone');
  assert.doesNotMatch(card, /0 0 24px/, 'and nothing replaces it');
});

test('the compact card still centres, and the podium stays shared', () => {
  assert.match(css, /\.lb-podium \{[^}]*justify-content: center/, 'the row centres its cards');
  assert.match(board, /import ChampionsPodium/, 'still the shared component, not a copy');
  assert.doesNotMatch(board, /lb-gold|lb-silver|lb-bronze|lb-crown/, 'with no podium styling re-implemented');
});

/* ------------------------------------------------------------------ *
 * Classroom leaderboard - champion-only podium
 * ------------------------------------------------------------------ */

test('only the top scorer gets the podium; everyone else is a normal row', () => {
  /* The podium used to take the top three, which handed a gold/silver/bronze
     card to students on 0 points and buried the thing the coach is looking for -
     who has actually started. One card, then the table. */
  assert.match(board, /const champion = rows\.slice\(0, 1\)/, 'the podium takes exactly one row');
  assert.match(board, /const rest = rows\.slice\(1\)/, 'and everybody else continues into the table');
  assert.match(board, /list=\{champion\}/, 'the podium is fed the champion only');
  assert.doesNotMatch(board, /rows\.slice\(0, 3\)|top3/, 'no top-three slice remains');
});

test('the champion ribbon states the ranking rule, in points', () => {
  /* "Top of the class" repeated the heading and said nothing about what was
     being ranked. The board is scored by drill points, so the card says so. */
  assert.match(board, /const ribbon = topPoints \? 'Top points' :/, 'the ribbon names the top scorer');
  assert.match(board, /ribbon=\{ribbon\}/, 'and is passed to the podium');
  assert.doesNotMatch(board, /ribbon="Top of the class"/, 'the vague default wording is gone');
});

test('a class where nobody has scored is not crowned a top scorer', () => {
  /* Every student on 0 makes rows[0] arbitrary - alphabetical, not best. Putting
     "Top points" on that card would be a claim the board cannot support, so it
     says the honest thing instead. */
  assert.match(board, /const topPoints = rows\.length > 0 && num\(rows\[0\]\.total_points\) > 0/,
    'a leader needs a non-zero total to be the top scorer');
  assert.match(board, /'No points yet'/, 'and the fallback says so');
});

test('the champion keeps its drill status, so points and progress are both visible', () => {
  /* Answering "who is winning" with a points total alone hides that the leader
     may have finished one drill of five. */
  const stats = board.match(/const podiumStats = \(p\) => \[([\s\S]*?)\n  \];/)[1];
  assert.match(stats, /label: 'Drills'/, 'drill progress is on the card');
  assert.match(stats, /label: 'Status'/, 'and so is the drill status');
  assert.match(board, /eloLabel="PTS"/, 'with the points beside it');
});

test('a single-card podium still centres, because the row is a flex box', () => {
  /* The podium was built for three cards. One card must not drift to the left
     edge of the panel. .lb-podium centres with justify-content, so no override
     is needed - and none must be added, or this breaks again. */
  assert.match(podium, /if \(!p\) return null;/, 'missing ranks are skipped rather than padded');
  assert.match(podium, /const byRank = \[null, list\[0\], list\[1\], list\[2\]\]/, 'rank 1 maps to the only entry');
  assert.match(css, /\.lb-podium \{[^}]*justify-content: center/, 'and the row centres its cards');
  assert.doesNotMatch(css, /\.lb-classroom \.lb-podium \{[^}]*justify-content/, 'the classroom adds no override');
});

test('the endpoint exists and is routed', () => {
  assert.match(ctrl, /exports\.getClassLeaderboard = async/, 'controller exported');
  assert.match(routes, /router\.get\('\/:id\/leaderboard', liveCtrl\.getClassLeaderboard\)/, 'route registered');
  assert.match(api, /getClassLeaderboard[\s\S]{0,200}?\/classes\/\$\{id\}\/leaderboard/, 'client calls it');
  assert.match(api, /cache: false/, 'uncached, so a student sees their own score move');
});

test('only the drills assigned in this class score', () => {
  /* Scoped to the one thing the coach assigned. Online games and bot games are
     deliberately not counted: a student must not be able to top the class by
     grinding bots outside the lesson, and the board should report the number the
     coach actually set on the drill. */
  assert.match(ctrl, /live_class_puzzle_progress/, 'drill progress is the source');
  assert.match(ctrl, /live_class_puzzle_drills/, 'joined back to the drills of this class');
  assert.match(ctrl, /COALESCE\(SUM\(p\.points_earned\), 0\)/, 'points summed from the progress row');

  const sql = ctrl.match(/const CLASS_LEADERBOARD_SQL = `([\s\S]*?)`;/)[1];
  assert.ok(!sql.includes('online_games'), 'no online games on the board');
  assert.ok(!sql.includes('bot_game_results'), 'no bot games on the board');
  assert.ok(!sql.includes('coins_awarded'), 'no bot coins');
});

test('no board-side constant re-weights the coach-set drill points', () => {
  /* Drill points are chosen by the coach per drill. Any multiplier here would
     silently discard their number. */
  assert.doesNotMatch(ctrl, /SUM\(p\.points_earned \* \d/, 'drill points are summed as-is');
  assert.doesNotMatch(ctrl, /PVP_WIN_POINTS|PVP_DRAW_POINTS/, 'the old PvP constants are gone entirely');
});

test('every enrolled student is listed, not only the ones who scored', () => {
  /* The whole point of the status column: a board that lists only scorers tells
     the coach nothing about the students who have not opened the drill. */
  assert.match(ctrl, /FROM class_students cs/, 'the roster is class membership');
  assert.doesNotMatch(ctrl, /WHERE total_points > 0 OR/, 'the "did anything" filter is gone');
  assert.match(sql_of(ctrl), /FROM scored\s*\nORDER BY/, 'nothing filters rows out before the sort');

  /* The coach is not in class_students, so they cannot top their own board. */
  assert.doesNotMatch(ctrl, /JOIN classes/, 'the class row is not joined into the standings');
});

test('each student carries a status the UI can colour', () => {
  assert.match(sql_of(ctrl), /END AS status/, 'the server decides the status');
  assert.match(sql_of(ctrl), /WHEN puzzles_solved >= GREATEST\(drills_assigned, 1\)/, 'completed needs every drill solved');
  assert.match(sql_of(ctrl), /AND puzzles_attempted > 0 THEN 'completed'/, 'and something actually attempted');
  assert.match(sql_of(ctrl), /WHEN puzzles_attempted > 0\s+THEN 'in_progress'/, 'otherwise partial work is in progress');
  assert.match(sql_of(ctrl), /WHEN in_room OR marked_present\s+THEN 'joined'/, 'then presence alone is joined');
  assert.match(sql_of(ctrl), /ELSE 'not_joined'/, 'and the rest never arrived');

  /* A class with no drills must not report everybody as completed. */
  assert.match(sql_of(ctrl), /GREATEST\(drills_assigned, 1\)/, 'the comparison cannot pass on an empty assignment');

  /* And the client only supplies words and colour. */
  for (const [k, label] of [['completed', 'Completed'], ['in_progress', 'In progress'], ['joined', 'Joined'], ['not_joined', 'Not joined']]) {
    assert.ok(board.includes(`${k}:`), `the client knows the "${k}" state`);
    assert.ok(board.includes(label), `labelled "${label}"`);
  }
});

test('a student is counted once even with several presence rows', () => {
  /* attendance and live_class_participants can both hold rows for one student;
     joining either without aggregating would duplicate the student in the
     standings and split their points across two rows. */
  assert.match(sql_of(ctrl), /att AS \([\s\S]{0,200}?BOOL_OR\(a\.status = 'present'\)[\s\S]{0,200}?GROUP BY a\.student_id/, 'attendance is aggregated per student');
  assert.match(sql_of(ctrl), /presence AS \([\s\S]{0,200}?BOOL_OR\(lp\.status = 'active'\)[\s\S]{0,200}?GROUP BY lp\.user_id/, 'so is live presence');
  /* Neither is joined on a column that could repeat. */
  assert.match(sql_of(ctrl), /LEFT JOIN att at ON at\.student_id = m\.student_id/, 'joined once, by student id');
});

test('the coach is not counted as present just for hosting', () => {
  /* live_class_participants holds the coach too (role_in_class = 'host'). Counting
     them would let a class where only the coach joined read as "1 present". */
  assert.match(sql_of(ctrl), /AND lp\.role_in_class = 'student'/, 'presence is students only');
});

test('points are class-scoped, never all-time', () => {
  assert.match(sql_of(ctrl), /d\.live_class_id = \$1/, 'drills filtered to this class');
  /* No join to the global rating / puzzle-all-time tables. */
  assert.doesNotMatch(ctrl, /student_time_ratings|student_game_analysis|puzzle_attempts/, 'no all-time tables used');
});

test('the tie-break is stable and deterministic', () => {
  assert.match(sql_of(ctrl), /ORDER BY total_points DESC, puzzles_solved DESC, name ASC/,
    'points, then puzzles, then name');
});

test('the drill count compares against the real assignment', () => {
  /* A hardcoded "all 3 drills" would mark a student completed after one. */
  assert.match(sql_of(ctrl), /drill_totals AS \([\s\S]{0,120}?COUNT\(\*\)::int AS assigned/, 'assigned is counted');
  assert.match(sql_of(ctrl), /CROSS JOIN drill_totals dt/, 'and joined into every row');
});

test('the response no longer advertises the PvP and bot columns', () => {
  /* Leaving them in the payload would let an old cached client render zeros for
     columns that no longer exist on this board. */
  for (const gone of ['pvp_points', 'pvp_wins', 'pvp_losses', 'pvp_games', 'bot_points', 'bot_games', 'bot_wins']) {
    assert.doesNotMatch(ctrl, new RegExp(`${gone}: r\\.`), `${gone} is not in the response`);
    assert.doesNotMatch(board, new RegExp(`\\br\\.${gone}\\b`), `the client does not read ${gone}`);
  }
  assert.match(ctrl, /source: 'drills'/, 'the response says what it scores');
  assert.match(board, /drillsAssigned/, 'and the client shows how many were assigned');
});

/* ------------------------------------------------------------------ *
 * Bot games: class attribution
 * ------------------------------------------------------------------ */

test('bot game results can be attributed to a class', () => {
  assert.match(migration, /ALTER TABLE bot_game_results[\s\S]{0,120}?ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes\(id\) ON DELETE SET NULL/,
    'the column is added, nullable and set-null on class delete');
  assert.match(botSvc, /async function recordGame\([^)]*classId = null/, 'recordGame accepts it');
  assert.match(botSvc, /INSERT INTO bot_game_results \([^)]*class_id\)/, 'and persists it');
  /* Nullable on purpose: a game played outside any class stays uncounted. */
  assert.match(botSvc, /classId == null \|\| classId === '' \? null/, 'absent context stores NULL');
});

test('the client sends the live class it is sitting in', () => {
  assert.match(ctx, /localStorage\.setItem/, 'the classroom publishes the class');
  assert.match(ctx, /localStorage\.removeItem/, 'and clears it on the way out');
  assert.match(room, /setBotGameContext\(\{ classId: classMeta\.id/, 'the classroom publishes on mount');
  assert.match(room, /return \(\) => clearBotGameContext\(\)/, 'and clears on unmount');
  assert.match(read('src', 'services', 'botsApi.js'), /classId: classContext\.classId/, 'the bot game reports it');
});

test('a forged classId cannot post coins to another class board', () => {
  assert.match(botCtrl, /classId \}/, 'classId is read from the body');
  assert.match(botCtrl, /userIsMemberOfClass/, 'membership is verified server-side');
  assert.match(botCtrl, /if \(access\.authorized\) verifiedClassId = parsedClassId/, 'only a real member gets attributed');
  /* Degrades to NULL instead of failing: a leaderboard line is never worth the
     coins a student actually earned. */
  assert.match(botCtrl, /verifiedClassId = null/, 'defaults to no attribution');
  assert.match(botCtrl, /losing a leaderboard line must never cost a student/, 'for the reason');
});

/* ------------------------------------------------------------------ *
 * Freshness
 * ------------------------------------------------------------------ */

test('the board refreshes when the event that awards points fires', () => {
  /* A student who just solved the drill must see their own points move. */
  assert.match(board, /on\('puzzle_drill_progress'/, 'subscribed to drill progress');
  assert.doesNotMatch(board, /pvp-finished/, 'the game event is gone with the PvP columns');
  /* Cross-class events must not trigger a fetch for this class. */
  assert.match(board, /payload\.classId != null && Number\(payload\.classId\) !== Number\(classId\)/,
    'events for another class are ignored');
  /* Called directly - bumping state here would only restart the poll interval,
     leaving the "instant" update up to a full poll late. */
  assert.doesNotMatch(board, /setTick/, 'no tick-based deferral');
});

/* ------------------------------------------------------------------ *
 * The board must not depend on optional schema
 * ------------------------------------------------------------------ */

test('the leaderboard needs no optional tables at all', () => {
  /* It used to 500 on a database where add_bot_progress.sql had never been
     applied, which is the state this project actually ships in. Now that the
     board is drill-only it touches nothing optional, so the whole capability
     probe that used to paper over that is gone rather than merely bypassed. */
  assert.doesNotMatch(ctrl, /botTableExists|botTableCheck/, 'no probe to maintain');
  assert.doesNotMatch(ctrl, /information_schema/, 'and no catalog lookup per process');
  assert.doesNotMatch(ctrl, /WITH_BOTS/, 'and only one query remains');
  assert.doesNotMatch(ctrl, /PVP_WIN_POINTS|PVP_DRAW_POINTS/, 'nor any PvP weighting');

  /* Everything it does read is core classroom schema. */
  for (const core of ['class_students', 'students', 'users', 'live_class_puzzle_drills', 'live_class_puzzle_progress', 'live_class_participants', 'attendance']) {
    assert.ok(sql_of(ctrl).includes(core), `${core} is core schema`);
  }
});

test('the frontend degrades visibly instead of silently showing nothing', () => {
  assert.match(board, /live-chat-error/, 'renders an error when the request fails');
  assert.match(board, /Could not load the class leaderboard/, 'with a readable message');
  /* And the panel must still be mounted on a 500 - not crash the classroom. */
  assert.doesNotMatch(board, /throw new Error/, 'never throws into the render tree');
});

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * The podium must survive whatever a caller passes it
 * ------------------------------------------------------------------ */

test('the podium resolves `stats` given either a function or an array', () => {
  /* Regression. The classroom passes stats={(p) => [...]} because each card is
     a different player - the same shape it already used for `elo`. The podium
     treated `stats` as an array and called .map on the function itself:
       TypeError: mini.map is not a function
     That throw happened inside the live classroom, which has no error boundary,
     so it unmounted the entire room - board, chat and all. It stayed hidden for
     as long as the endpoint was 500ing, and appeared the moment real rows
     arrived, i.e. exactly when the feature was supposed to start working. */
  assert.match(podium, /typeof stats === 'function' \? stats\(p\) : stats/, 'calls stats(p) when given a function');
  assert.match(podium, /Array\.isArray\(supplied\)/, 'and only trusts an array');

  /* And the caller must be handing over a function, which is now legal. */
  assert.match(board, /const podiumStats = \(p\) => \[/, 'the classroom passes a function of the player');
  assert.match(board, /stats=\{podiumStats\}/, 'as `stats`');
});

test('a malformed `stats` degrades to the default strip instead of throwing', () => {
  /* Same reasoning, applied to garbage rather than a function: this component
     is mounted inside the classroom, so a bad prop must cost one card, never
     the whole lesson. */
  assert.match(podium, /supplied\.length > 0 \? supplied : fallback/, 'falls back when empty or not an array');
  assert.ok(!/stats \|\| \[/.test(podium), 'the truthy-only `stats || [...]` that let a function through is gone');
});

test('the classroom is still the only caller of the optional podium props', () => {
  /* `stats` only exists for the classroom, so a change here cannot silently
     alter the main leaderboard - but the shared component must keep working
     with no optional props at all, which is how that page calls it. */
  const lb = read('src', 'pages', 'Leaderboard.jsx');
  assert.doesNotMatch(lb, /stats=/, 'the main leaderboard does not pass stats');
  assert.match(podium, /showPeak = true/, 'showPeak still defaults on');
  assert.match(podium, /ribbon \|\| 'Current Champion'/, 'ribbon still has its default text');
});

/* ------------------------------------------------------------------ */

test('a poll backs up the socket, and the panel is defensive about rows', () => {
  assert.match(board, /POLL_MS/, 'has a fallback interval');
  assert.match(board, /inflight\.current/, 'and does not stack overlapping requests');
  assert.match(board, /Array\.isArray\(data\?\.rows\)/, 'tolerates a malformed payload');
  assert.match(board, /function num\(v\)/, 'coerces point values to numbers');
});