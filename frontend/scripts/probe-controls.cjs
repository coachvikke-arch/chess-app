const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const APP = process.env.APP_URL || 'http://localhost:5175';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const probe = () => {
  const panel = document.querySelector('.gm-board-panel');
  const ctrls = document.querySelector('.gm-board-panel .gm-controls');
  const btns = [...document.querySelectorAll('.gm-board-panel .gm-controls button')];
  const board = document.querySelector('[data-boardid]');
  if (!panel || !ctrls) return { missing: true };
  const pr = panel.getBoundingClientRect();
  const cr = ctrls.getBoundingClientRect();
  // find nearest ancestor that clips
  let clipper = null, node = panel.parentElement;
  while (node && node !== document.body) {
    const o = getComputedStyle(node);
    if (o.overflow === 'hidden' || o.overflowY === 'hidden') {
      const r = node.getBoundingClientRect();
      if (cr.bottom > r.bottom + 0.5) clipper = { sel: node.className, panelBottom: Math.round(pr.bottom), ctrlBottom: Math.round(cr.bottom), clipBottom: Math.round(r.bottom) };
      break;
    }
    node = node.parentElement;
  }
  return {
    missing: false,
    btnCount: btns.length,
    panelW: Math.round(pr.width), panelH: Math.round(pr.height),
    ctrlW: Math.round(cr.width), ctrlH: Math.round(cr.height),
    ctrlVisibleH: cr.height, ctrlBottom: Math.round(cr.bottom),
    boardSize: board ? Math.round(board.getBoundingClientRect().width) : null,
    clipper,
    each: btns.map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top) }; }),
  };
};

const measure = () => {
  const panel = document.querySelector('.gm-board-panel');
  const board = document.querySelector('[data-boardid]');
  const col = panel?.parentElement;
  const cs = col ? getComputedStyle(col) : null;
  const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
  return {
    viewport: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    colClientW: col?.clientWidth,
    colPadX: padX,
    available: col ? col.clientWidth - padX : null,
    panelRectW: Math.round(panel.getBoundingClientRect().width),
    panelInlineStyle: panel?.getAttribute('style'),
    boardW: board ? Math.round(board.getBoundingClientRect().width) : null,
    boardRight: board ? Math.round(board.getBoundingClientRect().right) : null,
    /* Which ancestor is actually wider than the viewport? */
    widest: (() => {
      let worst = null;
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 0.5 && (!worst || r.right > worst.right)) {
          worst = { right: Math.round(r.right), w: Math.round(r.width), tag: el.tagName, cls: (el.className || '').toString().slice(0, 60) };
        }
      });
      return worst;
    })(),
    /* Walk up from the board panel recording each box, to find who overflows. */
    chain: (() => {
      const out = [];
      let n = document.querySelector('.gm-board-panel');
      while (n && n !== document.documentElement) {
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        out.push({
          cls: (n.className || '').toString().slice(0, 40),
          left: Math.round(r.left), w: Math.round(r.width), right: Math.round(r.right),
          padL: cs.paddingLeft, padR: cs.paddingRight,
        });
        n = n.parentElement;
      }
      return out;
    })(),
    gridCols: cs?.gridTemplateColumns,
  };
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  for (const [w, h] of [[360, 640], [390, 844], [1440, 900]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/games/carlsen-nepomniachtchi-2021-g6`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('[data-boardid]', { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    console.log(`\n== ${w}x${h}`);
    console.log(JSON.stringify(await page.evaluate(measure), null, 1));
  }
  await browser.close();
})();