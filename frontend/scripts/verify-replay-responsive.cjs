/* Verifies the replay board fits inside its container at every viewport.
   Run: npx vite --port 5174   (in another shell)
         node scripts/verify-replay-responsive.cjs
*/
const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');

const APP = process.env.APP_URL || 'http://localhost:5174';
const VIEWPORTS = [
  { w: 1920, h: 1080, name: 'desktop wide' },
  { w: 1440, h: 900, name: 'laptop' },
  { w: 1280, h: 800, name: 'small laptop' },
  { w: 1024, h: 768, name: 'tablet landscape' },
  { w: 820, h: 1180, name: 'tablet portrait' },
  { w: 390, h: 844, name: 'phone' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  let failed = 0;
  let total = 0;

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.w, height: vp.h });
    await page.goto(`${APP}/games/carlsen-nepomniachtchi-2021-g6`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('[data-boardid]', { timeout: 30000 });
    await sleep(900);

    const m = await page.evaluate(() => {
      const panel = document.querySelector('.gm-board-panel');
      const wrap = document.querySelector('.gm-board-wrap');
      const board = document.querySelector('[data-boardid]');
      if (!panel || !wrap || !board) return null;
      const cs = getComputedStyle(panel);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const pw = panel.getBoundingClientRect().width;
      const ww = wrap.getBoundingClientRect().width;
      const bb = board.getBoundingClientRect();
      return {
        padX, panelW: pw, wrapW: ww, boardW: bb.width, boardH: bb.height,
        /* Does the board stick out past the right edge of the viewport? */
        spillsViewport: bb.right > window.innerWidth + 1,
        square: Math.abs(bb.width - bb.height),
      };
    });

    total += 1;
    if (!m) {
      console.log(`  FAIL ${vp.name} (${vp.w}x${vp.h}) :: no board`);
      failed += 1;
      await page.close();
      continue;
    }

    const fitsPanel = m.boardW <= m.panelW - m.padX + 1;
    const fitsWrap = m.boardW <= m.wrapW + 1;
    const ok = fitsPanel && fitsWrap && !m.spillsViewport && m.square <= 2;
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${vp.name.padEnd(18)} panel=${String(Math.round(m.panelW)).padStart(4)} ` +
      `board=${String(Math.round(m.boardW)).padStart(4)}x${String(Math.round(m.boardH)).padStart(4)} ` +
      `fitsPanel=${fitsPanel} fitsWrap=${fitsWrap} noSpill=${!m.spillsViewport} square=${m.square <= 2}`,
    );
    await page.close();
  }

  await browser.close();
  console.log(`\n${total - failed}/${total} viewports render a fully visible board\n`);
  process.exit(failed ? 1 : 0);
})();
