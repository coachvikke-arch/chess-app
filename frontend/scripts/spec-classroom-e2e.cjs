/* UI E2E: live-classroom spectate panel — single browser, two tabs, both as the
   student (33). Tab B owns a vs-Computer game; tab A is that student's LIVE
   CLASSROOM (student is re-assigned as coach/instructor of class 50 so the
   instructor-gated SpectateArea renders). Verifies:
     panel renders for instructor · membership-filtered session list ·
     count text · click-through to SpectatorBoard · live move growth ·
     list empties on student exit. */
const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = 'http://localhost:5173';
const BASE = 'http://localhost:5000/api';
const results = [];
function check(name, cond, extra = '') {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  :: ' + extra : ''}`);
}
const poll = async (fn, timeoutMs, intervalMs = 1000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(intervalMs);
  }
  return null;
};
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localHMS = (min, d = new Date()) => {
  const t = new Date(d.getTime() + min * 60000);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
};

/* Self-provision the fixture class: LiveAdmin creates an external+classroom live
   class; the student (33) is made its coach (so isInstructor=true in a single
   browser) and enrolled as the only participant. Cleaned up afterwards. */
async function provisionClass() {
  const login = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'liveadmin@test.com', password: 'Test123!' }),
  });
  const { token } = await login.json();
  const created = await fetch(BASE + '/classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      title: `Spectate E2E ${Date.now() % 100000}`,
      description: 'temporary E2E class',
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
  const { Pool } = require('C:/Users/MANIVEL M/Downloads/Files/chess-academy/backend/node_modules/pg');
  const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Oracle', database: 'chess' });
  await pool.query(`UPDATE classes SET coach_id = 33 WHERE id = $1`, [cls.id]);
  await pool.query(
    `INSERT INTO live_class_participants (live_class_id, user_id, role_in_class, status, joined_at)
     VALUES ($1, 33, 'student', 'joined', NOW())
     ON CONFLICT (live_class_id, user_id) DO UPDATE SET status = 'joined', left_at = NULL`,
    [cls.id]
  );
  await pool.end();
  return cls.id;
}
async function deprovisionClass(usedClassId) {
  try {
    const { Pool } = require('C:/Users/MANIVEL M/Downloads/Files/chess-academy/backend/node_modules/pg');
    const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Oracle', database: 'chess' });
    await pool.query(`DELETE FROM live_class_participants WHERE live_class_id = $1`, [usedClassId]);
    await pool.query(`DELETE FROM chess_game_states WHERE live_class_id = $1`, [usedClassId]);
    await pool.query(`DELETE FROM classes WHERE id = $1`, [usedClassId]);
    await pool.end();
  } catch { /* cleanup best-effort */ }
}

async function main() {
  const usedClassId = await provisionClass();
  console.log('fixture class ' + usedClassId + ' provisioned (external+classroom, coach=33)');
  const browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 45000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
  });
  try {
    const pageB = await browser.newPage();
    await pageB.setViewport({ width: 1280, height: 820 });
    pageB.setDefaultTimeout(30000);

    /* ── Tab B: login as student, start vs-Computer game (student = Black) ── */
    await pageB.goto(APP + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pageB.type('input[type="email"]', 'arrowstudent@test.com');
    await pageB.type('input[type="password"]', 'Test123!');
    await Promise.all([
      pageB.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
      pageB.click('.chess-btn-block'),
    ]);
    await sleep(1500);
    await pageB.goto(APP + '/student/analysis', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    const ex = await poll(async () => {
      try {
        return await pageB.evaluate(() => {
          const s = [...document.querySelectorAll('summary.ab-section-head')].find((x) => x.textContent.includes('vs Computer'));
          if (!s) return false;
          s.click();
          return true;
        });
      } catch { return false; }
    }, 12000, 1200);
    check('B: vs Computer section expandable', !!ex);
    await sleep(600);
    await pageB.evaluate(() => {
      const dl = [...document.querySelectorAll('details.ab-section')].find((d) => d.querySelector('summary')?.textContent.includes('vs Computer'));
      const b = dl ? [...dl.querySelectorAll('button')].find((x) => x.textContent.includes('Start')) : null;
      if (b) b.click();
    });
    await sleep(2500);
    console.log('...step: game started, waiting for session');

    const reg = await poll(async () => {
      const rows = await pageB.evaluate(async () => {
        const t = localStorage.getItem('token');
        const r = await fetch('/api/online/live', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + t } });
        return r.json().catch(() => []);
      });
      return (Array.isArray(rows) ? rows : []).find((s) => s.type === 'computer' && (s.whiteId === 33 || s.blackId === 33) && s.status === 'active') || null;
    }, 15000, 1200);
    check('B: spec:register fired — session for student 33', !!reg, reg ? `key=${reg.key}` : 'not found');

    const yourTurn = await poll(async () => {
      const txt = await pageB.evaluate(() => {
        const dl = [...document.querySelectorAll('details.ab-section')].find((d) => d.querySelector('summary')?.textContent.includes('vs Computer'));
        return dl ? dl.textContent : '';
      });
      return /Your move!/.test(txt);
    }, 25000, 1000);
    check('B: computer completed opening move, student to move', !!yourTurn);

    const bi = await pageB.evaluate(() => {
      const b = document.querySelector('.ab-board-inner .chess-board') || document.querySelector('.ab-board-inner [class*=board]') || document.querySelector('.ab-board-inner .themed-frame');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width };
    });
    check('B: board found for move', !!bi);
    if (bi && yourTurn) {
      const sq = bi.w / 8;
      const f = { x: bi.left + 4 * sq + sq / 2, y: bi.top + 6 * sq + sq / 2 };
      const t = { x: bi.left + 4 * sq + sq / 2, y: bi.top + 4 * sq + sq / 2 };
      await pageB.mouse.move(f.x, f.y);
      await pageB.mouse.down();
      await pageB.mouse.move(t.x, t.y, { steps: 8 });
      await sleep(120);
      await pageB.mouse.up();
      await sleep(4000);
    }

    /* ── Tab A: the student's live classroom (instructor view) ── */
    const pageA = await browser.newPage();
    await pageA.setViewport({ width: 1280, height: 820 });
    pageA.setDefaultTimeout(30000);
    console.log('...opening classroom tab (class ' + usedClassId + ')');
    await pageA.goto(APP + '/live-class/' + usedClassId, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    console.log('...classroom tab loaded, waiting for boot');

    const areaShown = await poll(async () => {
      try { return !!(await pageA.$('.spec-area')); } catch { return false; }
    }, 25000, 1500);
    check('A: SpectateArea panel rendered', !!areaShown);
    await sleep(1000);
    const title = await pageA.evaluate(() => document.querySelector('.spec-area-title')?.textContent || '');
    check('A: panel title', /Spectate students/.test(title), title);

    const item = await poll(async () => {
      try {
        const el = await pageA.$('.spec-area-list .live-session-item');
        if (!el) return null;
        return await el.evaluate((n) => n.textContent);
      } catch { return null; }
    }, 20000, 1500);
    check('A: student session appears in classroom list', !!item, (item || '').slice(0, 140));
    const note = await pageA.evaluate(() => document.querySelector('.spec-area-note')?.textContent || '');
    check('A: count says 1 live game', note.includes('1 live game'), note);
    check('A: row shows RavananMavanda vs Computer', /RavananMavanda/.test(item || '') && /Computer/i.test(item || ''));

    await poll(async () => {
      try {
        await pageA.click('.spec-area-list .live-session-item');
        return true;
      } catch { return false; }
    }, 10000, 1000);
    await sleep(1500);
    check('A: SpectatorBoard opens in classroom', !!(await pageA.$('.spec-overlay[aria-label="Spectate game"]')));
    const subtxt = await pageA.evaluate(() => document.querySelector('.spec-overlay[aria-label="Spectate game"] .spec-sub')?.textContent || '');
    check('A: spectate header names', /RavananMavanda/.test(subtxt) && /Computer/i.test(subtxt), subtxt);
    const m0 = Number(await pageA.evaluate(() => document.querySelector('.spec-moves-count')?.textContent || '0'));
    check('A: SAN move list populated', m0 >= 1, `moves=${m0}`);
    const first = await pageA.evaluate(() => document.querySelector('.spec-move-list .spec-move')?.textContent || '');
    check('A: first SAN move legal opener', /^[KQRNB]?[a-h][1-8]/.test(first), first);
    check('A: both clocks rendered', (await pageA.evaluate(() => document.querySelectorAll('.spec-overlay[aria-label="Spectate game"] .spec-clock').length)) === 2);

    /* student makes a second move (c7-c5) while the coach is watching →
       the computer reply should push the move list forward live */
    const yourTurn2 = await poll(async () => {
      try {
        const txt = await pageB.evaluate(() => {
          const dl = [...document.querySelectorAll('details.ab-section')].find((d) => d.querySelector('summary')?.textContent.includes('vs Computer'));
          return dl ? dl.textContent : '';
        });
        return /Your move!/.test(txt);
      } catch { return false; }
    }, 15000, 1000);
    const bi2 = await pageB.evaluate(() => {
      const b = document.querySelector('.ab-board-inner .chess-board') || document.querySelector('.ab-board-inner [class*=board]') || document.querySelector('.ab-board-inner .themed-frame');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width };
    }).catch(() => null);
    check('B: second student move opportunity', !!yourTurn2 && !!bi2);
    if (yourTurn2 && bi2) {
      const sq = bi2.w / 8;
      const f = { x: bi2.left + 2 * sq + sq / 2, y: bi2.top + 6 * sq + sq / 2 };
      const t = { x: bi2.left + 2 * sq + sq / 2, y: bi2.top + 5 * sq + sq / 2 };
      await pageB.mouse.move(f.x, f.y);
      await pageB.mouse.down();
      await pageB.mouse.move(t.x, t.y, { steps: 8 });
      await sleep(120);
      await pageB.mouse.up();
    }

    const grown = await poll(async () => {
      const n = Number(await pageA.evaluate(() => document.querySelector('.spec-moves-count')?.textContent || '0'));
      return n > m0 ? n : null;
    }, 30000, 1200);
    check('A: move list grows live while coach watches', !!grown, grown ? `moves=${grown}` : '');

    /* ── cleanup: student exits → classroom list empties ── */
    await pageB.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Exit game'));
      if (b) b.click();
    });
    await sleep(2000);
    const emptied = await poll(async () => {
      const empty = await pageA.evaluate(() => !!document.querySelector('.spec-area-empty'));
      const noteTxt = await pageA.evaluate(() => document.querySelector('.spec-area-note')?.textContent || '');
      return empty || /0 live games/.test(noteTxt);
    }, 15000, 1500);
    check('A: finished game leaves classroom live list', !!emptied);

    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  } finally {
    await browser.close().catch(() => {});
    await deprovisionClass(usedClassId);
  }
}

main().catch((e) => { console.error('CLASSROOM E2E ERROR:', e.message); process.exit(1); });