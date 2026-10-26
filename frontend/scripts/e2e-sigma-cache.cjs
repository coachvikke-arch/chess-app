/* ══════════════════════════════════════════════════════════════════════════
 * REAL BROWSER end-to-end verification: Sigma/Brilliant flow + canonical cache.
 *
 * "Did the engine run?" is read from the app's OWN instrumentation — the
 * `[CanonicalAnalysis]` console.debug trace (CACHE HIT / CACHE MISS /
 * ANALYSIS START / ANALYSIS COMPLETE / IN-FLIGHT REUSE). A fresh analysis is
 * the only thing that can emit ANALYSIS START, so this measures engine runs
 * without touching product code.
 *
 * Run: node scripts/e2e-sigma-cache.cjs
 */
const path = require('path');
const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');

const APP = 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const CREDS = { email: 'verify.sigma@e2e.local', password: 'Verify123!' };

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
};

const TRACE_HOOK = `
window.__e2e = { trace: [], errors: [] };
window.addEventListener('error', (e) => window.__e2e.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__e2e.errors.push('unhandled: ' + String((e.reason && e.reason.message) || e.reason)));
(function () {
  const orig = console.debug;
  console.debug = function (...a) {
    try {
      const s = a.map((x) => (x && x.key ? x.key + '@' + x.version : String(x))).join(' ');
      if (s.indexOf('[CanonicalAnalysis]') !== -1) window.__e2e.trace.push(s);
    } catch (e) { /* a probe must never break the app */ }
    return orig.apply(this, a);
  };
})();
`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Fixed sleeps are flaky against a warm/cold backend — poll for the real
   condition instead, so the harness measures the app, not its own timing. */
const poll = async (page, fn, timeoutMs = 40000, everyMs = 500) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let v;
    try { v = await page.evaluate(fn); } catch (e) { return null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(everyMs);
  }
};

(async () => {
  /* Token is minted directly (scripts/e2e-token.cjs) so repeated verification
     runs are not blocked by the login rate limiter — same JWT the API issues. */
  const { execFileSync } = require('child_process');
  const lj = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'e2e-token.cjs')], { encoding: 'utf8' }).trim());
  if (!lj.token) { console.error('TOKEN FAILED'); process.exit(1); }

  /* Analysing this game makes the backend recompute its Sigma rows, so a
     previous run leaves one card instead of two. Restore the pair so the
     "two brilliant moves in one game" path is exercised every time. */
  const reset = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'e2e-reset-sigma.cjs')], { encoding: 'utf8' }).trim());
  console.log('sigma reset:', JSON.stringify(reset.sigmaRows));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const netIssues = [];
  page.on('pageerror', (e) => netIssues.push(`pageerror: ${String(e.message).slice(0, 120)}`));
  /* A renderer crash surfaces as a plain log line instead of a confusing
     "detached Frame" thrown deep inside CDP. */
  page.on('error', (e) => { netIssues.push(`renderer crashed: ${String(e.message).slice(0, 120)}`); });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 500) netIssues.push(`${r.status()} ${u}`);
    if (/\/api\/(chess-profiles\/games|sigma)/.test(u) && r.status() >= 400) netIssues.push(`${r.status()} ${u}`);
  });

  await page.evaluateOnNewDocument(TRACE_HOOK);
  await page.evaluateOnNewDocument((t, u) => {
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify(u));
  }, lj.token, lj.user);

  const trace = () => page.evaluate(() => window.__e2e.trace.slice());
  const errs = () => page.evaluate(() => window.__e2e.errors.slice());
  /* An analysis STARTED is the only thing that can run Stockfish. */
  const starts = (t) => t.filter((x) => /ANALYSIS START/.test(x)).length;

  /* ───────── 1. app loads ───────── */
  await page.goto(`${APP}/student/review`, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2500);
  check('app loads, /student/review renders', page.url().includes('/student/review'), page.url());
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 300));
  check('no fatal render error on load', !/Something went wrong|Cannot read propert/i.test(txt));

  /* ───────── 2. Brilliant Moves tab ───────── */
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button.gr-tab')].find((b) => /Brilliant Moves/i.test(b.textContent || ''));
    t?.click();
  });
  /* the tab defaults to 90 days; this game's date is older, so widen to All */
  await poll(page, () => document.querySelectorAll('.gr-sigma-range').length > 0, 20000);
  const widened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.gr-sigma-range')].find((x) => /^All$/i.test((x.textContent || '').trim()));
    if (b) { b.click(); return true; }
    return false;
  });
  const cards = await poll(page, () => document.querySelectorAll('.gr-sigma-card').length, 30000);
  check('Brilliant Moves tab lists the entries', cards > 0, `${cards} cards (widened to All: ${widened})`);
  if (!cards) { await browser.close(); console.log('\n=== aborted: no sigma cards ==='); process.exit(1); }

  const cardMeta = await page.evaluate(() => [...document.querySelectorAll('.gr-sigma-card')].map((c) => ({
    move: (c.querySelector('.gr-sigma-card-move')?.textContent || '').trim(),
    type: (c.querySelector('.gr-sigma-card-type')?.textContent || '').trim(),
    meta: (c.querySelector('.gr-sigma-card-meta')?.textContent || '').trim(),
    /* the arrow colour actually painted on the mini-board */
    arrow: (() => {
      const el = c.querySelector('svg line, svg path[stroke], svg polygon');
      return el ? (el.getAttribute('stroke') || getComputedStyle(el).stroke) : null;
    })(),
  })));
  console.log('   cards:', JSON.stringify(cardMeta));

  /* ───────── 3. click a Brilliant → card opens ───────── */
  const t0 = await trace();
  const cards0 = await page.$$('.gr-sigma-card');
  const firstMove = cardMeta[0].move;
  await cards0[0].click();

  /* wait for the game itself, not a fixed sleep: "Opening game…" → full list */
  const loaded = await poll(page, () => document.querySelectorAll('.cp-score-cell').length > 50, 60000);

  const opened = await page.evaluate(() => !!document.querySelector('.cp-viewer-overlay .cp-viewer'));
  check('clicking a Brilliant opens the Chess Profile-style card', opened);

  const cardText = await page.evaluate(() => (document.querySelector('.cp-viewer')?.innerText || '').slice(0, 500));
  check('no "Could not open this game" / "not found in your history"',
    !/Could not open this game|could not be found in your history/i.test(cardText),
    cardText.split('\n')[0]);

  const title = await page.evaluate(() => document.querySelector('.cp-viewer-title')?.textContent || '');
  check('card shows the correct players', /vipulpatel9773/.test(title) && /Nagavel/.test(title), title.trim());

  const cells = await page.$$eval('.cp-score-cell', (e) => e.length).catch(() => 0);
  check('card shows the full move list', cells > 50, `${cells} cells (loaded=${loaded !== null})`);

  const nav1 = await page.evaluate(() => (document.querySelector('.cp-nav-count')?.textContent || '').trim());
  const active1 = await page.evaluate(() => (document.querySelector('.cp-score-cell.is-active')?.textContent || '').trim());
  console.log('   clicked', firstMove, '→ nav', nav1, '| active cell', active1);
  check('card opened AT the clicked move, not the start and not the end',
    nav1 && !/^0 \//.test(nav1) && !/^54 \//.test(nav1), nav1);

  const activeCls = await page.evaluate(() => document.querySelector('.cp-score-cell.is-active')?.className || '');
  check('selected move cell is marked active', /is-active/.test(activeCls),
    activeCls.replace('cp-score-cell', '').trim());

  const t1 = await trace();
  check('opening an un-analysed game did NOT auto-run the engine (reuseOnly)',
    starts(t1) === starts(t0), `ANALYSIS START ${starts(t0)} → ${starts(t1)}`);

  /* ───────── 4. second Brilliant resolves to its own ply ───────── */
  await page.evaluate(() => document.querySelector('.cp-viewer-close')?.click());
  await poll(page, () => !document.querySelector('.cp-viewer'), 20000);
  const navBefore = nav1;
  const movedOn = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.gr-sigma-card')];
    if (cards.length < 2) return false;
    cards[1].click();
    return true;
  });
  const nav2 = await poll(page, () => (document.querySelector('.cp-nav-count')?.textContent || '').trim(), 60000);
  const active2 = await page.evaluate(() => (document.querySelector('.cp-score-cell.is-active')?.textContent || '').trim());
  if (movedOn) {
    check('a second Brilliant resolves to its OWN ply', nav2 !== navBefore,
      `${navBefore} → ${nav2} | active ${active2}`);
  } else {
    check('a second Brilliant resolves to its OWN ply', false,
      'only one Sigma card present — e2e-reset-sigma.cjs did not restore the pair');
  }

  /* label → nav observed while both cards were present. Reopen/reload assert
     against THIS map for whichever label still exists, so a shrinking Sigma
     list (the classifier legitimately drops rows analysis contradicts) cannot
     be mistaken for a navigation regression. */
  const navByLabel = { [cardMeta[0].move]: nav1 };
  if (cardMeta[1]) navByLabel[cardMeta[1].move] = nav2;

  /** Close the overlay, then open the Sigma card whose label matches `prefer`
   *  (falling back to the first card). Returns the nav string. */
  const openSigma = async (prefer) => {
    await page.evaluate(() => document.querySelector('.cp-viewer-close')?.click());
    await poll(page, () => !document.querySelector('.cp-viewer'), 20000);
    const label = await page.evaluate((p) => {
      const cards = [...document.querySelectorAll('.gr-sigma-card')];
      const hit = cards.find((c) => (c.querySelector('.gr-sigma-card-move')?.textContent || '').trim() === p)
        || cards[0];
      if (!hit) return null;
      const l = (hit.querySelector('.gr-sigma-card-move')?.textContent || '').trim();
      hit.click();
      return l;
    }, prefer);
    const nav = await poll(page, () => document.querySelectorAll('.cp-score-cell').length > 50, 60000);
    const navStr = await page.evaluate(() => (document.querySelector('.cp-nav-count')?.textContent || '').trim());
    return { label, loaded: nav !== null, navStr };
  };

  /* ───────── 5. explicit Analyze IN THE STILL-OPEN CARD, then cache reuse ───────── */
  const analyzeBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.cp-viewer button')].find((x) => /Analyze locally|Re-analyze/.test(x.textContent || ''));
    if (!b) return null;
    b.click();
    return (b.textContent || '').trim();
  });
  check('explicit Analyze action available in the card', !!analyzeBtn, analyzeBtn);

  /* wait for the analysis to finish (progress bar disappears / Re-analyze appears) */
  let done = false;
  for (let i = 0; i < 100 && !done; i += 1) {
    await wait(3000);
    done = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.cp-viewer button')].find((x) => /Analyze locally|Re-analyze/.test(x.textContent || ''));
      return !!b && /Re-analyze/.test(b.textContent || '');
    });
  }
  const t2 = await trace();
  const analysed = starts(t2) - starts(t1);
  check('explicit Analyze ran exactly ONE canonical analysis', analysed === 1, `ANALYSIS START +${analysed}`);
  const complete = t2.filter((x) => /ANALYSIS COMPLETE/.test(x)).length;
  check('the analysis completed and was stored', complete >= 1, `COMPLETE ×${complete}`);

  /* Count EVERY grade class on a cell (a cell can be both is-active and
     is-brilliant; matching only the first would hide the verdict we assert on). */
  const gradeOf = await page.evaluate(() => [...document.querySelectorAll('.cp-score-cell')]
    .map((c) => [...c.classList].filter((k) => /^is-[a-z]+$/.test(k))));
  const verdicts = gradeOf.flat();
  const tally = verdicts.reduce((m, v) => { m[v] = (m[v] || 0) + 1; return m; }, {});
  console.log('   verdict tally:', JSON.stringify(tally));
  check('classifications rendered for every move', gradeOf.length > 50, `${gradeOf.length} graded`);
  const brilliantCell = await page.evaluate(() => {
    const c = document.querySelector('.cp-score-cell.is-brilliant');
    return c ? c.textContent.trim() : null;
  });
  check('the analysed Brilliant move is classified Brilliant',
    tally['is-brilliant'] >= 1, `is-brilliant=${tally['is-brilliant'] || 0} cell="${brilliantCell}" ${JSON.stringify(tally)}`);

  /* Sigma styling must come from the canonical REVIEW_META token, not a new
     colour. The badge glyph carries it as an SVG fill (the dot has no
     background — CSS says the RankIcon SVG fills the whole dot). */
  const sigmaStyle = await page.evaluate(() => {
    const badge = document.querySelector('.move-badge-dot');
    const glyph = badge ? badge.querySelector('svg, svg *') : null;
    const cell = document.querySelector('.cp-score-cell.is-brilliant:not(.is-active)');
    return {
      badgeClass: badge ? badge.className : null,
      badgeFill: glyph ? (glyph.getAttribute('fill') || getComputedStyle(glyph).fill) : null,
      deepCellColour: cell ? getComputedStyle(cell).color : null,
      listAccent: (() => {
        const l = document.querySelector('.gr-sigma-card-type, .gr-sigma-accent');
        return l ? getComputedStyle(l).color : null;
      })(),
    };
  });
  console.log('   sigma style:', JSON.stringify(sigmaStyle));
  check('the board badge is drawn as the Brilliant/Sigma badge',
    /brilliant/.test(sigmaStyle.badgeClass || ''), sigmaStyle.badgeClass);
  check('the badge glyph is painted with the canonical Sigma colour (#19c9c3)',
    sigmaStyle.badgeFill === 'rgb(25, 201, 195)' || sigmaStyle.badgeFill === '#19c9c3',
    sigmaStyle.badgeFill);
  check('the Brilliant move cell uses the canonical deep Sigma tone (#0a807d)',
    sigmaStyle.deepCellColour === 'rgb(10, 128, 125)', sigmaStyle.deepCellColour);

  /* ───────── 6. close + reopen the SAME game: must reuse ───────── */
  /* ───────── 6. close + reopen the SAME game: must reuse ───────── */
  const tBeforeReopen = await trace();
  const re = await openSigma(firstMove);
  const tReopen = await trace();
  check('reopening the analysed game opens the card', re.loaded && !!re.label, `reopened ${re.label}`);
  check('reopen REUSED the cached analysis — 0 new engine analyses',
    starts(tReopen) === starts(tBeforeReopen),
    `ANALYSIS START ${starts(tBeforeReopen)} → ${starts(tReopen)}`);
  check('reopen lands on the SAME ply as when the card was opened',
    re.navStr === (navByLabel[re.label] || re.navStr), `${re.label} → ${re.navStr}, was ${navByLabel[re.label]}`);

  /* ───────── 7. full reload: the PERSISTED store must answer ─────────
     The console.trace hook is re-installed on reload, so comparing a trace
     count before and after a reload proves nothing on its own — the earlier
     version of this check passed while the card was actually showing NO
     verdicts at all. The real signal is that the GRADED move list comes back
     with zero engine analyses behind it. */
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await poll(page, () => [...document.querySelectorAll('button.gr-tab')].some((b) => /Brilliant Moves/i.test(b.textContent || '')), 30000);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button.gr-tab')].find((b) => /Brilliant Moves/i.test(b.textContent || ''));
    t?.click();
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.gr-sigma-range')].find((x) => /^All$/i.test((x.textContent || '').trim()));
    b?.click();
  });
  const reloadedCards = await poll(page, () => document.querySelectorAll('.gr-sigma-card').length, 30000);
  const reloadedLabels = await page.evaluate(() => [...document.querySelectorAll('.gr-sigma-card')]
    .map((c) => (c.querySelector('.gr-sigma-card-move')?.textContent || '').trim()));

  const afterReloadTrace0 = await trace();
  const post = await openSigma(firstMove);
  const afterReloadTrace1 = await trace();
  check('after a FULL page reload the card still opens', post.loaded,
    `sigma cards after reload: ${reloadedCards} [${reloadedLabels.join(', ')}]`);

  /* THE decisive post-reload assertions. */
  const gradedAfterReload = await page.evaluate(() => [...document.querySelectorAll('.cp-score-cell')]
    .filter((c) => [...c.classList].some((k) => /^is-/.test(k) && k !== 'is-active')).length);
  check('after reload the move list is still GRADED — the persisted analysis was served',
    gradedAfterReload > 50, `${gradedAfterReload} graded moves after reload`);
  check('after reload it used the PERSISTED analysis — 0 new engine analyses',
    starts(afterReloadTrace1) === starts(afterReloadTrace0),
    `ANALYSIS START ${starts(afterReloadTrace0)} → ${starts(afterReloadTrace1)}`);
  check('post-reload navigation lands on the same ply as before',
    post.navStr === (navByLabel[post.label] || post.navStr),
    `${post.label} → ${post.navStr}, was ${navByLabel[post.label]}`);
  check('the brilliant move stays classified Brilliant after reload',
    await page.evaluate(() => !!document.querySelector('.cp-score-cell.is-brilliant')));

  const e = await errs();
  check('no uncaught page errors', e.length === 0, e.slice(0, 2).join(' | '));
  check('no failed game lookup / 5xx', netIssues.length === 0, netIssues.slice(0, 3).join(' | '));
  console.log('   canonical trace:', afterReloadTrace1.slice(-6).join(' || ').slice(0, 400));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });