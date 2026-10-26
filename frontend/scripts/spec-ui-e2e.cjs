/* UI E2E: spectate a live vs-Computer game on the Play Arena.
   Low-memory friendly: ONE browser, two tabs, both logged in as the student.
   Tab B owns the computer game; tab A opens Live games and watches it. */
const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = 'http://localhost:5173';
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

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const pageB = await browser.newPage();
    await pageB.setViewport({ width: 1280, height: 820 });

    /* ── Tab B: login as student, start a vs-Computer game (student is Black) ── */
    await pageB.goto(APP + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pageB.type('input[type="email"]', 'arrowstudent@test.com');
    await pageB.type('input[type="password"]', 'Test123!');
await Promise.all([
      pageB.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
      pageB.click('.chess-btn-block'),
    ]);
    await sleep(1500);
await pageB.goto(APP + '/student/analysis', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const analysisReadyB = await poll(async () => {
      const ok = await pageB.evaluate(() => [...document.querySelectorAll('summary.ab-section-head')].some((x) => x.textContent.includes('vs Computer')));
      return ok ? true : null;
    }, 20000, 700);
    check('B: analysis page rendered', !!analysisReadyB);
    check('B: vs Computer section expandable', await pageB.evaluate(() => {
      const s = [...document.querySelectorAll('summary.ab-section-head')].find((x) => x.textContent.includes('vs Computer'));
      if (!s) return false;
      s.click();
      return true;
    }));
    await sleep(600);
    const startLabel = await pageB.evaluate(() => {
      const dl = [...document.querySelectorAll('details.ab-section')].find((d) => d.querySelector('summary')?.textContent.includes('vs Computer'));
      const b = dl ? [...dl.querySelectorAll('button')].find((x) => x.textContent.includes('Start')) : null;
      if (!b) return null;
      b.click();
      return b.textContent.trim();
    });
    check('B: clicked Start (vs Computer)', !!startLabel, startLabel || '');
    await sleep(2500);

    const reg = await poll(async () => {
      const rows = await pageB.evaluate(async () => {
        const t = localStorage.getItem('token');
        const r = await fetch('/api/online/live', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + t } });
        return r.json().catch(() => []);
      });
      const found = (Array.isArray(rows) ? rows : []).find((s) => s.type === 'computer' && (s.whiteId === 33 || s.blackId === 33) && s.status === 'active');
      return found ? found : null;
    }, 15000, 1200);
    check('B: spec:register fired — session for student 33 on server', !!reg, reg ? `key=${reg.key}` : 'not found');
    if (reg) check('B: session names correct', `${reg.whiteName} ${reg.blackName}`.includes('RavananMavanda'), `${reg.whiteName} vs ${reg.blackName}`);

    const yourTurn = await poll(async () => {
      const txt = await pageB.evaluate(() => {
        const dl = [...document.querySelectorAll('details.ab-section')].find((d) => d.querySelector('summary')?.textContent.includes('vs Computer'));
        return dl ? dl.textContent : '';
      });
      return /Your move!/.test(txt);
    }, 25000, 1000);
    check('B: computer completed its opening move, student to move', !!yourTurn);

    const boardInfo = await pageB.evaluate(() => {
      const b = document.querySelector('.ab-board-inner .chess-board') ||
        document.querySelector('.ab-board-inner [class*=board]') ||
        document.querySelector('.ab-board-inner .themed-frame');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width };
    });
    check('B: analysis board found for move', !!boardInfo);
    if (boardInfo && yourTurn) {
const sq = boardInfo.w / 8;
      /* black orientation: black pieces sit at the bottom — e-pawn at (col 4, row 6), e5 at (4,4) */
      const from = { x: boardInfo.left + 4 * sq + sq / 2, y: boardInfo.top + 6 * sq + sq / 2 };
      const to = { x: boardInfo.left + 4 * sq + sq / 2, y: boardInfo.top + 4 * sq + sq / 2 };
      await pageB.mouse.move(from.x, from.y);
      await pageB.mouse.down();
      await pageB.mouse.move(to.x, to.y, { steps: 8 });
      await sleep(120);
      await pageB.mouse.up();
      await sleep(4000);
    }

/* ── Tab A: same-origin spectator — Live games → watch ── */
    const pageA = await browser.newPage();
    await pageA.setViewport({ width: 1280, height: 820 });
await pageA.goto(APP + '/student/analysis', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const analysisReadyA = await poll(async () => {
      const ok = await pageA.evaluate(() => [...document.querySelectorAll('summary.ab-section-head')].some((x) => x.textContent.includes('vs Computer')));
      return ok ? true : null;
    }, 20000, 700);
    check('A: analysis page rendered', !!analysisReadyA);
    check('A: Live games button present', !!(await pageA.$('button[title="Spectate live games played by other players"]')));
    await pageA.click('button[title="Spectate live games played by other players"]');
    await sleep(1500);
    check('A: live browser modal opens', !!(await pageA.$('.spec-overlay[aria-label="Live games"]')));

    const item = await poll(async () => {
      const txt = await pageA.evaluate(() => document.querySelector('.spec-overlay[aria-label="Live games"] .live-sessions')?.textContent || '');
      return (await pageA.$('.live-session-item')) ? txt : null;
    }, 20000, 1500);
    check('A: student session appears in live list', !!item, (item || '').slice(0, 120));
    check('A: list shows RavananMavanda vs Computer', /RavananMavanda/.test(item || '') && /Computer/i.test(item || ''));

await pageA.evaluate(() => {
      const items = [...document.querySelectorAll('.spec-overlay[aria-label="Live games"] .live-session-item')];
      const target = items.find((n) => n.textContent.includes('RavananMavanda')) || items[items.length - 1];
      if (target) target.click();
    });
    await sleep(1500);
    check('A: SpectatorBoard opens', !!(await pageA.$('.spec-overlay[aria-label="Spectate game"]')));
    const subtxt = await pageA.evaluate(() => document.querySelector('.spec-overlay[aria-label="Spectate game"] .spec-sub')?.textContent || '');
    check('A: spectate header names', /RavananMavanda/.test(subtxt) && /Computer/i.test(subtxt), subtxt);
    const movesCount = await pageA.evaluate(() => document.querySelector('.spec-moves-count')?.textContent || '0');
    check('A: SAN move list populated', Number(movesCount) >= 1, `moves=${movesCount}`);
const firstMove = await pageA.evaluate(() => document.querySelector('.spec-move-list .spec-move')?.textContent || '');
    check('A: first SAN move is a legal opener', /^[KQRNB]?[a-h][1-8]/.test(firstMove), firstMove);
const clockCount = await pageA.evaluate(() => document.querySelectorAll('.spec-overlay[aria-label="Spectate game"] .spec-clock').length);
    check('A: both clocks rendered', clockCount === 2, `clocks=${clockCount}`);
const sampleClock = () => pageA.evaluate(() => {
      const els = [...document.querySelectorAll('.spec-overlay[aria-label="Spectate game"] .spec-clock')];
      return {
        clocks: els.map((e) => e.textContent),
        activeIdx: els.findIndex((e) => e.classList.contains('spec-clock-run')),
      };
    });
    const samples = [];
    for (let k = 0; k < 8; k++) {
      samples.push(await sampleClock());
      await sleep(700);
    }
    let clockVerdict = null;
    for (let i = 1; i < samples.length && !clockVerdict; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (a.activeIdx !== b.activeIdx) continue;
      if (b.clocks[a.activeIdx] !== a.clocks[a.activeIdx] && b.clocks[1 - a.activeIdx] === a.clocks[1 - a.activeIdx]) {
        clockVerdict = `active idx ${a.activeIdx}: ${a.clocks.join(' / ')} -> ${b.clocks.join(' / ')}`;
      }
    }
    check('A: only the to-move clock ticks while watching (idle clock frozen)', !!clockVerdict, clockVerdict || JSON.stringify(samples));

    const grown = await poll(async () => {
      const n = Number(await pageA.evaluate(() => document.querySelector('.spec-moves-count')?.textContent || '0'));
      return n >= 3 ? n : null;
    }, 30000, 1200);
    check('A: move list grows live (computer reply arrives while watching)', !!grown, grown ? `moves=${grown}` : '');

    /* ── cleanup: student exits → session leaves the live list ── */
    const exitClicked = await pageB.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Exit game'));
      if (!b) return false;
      b.click();
      return true;
    });
    check('B: Exit game button found', exitClicked);
    await sleep(2000);
    const gone = await poll(async () => {
      const txt = await pageA.evaluate(() => document.querySelector('.spec-overlay[aria-label="Live games"] .live-sessions')?.textContent || '');
      return !/RavananMavanda/.test(txt);
    }, 15000, 1500);
    check('A: finished game leaves the live list', !!gone);

    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error('UI E2E ERROR:', e.message); process.exit(1); });
