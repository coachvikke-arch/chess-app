const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const APP = 'http://localhost:5173';
const API = 'http://localhost:5000/api';
(async () => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'verify.sigma@e2e.local', password: 'Verify123!' }) });
  const j = await r.json();
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 300)); });
  p.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
  p.on('response', (x) => { if (x.url().includes('/api/')) console.log('[net]', x.status(), x.url().replace(APP, '')); });
  await p.evaluateOnNewDocument((t, u) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, j.token, j.user);
  await p.goto(`${APP}/student/review`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((x) => setTimeout(x, 2500));
  console.log('--- clicking sigma tab ---');
  const clicked = await p.evaluate(() => {
    const t = [...document.querySelectorAll('button.gr-tab')].find((b) => /Brilliant Moves/i.test(b.textContent || ''));
    if (!t) return 'not-found';
    t.click();
    return t.className;
  });
  console.log('clicked:', clicked);
  await new Promise((x) => setTimeout(x, 5000));
  console.log('cards:', await p.$$eval('.gr-sigma-card', (e) => e.length).catch(() => 0));
  console.log('gr-sigma-screen present:', await p.$$eval('.gr-sigma-screen', (e) => e.length).catch(() => 0));
  console.log('empty msg:', await p.evaluate(() => document.querySelector('.gr-sigma-empty')?.innerText || '(none)'));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });