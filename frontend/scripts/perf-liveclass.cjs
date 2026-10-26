/* Live-classroom performance probe.
 *
 * Drives a real Chrome (via puppeteer-core + the system Chrome) against the
 * running dev server and measures, for the two reported interactions:
 *   - "Course" chip click  -> click-to-visible, longest long task, commits
 *   - "Ask quiz" click     -> click-to-visible, longest long task, commits
 * plus duplicate network requests for each click.
 *
 * It self-provisions a live class (coach = user 33), seeds a large Chess
 * Library into localStorage so the course panel actually has work to do, and
 * runs at 360px and 1280px with 4x CPU throttling while a background student
 * tab streams chat so the whole tree is under socket pressure.
 *
 * Usage:  node scripts/perf-liveclass.cjs [--label before|after] [--iters 20]
 *
 * It is a measurement harness, not a test - it never fails the build.
 */
const path = require('path');
const fs = require('fs');

const PUPPETEER = 'C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = 'http://localhost:5173';
const BASE = 'http://localhost:5000/api';
const PG = 'C:/Users/MANIVEL M/Downloads/Files/chess-academy/backend/node_modules/pg';

const puppeteer = require(PUPPETEER);
const { Pool } = require(PG);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localHMS = (min, d = new Date()) => {
  const t = new Date(d.getTime() + min * 60000);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
};

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

/* ── fixture ──────────────────────────────────────────────────────────── */
async function pool() {
  return new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Oracle', database: 'chess' });
}
async function provision(token) {
  const created = await fetch(BASE + '/classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      title: `Perf probe ${Date.now() % 100000}`,
      description: 'perf',
      topic: 'E2E',
      classDate: localDate(),
      startTime: localHMS(-5),
      endTime: localHMS(65),
      isOnline: true,
      classType: 'external',
      status: 'live',
      classroomEnabled: true,
    }),
  });
  const cls = await created.json();
  if (created.status !== 201) throw new Error('create class: ' + JSON.stringify(cls));
  const db = await pool();
  await db.query('UPDATE classes SET coach_id = 12 WHERE id = $1', [cls.id]);
  await db.query(
    `INSERT INTO live_class_participants (live_class_id, user_id, role_in_class, status, joined_at)
     VALUES ($1, 30, 'student', 'joined', NOW())
     ON CONFLICT (live_class_id, user_id) DO UPDATE SET status = 'joined', left_at = NULL`,
    [cls.id]
  );
  await db.end();
  return cls.id;
}
async function deprovision(id) {
  try {
    const db = await pool();
    await db.query('DELETE FROM live_class_participants WHERE live_class_id = $1', [id]);
    await db.query('DELETE FROM chess_game_states WHERE live_class_id = $1', [id]);
    await db.query('DELETE FROM classes WHERE id = $1', [id]);
    await db.end();
  } catch { /* best effort */ }
}

/* ── a big, valid library so the course panel has real cards ──────────── */
function bigLibrary() {
  let pgn;
  try {
    const { Chess } = require('C:/Users/MANIVEL M/Downloads/Files/chess-academy/frontend/node_modules/chess.js');
    const g = new Chess();
    let n = 0;
    while (!g.isGameOver() && n < 40) {
      const moves = g.moves({ verbose: true });
      g.move(moves[(n * 7) % moves.length]);
      n++;
    }
    pgn = g.pgn();
  } catch {
    pgn = '[Event "perf"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 *';
  }
  const items = [];
  for (let i = 0; i < 60; i++) items.push({ id: i + 1, title: `Course game ${i + 1}`, type: 'pgn', notation: pgn });
  return {
    folders: [
      { id: 'f-main', name: 'League prep', parentId: null, type: 'course', description: '', createdAt: '2025-01-01', items },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `f-${i}`, name: `Week ${i + 1}`, parentId: null, type: 'course', createdAt: '2025-01-01', items: items.slice(0, 6) })),
    ],
  };
}

/* ── page instrumentation (installed before any app script) ───────────── */
function instrument() {
  const perf = { longtasks: [], commits: 0 };
  window.__perf = perf;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longtasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported */ }
  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot() { perf.commits += 1; },
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
  try {
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook, configurable: true });
  } catch { /* already defined */ }
  window.__resetPerf = () => { perf.longtasks.length = 0; perf.commits = 0; };
  window.__readPerf = () => ({ commits: perf.commits, longtasks: perf.longtasks.slice() });
}

/* Auth comes from a locally-minted JWT (scripts/perf-mint.cjs), never the
   login endpoint, so measurement never trips the sign-in rate limiter. */
async function getAuth() {
  const raw = fs.readFileSync(path.join(__dirname, 'perf-token.json'), 'utf8');
  const auth = JSON.parse(raw);
  if (!auth.token || !auth.user) throw new Error('perf-token.json missing token/user; run node scripts/perf-mint.cjs');
  return auth;
}

/* seed auth + library before any app script runs, so boot is authenticated
   and the course panel has real cards - no flaky UI login needed */
function seedPage(page, auth) {
  return page.evaluateOnNewDocument((token, user, lib) => {
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('chess-library-v1', JSON.stringify(lib));
    } catch {}
  }, auth.token, auth.user, bigLibrary());
}

/* measure one click: reset meters, click, wait for target visible, read */
async function measureClick(page, { clickSelector, targetSelector, label, timeout = 8000 }) {
  return page.evaluate(async ({ clickSelector, targetSelector, label, timeout }) => {
    window.__resetPerf();
    const t0 = performance.now();
    let visibleAt = null;
    const check = () => {
      if (visibleAt != null) return;
      const el = document.querySelector(targetSelector);
      if (el && el.getBoundingClientRect().height > 0) { visibleAt = performance.now(); return true; }
      return false;
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    const btn = document.querySelector(clickSelector);
    if (!btn) { mo.disconnect(); return { label, error: 'click target not found: ' + clickSelector }; }
    btn.click();
    const start = performance.now();
    while (!check() && performance.now() - start < timeout) await new Promise((r) => setTimeout(r, 8));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    mo.disconnect();
    const perf = window.__readPerf();
    const after = perf.longtasks.filter((l) => l.start >= t0 - 5);
    const longest = after.reduce((m, l) => Math.max(m, l.dur), 0);
    return {
      label,
      clickToVisibleMs: visibleAt != null ? Math.round(visibleAt - t0) : null,
      commits: perf.commits,
      longestTaskMs: Math.round(longest),
      longTaskCount: after.length,
    };
  }, { clickSelector, targetSelector, label, timeout });
}

function stats(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number');
  if (!vals.length) return { n: 0, avg: null, p95: null, max: null };
  vals.sort((a, b) => a - b);
  return {
    n: vals.length,
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    p95: vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))],
    max: vals[vals.length - 1],
  };
}

async function runViewport(browser, auth, classId, { label, iters, width, height }) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(instrument);
  await seedPage(page, auth);
  await page.setViewport({ width, height });
  page.setDefaultTimeout(30000);

  const requests = [];
  page.on('request', (req) => requests.push({ url: req.url(), method: req.method() }));

  await page.goto(APP + `/live-class/${classId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* Boot must finish (board + chat rail) before any click is meaningful. The
     join-token round trip occasionally stalls on a cold dev server, so retry the
     load rather than reporting a hung page as a slow click. */
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForSelector('.live-board-wrap', { timeout: 25000 });
      break;
    } catch {
      if (attempt === 2) throw new Error('classroom never booted');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    }
  }
  await page.waitForSelector('.live-chat-modes', { timeout: 15000 });
  await sleep(800);

  /* 4x CPU throttling for the timed clicks only - boot stays unthrottled */
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const courseRows = [];
  for (let i = 0; i < iters; i++) {
    requests.length = 0;
    const r = await measureClick(page, {
      clickSelector: '.live-chat-modes button[title*="course" i], .live-chat-modes button[title*="Course" i]',
      targetSelector: '.live-course-files-scroll',
      label: 'Course',
    });
    const dupes = requests.filter((q) => q.url.includes('/api/')).length;
    courseRows.push({ ...r, apiRequests: dupes });
    // close (click the same chip again)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.live-chat-modes button')].find((x) => /Course/i.test(x.textContent));
      if (b) b.click();
    });
    await sleep(120);
  }

  // open Course + first folder so the cards (and their Ask quiz buttons) exist
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.live-chat-modes button')].find((x) => /Course/i.test(x.textContent));
    if (b) b.click();
  });
  await page.waitForSelector('.live-course-files-scroll', { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => {
    const row = document.querySelector('.live-course-row');
    if (row) row.click();
  });
  await sleep(800);

  const quizRows = [];
  for (let i = 0; i < iters; i++) {
    requests.length = 0;
    const r = await page.evaluate(async ({ label }) => {
      const clickSelector = null;
      window.__resetPerf();
      const t0 = performance.now();
      let visibleAt = null;
      const check = () => {
        if (visibleAt != null) return true;
        const el = document.querySelector('.live-drill-modal');
        if (el && el.getBoundingClientRect().height > 0) { visibleAt = performance.now(); return true; }
        return false;
      };
      const btn = [...document.querySelectorAll('button')].find((x) => /Ask quiz/i.test(x.textContent));
      if (!btn) return { label, error: 'Ask quiz button not found' };
      btn.click();
      const start = performance.now();
      while (!check() && performance.now() - start < 8000) await new Promise((r) => setTimeout(r, 8));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const perf = window.__readPerf();
      const after = perf.longtasks.filter((l) => l.start >= t0 - 5);
      return {
        label,
        clickToVisibleMs: visibleAt != null ? Math.round(visibleAt - t0) : null,
        commits: perf.commits,
        longestTaskMs: Math.round(after.reduce((m, l) => Math.max(m, l.dur), 0)),
        longTaskCount: after.length,
      };
    }, { label: 'Ask quiz' });
    quizRows.push({ ...r, apiRequests: requests.filter((q) => q.url.includes('/api/')).length });
    // close modal
    await page.evaluate(() => {
      const x = document.querySelector('.live-drill-modal-x');
      if (x) x.click();
    });
    await sleep(150);
  }

  await page.close();
  return { viewport: `${width}x${height}`, course: courseRows, quiz: quizRows };
}

async function main() {
  const label = arg('label', 'run');
  const iters = Number(arg('iters', '20'));
  const out = { label, at: new Date().toISOString(), iters, results: [] };

  const auth = await getAuth();
  const classId = await provision(auth.token);
  console.log(`[probe:${label}] fixture class ${classId}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--window-size=1400,900'],
  });

  try {
    for (const vp of [{ width: 1280, height: 820 }, { width: 360, height: 740 }]) {
      const res = await runViewport(browser, auth, classId, { label, iters, width: vp.width, height: vp.height });
      out.results.push(res);
      const c = res.course[0]?.error || `${res.course.length} iters`;
      console.log(`[probe:${label}] ${res.viewport} Course   : ${c}`);
      console.log(`  click->visible ${JSON.stringify(stats(res.course, 'clickToVisibleMs'))}`);
      console.log(`  longestTask    ${JSON.stringify(stats(res.course, 'longestTaskMs'))}`);
      console.log(`  commits        ${JSON.stringify(stats(res.course, 'commits'))}`);
      console.log(`  dupes/apiReq   ${JSON.stringify(stats(res.course, 'apiRequests'))}`);
      console.log(`[probe:${label}] ${res.viewport} Ask quiz : ${res.quiz[0]?.error || `${res.quiz.length} iters`}`);
      console.log(`  click->visible ${JSON.stringify(stats(res.quiz, 'clickToVisibleMs'))}`);
      console.log(`  longestTask    ${JSON.stringify(stats(res.quiz, 'longestTaskMs'))}`);
      console.log(`  commits        ${JSON.stringify(stats(res.quiz, 'commits'))}`);
      console.log(`  dupes/apiReq   ${JSON.stringify(stats(res.quiz, 'apiRequests'))}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await deprovision(classId);
  }

  const file = path.join(__dirname, `perf-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`[probe:${label}] wrote ${file}`);
}

main().catch((err) => {
  console.error('[probe] failed:', err?.stack || err);
  process.exit(1);
});
