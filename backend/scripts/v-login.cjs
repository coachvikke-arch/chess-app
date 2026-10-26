/* Verifies the post-login landing route for every role by driving the REAL
   Login form. The auth API is intercepted so no password is needed and the
   component's own redirect logic is what gets exercised. */
const puppeteer = require('C:/Users/MANIVEL M/AppData/Local/Temp/ptst2/node_modules/puppeteer-core');

const CHROME = 'C:/Users/MANIVEL M/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe';

const APP = process.env.APP_URL || 'http://localhost:5420';
let pass = 0;
let fail = 0;

function ok(cond, label, detail) {
  if (cond) { pass += 1; console.log('PASS  ' + label + (detail ? '  :: ' + detail : '')); }
  else { fail += 1; console.log('FAIL  ' + label + (detail ? '  :: ' + detail : '')); }
}

async function loginAs(browser, role) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/auth/login')) {
      return req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'fake.token.value',
          user: { id: 1, name: 'Test ' + role, email: role + '@test.com', role },
        }),
      });
    }
    return req.continue();
  });
  await page.goto(APP + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.type('input[type="email"]', role + '@test.com');
  await page.type('input[type="password"]', 'whatever');
  /* The form submits on Enter (it is a real <form onSubmit>), so no button click. */
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 4000));
  const url = page.url();
  await page.close();
  return url;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const superUrl = await loginAs(browser, 'superadmin');
  ok(superUrl.endsWith('/admin/dashboard'), 'superadmin lands on the dashboard', superUrl);
  ok(!superUrl.includes('/super'), 'superadmin does NOT land on /super', superUrl);

  const adminUrl = await loginAs(browser, 'admin');
  ok(adminUrl.endsWith('/admin/dashboard'), 'coach (admin) unchanged', adminUrl);

  const stuUrl = await loginAs(browser, 'student');
  ok(stuUrl.endsWith('/student/dashboard'), 'student unchanged', stuUrl);

  await browser.close();
  console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
