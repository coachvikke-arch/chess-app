const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const APP = 'http://localhost:5173';
const API = 'http://localhost:5000/api';
(async () => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'verify.sigma@e2e.local', password: 'Verify123!' }) });
  const j = await r.json();
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument((t, u) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, j.token, j.user);
  await p.goto(`${APP}/student/review`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((x) => setTimeout(x, 2500));
  const tabs = await p.evaluate(() => [...document.querySelectorAll('button, a')]
    .map((e) => ({ tag: e.tagName, cls: e.className, txt: (e.textContent || '').trim().slice(0, 30) }))
    .filter((e) => /brilliant|sigma|history|analys|review|move/i.test(e.txt) && e.txt.length < 40));
  console.log('candidate tabs:', JSON.stringify(tabs, null, 1));
  const api = [];
  p.on('response', (x) => { if (x.url().includes('/api/sigma')) api.push(`${x.status()} ${x.url()}`); });
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => /brilliant|sigma/i.test(b.textContent || ''));
    if (t) t.click();
  });
  await new Promise((x) => setTimeout(x, 3000));
  console.log('sigma api calls:', JSON.stringify(api));
  console.log('cards:', await p.$$eval('.gr-sigma-card', (e) => e.length).catch(() => 0));
  console.log('screen text:', (await p.evaluate(() => document.body.innerText)).slice(0, 500).replace(/\n+/g, ' | '));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });