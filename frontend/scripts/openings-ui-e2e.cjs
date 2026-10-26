/* Browser smoke test for the Openings module.
   Renders the three real pages in headless Chrome and asserts the key UI is
   present: library grid + filters, detail board + move list, and practice mode.

   Run:  npx vite --port 5199        (in another shell)
         node scripts/openings-ui-e2e.cjs
*/
const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');

const APP = process.env.APP_URL || 'http://localhost:5199';
const results = [];
const check = (name, cond, extra = '') => {
  results.push(Boolean(cond));
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  :: ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function textOf(page) {
  return page.evaluate(() => document.body.innerText);
}

/** The site links live in the landing-page header ONLY — the in-app Navbar
    deliberately shows no section links, so /courses, /about, etc. must NOT
    advertise them. This asserts that split holds.

    Openings is deliberately absent from the landing header (it is reached from
    the in-app sidebar instead), so it is asserted to be GONE there. */
const LANDING_LINKS = ['/courses', '/about', '/contact'];
const NOT_IN_LANDING = ['/openings'];
const OTHER_PAGES = ['/courses', '/about', '/contact', '/leaderboard', '/announcements', '/daily'];

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });

    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    /* ── 0. navigation lives on the landing page only ── */
    await page.goto(`${APP}/`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(500);
    for (const href of LANDING_LINKS) {
      const found = await page.$$(`header a[href="${href}"]`);
      const label = found.length ? await page.$eval(`header a[href="${href}"]`, (el) => el.textContent.trim()) : '';
      check(`landing header links to ${href}`, found.length > 0, `label: "${label}"`);
    }
    for (const href of NOT_IN_LANDING) {
      const found = await page.$$(`header a[href="${href}"]`);
      check(`landing header omits ${href}`, found.length === 0, `found ${found.length}`);
    }

    /* and nowhere else */
    for (const p of OTHER_PAGES) {
      await page.goto(`${APP}${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(300);
      const stray = await page.$$('header nav a[href^="/"]');
      const strays = stray.length
        ? await page.$$eval('header nav a[href^="/"]', (els) => els.map((e) => e.getAttribute('href')))
        : [];
      check(`${p} header shows no section links`, strays.length === 0, `found: ${strays.join(', ')}`);
    }

    /* The library is no longer linked from the landing header, so it is reached
       directly here — it stays reachable in-app via the sidebar. */
    await page.goto(`${APP}/openings`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(600);
    check('the library is still reachable at /openings', page.url().endsWith('/openings'), page.url());
    check('the library rendered cards', (await page.$$('.op-card')).length > 0);

    /* ── 1. library ── */
    await page.goto(`${APP}/openings`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.op-card', { timeout: 20000 });
    const cards = await page.$$eval('.op-card', (els) => els.length);
    check('library renders opening cards', cards >= 30, `${cards} cards`);

    const libText = await textOf(page);
    // NOTE: innerText honours CSS text-transform, and the stat labels are
    // uppercased — assert on the DOM nodes instead of the rendered text.
    const statCount = await page.$$eval('.op-stat', (els) => els.length);
    check('library has the stats strip', statCount >= 4, `${statCount} stats`);
    const statLabels = await page.$$eval('.op-stat-label', (els) => els.map((e) => e.textContent.trim()));
    check(
      'stats cover learned / accuracy / streak',
      statLabels.some((t) => /learned/i.test(t)) &&
        statLabels.some((t) => /accuracy/i.test(t)) &&
        statLabels.some((t) => /streak/i.test(t)),
      statLabels.join(' | '),
    );
    check('library has filter groups', await page.$('.op-filters') !== null);
    check('library shows family badges', await page.$('.op-badge') !== null);

    /* search */
    await page.type('.op-search-input', 'sicilian');
    await sleep(400);
    const searchCards = await page.$$eval('.op-card', (els) => els.length);
    check('search narrows the grid', searchCards > 0 && searchCards < cards, `${searchCards} results`);
    check('search finds the Najdorf', (await textOf(page)).includes('Najdorf'));

    /* clear + colour filter */
    await page.click('.op-search-clear');
    await sleep(300);
    const whiteBtn = await page.$$('.op-toggle');
    await whiteBtn[1].click(); // "♔ White"
    await sleep(400);
    const whiteOnly = await page.$$eval('.op-card .op-card-name', (els) => els.map((e) => e.innerText));
    check('colour filter works', whiteOnly.length > 0 && whiteOnly.length < cards, `${whiteOnly.length} white`);

    /* ── 2. detail ── */
    await page.goto(`${APP}/openings/sicilian-najdorf`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('[data-boardid]', { timeout: 20000 });
    const detailText = await textOf(page);
    check('detail shows the opening name', detailText.includes('Najdorf'));
    check('detail shows the ECO code', detailText.includes('B90'));
    check('detail shows key ideas', detailText.includes('Key ideas'));
    check('detail shows common traps', detailText.includes('Common traps'));
    check('detail has a practice CTA', detailText.includes('Play against this opening'));

    /* The book move list was removed from the study view — the nav strip under
       the board does the stepping, and the "Why this move" panel does the
       explaining. Assert it stays gone so it cannot creep back in. */
    check('detail omits the book move list', await page.$('.op-movelist') === null);
    const navCount = await page.$eval('.op-nav-count', (el) => el.textContent).catch(() => null);
    check('detail keeps the nav scrubber', !!navCount, navCount || 'no nav count');

    /* react-chessboard renders SVG pieces (not <img>), so probe its own markup. */
    const board = await page.evaluate(() => {
      const root = document.querySelector('[data-boardid]');
      if (!root) return null;
      return { squares: root.querySelectorAll('[data-square]').length, pieces: root.querySelectorAll('[data-piece]').length };
    });
    check(
      'a full 64-square board is rendered',
      board && board.squares === 64,
      board ? `${board.squares} squares, ${board.pieces} pieces` : 'no board',
    );

    /* Step through the line with the nav strip — the move list it replaced is
       gone, so the ▶ button is what advances the board now. */
    const beforePly = await page.$eval('.op-nav-count', (el) => el.textContent);
    await page.click('.op-nav-btn:nth-of-type(3)');
    await sleep(400);
    await page.click('.op-nav-btn:nth-of-type(3)');
    await sleep(500);
    const afterPly = await page.$eval('.op-nav-count', (el) => el.textContent);
    check(
      'stepping forward advances the ply counter',
      beforePly !== afterPly,
      `${beforePly} -> ${afterPly}`,
    );
    // `.op-note-label` is uppercased by CSS, so match against textContent.
    const noteText = await page.$eval('.op-note', (el) => el.textContent);
    check('the selected move shows its explanation', /why this move/i.test(noteText), noteText.slice(0, 60));

    /* ── 3. practice ── */
    await page.goto(`${APP}/openings/sicilian-najdorf/practice`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.op-practice-bar', { timeout: 20000 });
    const practiceText = await textOf(page);
    check('practice screen renders', practiceText.includes('Practice'));
    check('practice shows a turn indicator', /Your move|Bot thinking|Session over/.test(practiceText));
    check('practice shows live metrics', practiceText.includes('theory') && practiceText.includes('streak'));
    check('practice has restart / end controls', practiceText.includes('Restart') && practiceText.includes('End'));
    /* The book move list is deliberately NOT shown in practice: the board is
       driven by the learner's own moves, and the list's highlight tracked the
       book index rather than the position actually reached, so it went out of
       step the moment anyone deviated. The Session log records what was played. */
    check('practice omits the book move list', await page.$('.op-movelist') === null);
    check('practice has no dead move-list buttons', (await page.$$eval('.op-movelist-rows button', (els) => els.length)) === 0);

    /* ── actually play a move: White plays the theory move 1.e4 ── */
    const squares = await page.evaluate(() => {
      const root = document.querySelector('[data-boardid]');
      return root ? [...root.querySelectorAll('[data-square]')].map((el) => el.getAttribute('data-square')) : [];
    });
    check('practice board is interactive', squares.length === 64, `${squares.length} squares`);

    // The Najdorf is a Black opening, so ...c5 is pre-played and White moves now.
    /* Move by REAL trusted clicks (source square, then target square) — the
       board supports both drag and tap-then-tap; dispatching synthetic
       MouseEvents does not reach React's delegated listeners. */
    const drag = async (from, to) => {
      const sq = async (name) => {
        const els = await page.$$(`[data-square="${name}"]`);
        if (!els.length) return null;
        // click the centre so react-chessboard resolves the right square
        const box = await els[0].boundingBox();
        if (!box) return null;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
      };
      const a = await sq(from);
      if (!a) return false;
      await sleep(120);
      const b = await sq(to);
      return Boolean(b);
    };

    /* ── actually play a move ──
       The Najdorf is a BLACK opening, so the engine pre-plays White's 1.e4 and
       the learner's first move is the book's ...c5 (c7-c5). */
    const playedOk = await drag('c7', 'c5');
    await sleep(900);
    check('a legal move can be played', playedOk === true);

    const hint = await page.$eval('.op-hint', (el) => el.textContent).catch(() => '');
    check(
      "playing the theory move (...c5) is confirmed as the main line",
      /correct/i.test(hint) && /main line/i.test(hint),
      hint.slice(0, 70) || '(no hint shown)',
    );
    check('the confirmatory hint uses the positive tone', (await page.$('.op-hint--good')) !== null);

    /* Wait for the bot's reply (setTimeout + book/engine lookup). */
    let logRows = [];
    for (let i = 0; i < 24; i++) {
      logRows = await page.$$eval('.op-ideas li', (els) => els.map((e) => e.textContent)).catch(() => []);
      if (logRows.length >= 2) break;
      await sleep(500);
    }
    check('the bot replied (2 moves logged)', logRows.length >= 2, `${logRows.length} logged`);
    check(
      "the learner's move is logged as the main line",
      /main line/i.test(logRows[1] || ''),
      (logRows[1] || '').slice(0, 40),
    );
    check(
      "the bot's reply is attributed to a source",
      /book reply|engine|master favourite/i.test(logRows[2] || ''),
      (logRows[2] || '').slice(0, 40),
    );

    /* An off-book move must be ACCEPTED with a gentle nudge, never blocked.
       ...e6 is legal but is not the Najdorf's ...d6. */
    const before = await page.$$eval('[data-piece]', (els) => els.length);
    const offBook = await drag('e7', 'e6');
    await sleep(1100);
    const offHint = await page.$eval('.op-hint', (el) => el.textContent).catch(() => '');
    const after = await page.$$eval('[data-piece]', (els) => els.length);
    check('an off-book move is allowed through', offBook === true && after <= before, `${before} -> ${after} pieces`);
    check(
      'an off-book move gets a gentle, non-blocking nudge',
      /isn.t the main line|left the book/i.test(offHint) && /fine|play on|keep playing/i.test(offHint),
      offHint.slice(0, 90) || '(no hint)',
    );

    /* A White opening: the learner moves first from the start position. */
    await page.goto(`${APP}/openings/italian-game-giuoco-piano/practice`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.op-practice-bar', { timeout: 20000 });
    await sleep(900);
    const wDrag = await drag('e2', 'e4');
    await sleep(900);
    const wHint = await page.$eval('.op-hint', (el) => el.textContent).catch(() => '');
    check('a white opening lets the learner move first', wDrag === true && /correct/i.test(wHint), wHint.slice(0, 60));

    /* a bad slug must not crash */
    await page.goto(`${APP}/openings/does-not-exist`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(600);
    check('unknown slug shows a friendly not-found', (await textOf(page)).includes('not found'));

    /* ── console errors ── */
    const realErrors = errors.filter(
      (e) => !/favicon|explorer\.lichess|ERR_|Failed to load resource|401|429|net::/i.test(e),
    );
    check('no unexpected console/page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
