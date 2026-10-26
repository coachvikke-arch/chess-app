/* Verifies the replay board is fully visible: the rendered square must fit
   inside its panel's content box, with no clipping on any axis.
   Run: npx vite --port 5174   (in another shell)
         node scripts/verify-replay-board.mjs
*/
const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');

const APP = process.env.APP_URL || 'http://localhost:5174';
const results = [];
const check = (name, cond, extra = '') => {
  results.push(Boolean(cond));
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  :: ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(`${APP}/games/carlsen-nepomniachtchi-2021-g6`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-boardid]', { timeout: 30000 });
  await sleep(1200);

  const m = await page.evaluate(() => {
    const panel = document.querySelector('.gm-board-panel');
    const wrap = document.querySelector('.gm-board-wrap');
    const board = document.querySelector('[data-boardid]');
    if (!panel || !wrap || !board) return null;
    const cs = getComputedStyle(panel);
    const pb = panel.getBoundingClientRect();
    const wb = wrap.getBoundingClientRect();
    const bb = board.getBoundingClientRect();
    return {
      padX: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
      panelW: pb.width,
      wrapW: wb.width,
      boardW: bb.width,
      boardH: bb.height,
      panelOverflow: cs.overflow,
      wrapOverflow: getComputedStyle(wrap).overflow,
      /* A cardless panel has no background image and a transparent background. */
      panelBg: cs.backgroundImage === 'none' && cs.backgroundColor === 'rgba(0, 0, 0, 0)',
      /* The panel shrink-wraps, so its supporting chrome must not be wider
         than the board it sits under. */
      progressW: document.querySelector('.gm-board-panel .gm-progress')?.getBoundingClientRect().width || 0,
      stripW: document.querySelector('.gm-board-panel .gm-player-strip')?.getBoundingClientRect().width || 0,
    };
  });

  check('replay renders a board panel', !!m);
  if (m) {
    console.log(`      panel ${Math.round(m.panelW)}px (padX ${m.padX}) | board ${Math.round(m.boardW)}x${Math.round(m.boardH)}`);
    check('board fits the panel content box', m.boardW <= m.panelW - m.padX + 1,
      `${Math.round(m.boardW)} <= ${Math.round(m.panelW - m.padX)}`);
    check('board fits the wrap', m.boardW <= m.wrapW + 1, `${Math.round(m.boardW)} <= ${Math.round(m.wrapW)}`);
    check('board is square', Math.abs(m.boardW - m.boardH) <= 2, `${Math.round(m.boardW)}x${Math.round(m.boardH)}`);
    check('board panel does not clip', m.panelOverflow === 'visible', m.panelOverflow);
    check('board wrap does not clip', m.wrapOverflow === 'visible', m.wrapOverflow);
    check('board panel has no card background', m.panelBg === true);
    /* 30% smaller than the original 520px board. Assert the exact target so a
       regression in either direction (too big, or collapsing to the floor) is
       caught, not just "big enough". */
    check('board matches the 30%-smaller target (~364px)', Math.abs(m.boardW - 364) <= 4, `${Math.round(m.boardW)}px`);
    /* Shrinking the square must not leave the chrome overhanging it. */
    check('progress bar is no wider than the board', m.progressW <= m.boardW + 1,
      `${Math.round(m.progressW)} <= ${Math.round(m.boardW)}`);
    check('player strip is no wider than the board', m.stripW <= m.boardW + 1,
      `${Math.round(m.stripW)} <= ${Math.round(m.boardW)}`);
  }

  /* The score sheet must still be a real 3-column grid after the board changes. */
  const score = await page.evaluate(() => {
    const row = document.querySelector('.gm-score-row');
    const cells = row ? [...row.children] : [];
    return {
      rows: document.querySelectorAll('.gm-score-row').length,
      cells: cells.length,
      numWidth: cells[0] ? cells[0].getBoundingClientRect().width : 0,
    };
  });
  check('score sheet renders 136 rows', score.rows === 136, `${score.rows} rows`);
  check('each row has number + white + black', score.cells === 3, `${score.cells} cells`);
  check('number column is fixed-width', score.numWidth > 20, `${Math.round(score.numWidth)}px`);

  /* The cardless board panel sits on a LIGHT background, so its labels and
     button glyphs must be dark. This catches them going invisible. */
  const contrast = await page.evaluate(() => {
    const pick = (sel) => document.querySelector(sel);
    const strong = pick('.gm-board-panel .gm-player-strip strong');
    const label = pick('.gm-board-panel .gm-position-label');
    const btn = pick('.gm-board-panel .gm-controls button');
    const play = pick('.gm-board-panel .gm-controls .gm-play');
    return {
      strong: strong ? getComputedStyle(strong).color : null,
      label: label ? getComputedStyle(label).color : null,
      btn: btn ? getComputedStyle(btn).color : null,
      play: play ? getComputedStyle(play).backgroundImage.slice(0, 30) : null,
      playColor: play ? getComputedStyle(play).color : null,
      glyphs: [...document.querySelectorAll('.gm-board-panel .gm-controls button')]
        .map((b) => b.textContent.trim()),
    };
  });
  console.log(`      labels: ${contrast.strong} / ${contrast.label}`);
  console.log(`      buttons: ${contrast.btn}  glyphs=${JSON.stringify(contrast.glyphs)}`);
  console.log(`      autoplay: fill="${contrast.play}" text=${contrast.playColor}`);

  /* A near-white foreground on a near-white page is invisible, so require the
     luminance to be clearly dark. */
  const lum = (rgb) => {
    const m = (rgb || '').match(/\d+(\.\d+)?/g);
    if (!m) return null;
    const [r, g, b] = m.slice(0, 3).map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  const strongLum = lum(contrast.strong);
  const labelLum = lum(contrast.label);
  const btnLum = lum(contrast.btn);
  check('player name is dark enough to read', strongLum !== null && strongLum < 0.5, `lum ${strongLum?.toFixed(2)}`);
  check('position label is dark enough to read', labelLum !== null && labelLum < 0.6, `lum ${labelLum?.toFixed(2)}`);
  check('control buttons are dark enough to read', btnLum !== null && btnLum < 0.6, `lum ${btnLum?.toFixed(2)}`);
  check('all five control buttons have a glyph', contrast.glyphs.length === 5
    && contrast.glyphs.every((g) => g.length > 0), JSON.stringify(contrast.glyphs));
  /* The auto-play button sits on a dark gradient, so it must keep a light label
     and a gradient fill — a generic button rule once repainted it white-on-white. */
  check('auto-play button keeps its gradient fill',
    /gradient/.test(contrast.play || ''), contrast.play || 'none');
  const playLum = lum(contrast.playColor);
  check('auto-play label is light on its dark fill', playLum !== null && playLum > 0.7,
    `lum ${playLum?.toFixed(2)}`);

  /* --- Player sides must match the board orientation ------------------------
     The board is rendered from White's side by default, which puts BLACK's
     pieces at the TOP. The strips label the players at the top and bottom of
     the board, so with the default view the top strip has to be the Black
     player. This previously named White on top — inverting the board on every
     game. */
  const readSides = () => page.evaluate(() => {
    const strips = [...document.querySelectorAll('.gm-board-panel .gm-player-strip')];
    return {
      top: strips[0]?.textContent.replace(/\s+/g, ' ').trim() || null,
      bottom: strips[1]?.textContent.replace(/\s+/g, ' ').trim() || null,
      topIsBlack: !!strips[0]?.querySelector('.gm-dot-black'),
      bottomIsWhite: !!strips[1]?.querySelector('.gm-dot-white'),
    };
  });

  const def = await readSides();
  console.log(`      default top    : "${def.top}" blackDot=${def.topIsBlack}`);
  console.log(`      default bottom : "${def.bottom}" whiteDot=${def.bottomIsWhite}`);
  check('default view: top strip is the Black player', def.topIsBlack, def.top);
  check('default view: bottom strip is the White player', def.bottomIsWhite, def.bottom);

  const flipBtn = await page.$('.gm-flip');
  check('a flip control is offered', !!flipBtn);
  let flipped = null;
  if (flipBtn) {
    await flipBtn.click();
    await sleep(600);
    flipped = await readSides();
    console.log(`      flipped top    : "${flipped.top}"`);
    console.log(`      flipped bottom : "${flipped.bottom}"`);
    /* Flipping to Black's side puts White at the top, and the strips must
       follow the board rather than stay put. */
    check('flipping swaps the strips to follow the board',
      flipped.topIsBlack === false && flipped.bottomIsWhite === false, flipped.top);
    /* And it must be a toggle, not a one-way trip. */
    await page.click('.gm-flip');
    await sleep(600);
    const back = await readSides();
    check('flipping back restores the default sides', back.topIsBlack && back.bottomIsWhite, back.top);
  }

  /* The decisive check: read the pieces React actually rendered and bucket them
     into VISUAL rows (top→bottom on screen). Algebraic ranks are orientation-
     agnostic and would hide a wrong orientation, so this reads what the eye
     actually sees. data-piece is like "bN" / "wP" — first char is the colour. */
  const visualRows = () => page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-boardid] [data-square]')].map((s) => {
      const r = s.getBoundingClientRect();
      return {
        sq: s.getAttribute('data-square'),
        x: r.left, y: r.top, w: r.width,
        piece: s.querySelector('[data-piece]')?.getAttribute('data-piece') || '',
      };
    });
    const size = cells[0]?.w || 1;
    const bands = [...new Set(cells.map((c) => Math.round(c.y / size)))].sort((a, b) => a - b);
    const row = (b) => cells.filter((c) => Math.round(c.y / size) === b)
      .sort((a, c) => a.x - c.x)
      .map((c) => (!c.piece ? '.' : c.piece[0] === 'w' ? 'W' : 'B')).join('');
    const visual = bands.map(row);
    return { visual, top: visual[0], bottom: visual[visual.length - 1],
      topLeft: cells.filter((c) => Math.round(c.y / size) === bands[0])
        .sort((a, c) => a.x - c.x)[0].sq };
  });

  const seen = await visualRows();
  console.log(`      rendered rows: ${seen.visual.join(' / ')}`);
  check('the board renders 8 visual rows', seen.visual.length === 8, `${seen.visual.length}`);
  check('Black pieces sit at the TOP of the screen', seen.top === 'BBBBBBBB', seen.top);
  check('White pieces sit at the BOTTOM of the screen', seen.bottom === 'WWWWWWWW', seen.bottom);
  check('top-left square on screen is a8', seen.topLeft === 'a8', seen.topLeft);

  const flipBtn2 = await page.$('.gm-flip');
  if (flipBtn2) {
    await flipBtn2.click();
    await sleep(600);
    const rev = await visualRows();
    console.log(`      flipped rows: ${rev.visual.join(' / ')}`);
    check('flipping moves the White pieces to the top', rev.top === 'WWWWWWWW', rev.top);
    check('flipping moves the Black pieces to the bottom', rev.bottom === 'BBBBBBBB', rev.bottom);
    check('a flipped board rotates 180° (h1 at top-left)', rev.topLeft === 'h1', rev.topLeft);
    await page.click('.gm-flip');
    await sleep(600);
  }

  /* The page must not scroll sideways on a phone. The board is sized in JS and
     pinned to the panel, so a sizing bug shows up as horizontal overflow that
     pushes the right-hand control off-screen rather than as a missing button. */
  for (const [w, h] of [[360, 640], [390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(700);
    const ov = await page.evaluate(() => {
      const panel = document.querySelector('.gm-board-panel');
      const btns = [...document.querySelectorAll('.gm-board-panel .gm-controls button')];
      const last = btns[btns.length - 1];
      return {
        docScrollW: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        panelRight: panel ? Math.round(panel.getBoundingClientRect().right) : 0,
        lastBtnRight: last ? Math.round(last.getBoundingClientRect().right) : 0,
        lastBtnW: last ? Math.round(last.getBoundingClientRect().width) : 0,
        btnCount: btns.length,
      };
    });
    check(`${w}px: page does not scroll sideways`,
      ov.docScrollW <= ov.viewport, `${ov.docScrollW} <= ${ov.viewport}`);
    check(`${w}px: all 5 controls are inside the viewport`,
      ov.btnCount === 5 && ov.lastBtnRight <= ov.viewport && ov.lastBtnW > 0,
      `${ov.btnCount} btns, last right ${ov.lastBtnRight} <= ${ov.viewport}`);
  }
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(600);

  await page.screenshot({ path: 'replay-board-check.png' });
  await browser.close();

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
  process.exit(failed ? 1 : 0);
})();


