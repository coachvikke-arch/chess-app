const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = 'http://localhost:5175';

const { adminToken } = require('./admin-token.cjs');

const SIZES = [
  [1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 720],
  [1100, 800], [1024, 768], [900, 700], [820, 1180], [768, 1024],
  [600, 900], [430, 932], [390, 844], [360, 740], [1280, 500], [1440, 600],
];

const probe = () => {
  const ctrls = document.querySelector('.gm-admin-game-modal .gm-controls');
  const board = document.querySelector('.gm-admin-game-modal [data-boardid]');
  const wrap = document.querySelector('.gm-admin-game-modal .gm-board-wrap');
  const moves = document.querySelector('.gm-admin-game-modal .gm-moves-panel');
  const shell = document.querySelector('.gm-admin-game-modal .gm-replay-shell');
  if (!ctrls || !board) return { missing: true, ctrls: !!ctrls, board: !!board };
  const b = board.getBoundingClientRect();
  const c = ctrls.getBoundingClientRect();
  const w = wrap.getBoundingClientRect();
  const m = moves ? moves.getBoundingClientRect() : null;
  const rows = new Set([...ctrls.children].map((el) => Math.round(el.getBoundingClientRect().top))).size;
  const heights = [...ctrls.children].map((el) => Math.round(el.getBoundingClientRect().height));
  const btns = ctrls.children.length;
  const sr = document.querySelector('.gm-admin-game-modal .gm-status-row');
  return {
    board: [Math.round(b.width), Math.round(b.height)],
    gap: Math.round(c.top - b.bottom),
    overlap: Math.round(b.bottom - c.top),
    ctrlsH: Math.round(c.height),
    rows,
    btnH: heights,
    btns,
    movesW: m ? Math.round(m.width) : null,
    shellOverflow: shell ? Math.round(shell.scrollHeight - shell.clientHeight) : null,
    statusRow: sr ? Math.round(sr.getBoundingClientRect().height) : null,
    hidden: c.height === 0 || c.width === 0,
  };
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const token = await adminToken();
  let failures = 0;
  for (const [w, h] of SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.setCacheEnabled(false);
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.goto(APP + '/admin/gm-games', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    await page.evaluate(() => { const c = document.querySelector('.gm-game-list-card, .gm-admin-game-row, [class*="gm-game"]'); if (c) c.click(); });
    await sleep(1600);
    const r = await page.evaluate(probe);
    const bad = r.missing ? 'MISSING'
      : (r.btns !== 5 ? `BTNS ${r.btns}`
      : (r.overlap > 0 ? `OVERLAP ${r.overlap}px`
      : (r.hidden ? 'HIDDEN'
      : (r.rows > 1 ? `WRAP ${r.rows}rows`
      : ((w > 767 && (r.movesW < 200 || r.shellOverflow > 2)) ? `LAYOUT moves=${r.movesW} ovf=${r.shellOverflow}` : 'ok')))));
    if (bad !== 'ok') failures++;
    console.log(`${String(w).padStart(4)}x${String(h).padEnd(5)} ${bad.padEnd(12)} ${JSON.stringify(r)}`);
    if (bad !== 'ok') await page.screenshot({ path: `bad-${w}x${h}.png` });
    await page.close();
  }
  console.log(failures === 0 ? '\nALL VIEWPORTS PASS' : `\n${failures} FAILING VIEWPORT(S)`);
  await browser.close();
})();
