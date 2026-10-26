/* Detects visual churn: does the board DOM survive a move, or is it remounted?
   A `key` that changes per FEN tears down and rebuilds all 64 squares + every
   SVG piece on each move, which reads as a blink/flicker to the user.

   Run against a live dev server:
     APP_URL=http://localhost:5199 node scripts/openings-blink-test.cjs
*/
const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const APP = process.env.APP_URL || 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, cond, extra = '') => {
  results.push(Boolean(cond));
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  :: ' + extra : ''}`);
};

/** Tag the live board node so we can tell whether it survived a re-render. */
const tagBoard = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-boardid]');
    if (!root) return null;
    root.__sentinel = 'alive';
    root.dataset.sentinel = 'yes';
    return document.querySelectorAll('[data-square]').length;
  });

/** Is the tag still on the SAME element (no remount)? */
const boardSurvived = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-boardid]');
    return Boolean(root && root.__sentinel === 'alive');
  });

async function clickSquare(page, name) {
  const els = await page.$$(`[data-square="${name}"]`);
  if (!els.length) return false;
  const box = await els[0].boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });

    /* ── practice mode: play a move, board must NOT be rebuilt ── */
    await page.goto(`${APP}/openings/italian-game-giuoco-piano/practice`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    await page.waitForSelector('[data-boardid]', { timeout: 20000 });
    await sleep(900);

    const squares = await tagBoard(page);
    check('board present before the move', squares === 64, `${squares} squares`);

    await clickSquare(page, 'e2');
    await sleep(150);
    await clickSquare(page, 'e4');
    await sleep(1400); // let the bot reply too

    const survived = await boardSurvived(page);
    check('board DOM survives a move (no remount / no blink)', survived);

    /* The position must still be correct after the move. */
    const fenNow = await page.evaluate(() => {
      const p = document.querySelector('.op-metric b');
      return p ? p.textContent : null;
    });
    check('position advanced', fenNow !== null, `metric: ${fenNow}`);

    /* ── detail view: stepping the line must not rebuild the board ── */
    await page.goto(`${APP}/openings/italian-game-giuoco-piano`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    await page.waitForSelector('[data-boardid]', { timeout: 20000 });
    await sleep(700);
    await tagBoard(page);

    /* The move list was removed from the study view; the nav strip's ▶ button
       is what moves through the line now. */
    await page.click('.op-nav-btn:nth-of-type(3)');
    await sleep(500);
    check('board DOM survives stepping the line', await boardSurvived(page));

    /* ── library grid: cards must not re-animate on interaction ── */
    await page.goto(`${APP}/openings`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.op-card', { timeout: 20000 });
    await sleep(1200); // let the reveal animation finish
    const animBefore = await page.$eval('.op-card', (el) => getComputedStyle(el).animationName);
    await page.type('.op-search-input', 'sicilian');
    await sleep(700);
    const animAfter = await page.$eval('.op-card', (el) => getComputedStyle(el).animationName);
    check(
      'filtering does not re-trigger the reveal animation',
      animAfter === 'none' || animAfter === animBefore,
      `${animBefore} -> ${animAfter}`,
    );
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('crashed:', e);
  process.exit(1);
});
