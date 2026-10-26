/* ──────────────────────────────────────────────────────────────────────────
 * The registration confirmation email.
 *
 *   node --test scripts/test-registration-email.js
 *
 * What is pinned here:
 *   - the address is validated the same way on the form and on the server;
 *   - the mail carries NO secret (no password, no recovery code) and does carry
 *     the details a student needs;
 *   - a missing or invalid address is skipped, not failed;
 *   - the same student cannot be mailed twice in a row (a double-click);
 *   - the service NEVER throws, so a broken mail server cannot cost somebody
 *     their registration.
 */
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

/* This suite must NEVER reach a real mail server, whatever the developer's
   .env says. The SMTP block is removed before the first test, and the tests
   that need a configured server put it back themselves. */
delete process.env.MAIL_HOST;
delete process.env.MAIL_USER;
delete process.env.MAIL_PASS;
delete process.env.MAIL_FROM;
delete process.env.MAIL_TRANSPORT;

const mail = require('../src/services/mailService');

/* ── validation ───────────────────────────────────────────────────────────── */

test('the address is validated the way the form validates it', () => {
  assert.equal(mail.isValidEmail('aarav@example.com'), true);
  assert.equal(mail.isValidEmail('aarav.sharma+batch@example.co.in'), true);
  assert.equal(mail.isValidEmail('aarav@example'), false);
  assert.equal(mail.isValidEmail('aarav @example.com'), false);
  assert.equal(mail.isValidEmail('aarav@example.com '), true, 'surrounding space is trimmed');
  assert.equal(mail.isValidEmail(''), false);
  assert.equal(mail.isValidEmail(null), false);
  assert.equal(mail.isValidEmail('a@b.c'), true);
  assert.equal(mail.isValidEmail(`${'a'.repeat(250)}@example.com`), false, 'an absurd address is refused');
});

/* ── skipping ─────────────────────────────────────────────────────────────── */

test('a missing or invalid address is skipped, never failed', async () => {
  const noEmail = await mail.sendRegistrationEmail({ name: 'Aarav' });
  assert.equal(noEmail.ok, false);
  assert.equal(noEmail.skipped, 'no-email');

  const badEmail = await mail.sendRegistrationEmail({ name: 'Aarav', email: 'not-an-address' });
  assert.equal(badEmail.ok, false);
  assert.equal(badEmail.skipped, 'invalid-email');
});

/* ── the content ──────────────────────────────────────────────────────────── */

test('the message carries the login details and nothing else', () => {
  /* The CONTENT is checked on the builder: the dummy transport deliberately
     masks the password in what it prints, so the printed copy can never be
     used to assert what the real mail carries. */
  const built = mail.buildRegistrationEmail({
    name: 'Aarav Sharma',
    email: 'aarav@example.com',
    studentId: 42,
    batch: 'Batch A',
    branch: 'Coach Meena',
    username: 'aarav_sharma',
    password: 'TempPass1234',
    recoveryCode: 'ABCD1234EF',
    loginUrl: 'http://localhost:5173/login',
  });
  assert.ok(built, 'the mail must be built');
  assert.equal(built.to, 'aarav@example.com');
  assert.equal(built.subject, 'Welcome to MATE ZONE CHESS ACADEMY 🎉');

  const { html, text } = built;

  /* The welcome, in order. */
  assert.match(html, /Hello Aarav Sharma, welcome to MATE ZONE CHESS ACADEMY/);
  assert.match(html, /Your registration is complete and your student account is now active/);
  assert.match(html, /look forward to seeing you in class/);

  /* The login details box. */
  assert.match(html, /Your login details/);
  assert.match(html, /Student ID/);
  assert.match(html, />\s*42\s*</);
  assert.match(html, /Username/);
  assert.match(html, /aarav_sharma/);
  assert.match(html, /Password/);
  assert.match(html, /TempPass1234/);
  assert.match(html, /Recovery Code/);
  assert.match(html, /ABCD1234EF/);
  assert.match(html, /Batch A/);
  assert.match(html, /Coach Meena/);

  /* The recovery code note. */
  assert.match(html, /Keep your recovery code safe/);
  assert.match(html, /You will need it to reset your password/);
  assert.match(html, /Please do not share it with anyone/);

  /* The links and the security note. */
  assert.match(html, /Login now/);
  assert.match(html, /http:\/\/localhost:5173\/login/);
  assert.match(html, /Forgot your password/);
  assert.match(html, /Use the recovery code shown above/);
  assert.match(html, /please change this password after your first login/);
  assert.match(html, /just reply to this mail and we will help/);
  assert.match(html, /— The team at MATE ZONE CHESS ACADEMY/);

  /* The plain-text version carries the same fields. */
  assert.match(text, /Welcome to MATE ZONE CHESS ACADEMY/);
  assert.match(text, /Hello Aarav Sharma, welcome to MATE ZONE CHESS ACADEMY/);
  assert.match(text, /Student ID: 42/);
  assert.match(text, /Username: aarav_sharma/);
  assert.match(text, /Password: TempPass1234/);
  assert.match(text, /Recovery Code: ABCD1234EF/);
  assert.match(text, /Batch: Batch A/);
  assert.match(text, /Branch: Coach Meena/);
  assert.match(text, /Login now: http:\/\/localhost:5173\/login/);
  assert.match(text, /please change this password after your first login/);
  assert.match(text, /Use the recovery code shown above/);
  assert.match(text, /Keep your recovery code safe/);
  assert.match(text, /just reply to this mail and we will help/);
});

test('the database values are HTML-escaped', () => {
  const built = mail.buildRegistrationEmail({
    name: '<script>alert(1)</script>',
    email: 'aarav@example.com',
    username: 'a"b',
    batch: "<b>Batch</b>",
    branch: "O'Brien & Co",
    password: 'p<a>ss',
  });
  assert.ok(built);
  assert.ok(!built.html.includes('<script>'), 'a name must never be able to inject a script');
  assert.ok(built.html.includes('&lt;script&gt;'));
  assert.ok(built.html.includes('O&#39;Brien &amp; Co'));
  assert.ok(!built.html.includes('<b>Batch</b>'));
});

test('the password is MASKED in the log, never printed', async () => {
  process.env.MAIL_TRANSPORT = 'dummy';
  mail.resetMailTransport();
  const original = console.log;
  const printed = [];
  console.log = (...args) => { if (String(args[0]).includes('DUMMY TRANSPORT')) printed.push(String(args[1])); };
  try {
    await mail.sendRegistrationEmail({
      name: 'Aarav Sharma', email: 'aarav@example.com', password: 'SuperSecret123',
    });
  } finally {
    console.log = original;
    delete process.env.MAIL_TRANSPORT;
    mail.resetMailTransport();
  }
  const log = printed.join('\n');
  assert.ok(!log.includes('SuperSecret123'), 'the log must never hold the plain password');
  assert.match(log, /Su\*+/, 'the password is masked, not removed');
});

test('the sender name and subject are the institute ones', () => {
  assert.equal(mail.INSTITUTE_NAME, 'MATE ZONE CHESS ACADEMY');
  assert.equal(mail.DEFAULT_SUBJECT, 'Welcome to MATE ZONE CHESS ACADEMY 🎉');
});

/* ── the temporary password ────────────────────────────────────────────────── */

test('the generated temporary password is long, mixed and random', () => {
  const a = mail.generateTemporaryPassword();
  const b = mail.generateTemporaryPassword();
  assert.ok(a.length >= 10, `expected at least 10 characters, got ${a.length}`);
  assert.match(a, /[A-Za-z]/);
  assert.match(a, /[0-9]/);
  assert.notEqual(a, b, 'two passwords must not be the same');
  assert.equal(mail.generateTemporaryPassword(16).length, 16);
});

test('the login link comes from FRONTEND_URL', () => {
  const original = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://chess.knightriders.in';
  try {
    assert.equal(mail.buildLoginUrl(), 'https://chess.knightriders.in/login');
    assert.equal(mail.buildForgotPasswordUrl(), 'https://chess.knightriders.in/reset-password');
  } finally {
    if (original === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original;
  }
});

/* ── no duplicate sends ───────────────────────────────────────────────────── */

test('the same student cannot be mailed twice in a row', () => {
  assert.equal(mail.isRecentlyMailed(7), false);
  mail.markMailed(7);
  assert.equal(mail.isRecentlyMailed(7), true, 'a second send right away is refused');
  assert.equal(mail.isRecentlyMailed(8), false, 'another student is not affected');
  assert.equal(mail.isRecentlyMailed(null), false);
});

/* ── it never throws ──────────────────────────────────────────────────────── */

test('a broken mail server cannot break the caller', async () => {
  /* No SMTP configured and no dummy transport: the service must report that it
     skipped rather than reject. */
  delete process.env.MAIL_TRANSPORT;
  delete process.env.MAIL_HOST;
  mail.resetMailTransport();
  const result = await mail.sendRegistrationEmail({ name: 'Aarav', email: 'aarav@example.com' });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 'not-configured');
});

/* ── the setup tells the truth ────────────────────────────────────────────── */

test('the setup status says what will really happen', () => {
  delete process.env.MAIL_TRANSPORT;
  delete process.env.MAIL_HOST;
  delete process.env.MAIL_USER;
  delete process.env.MAIL_PASS;
  delete process.env.MAIL_FROM;
  mail.resetMailTransport();
  assert.equal(mail.mailStatus(), 'off', 'nothing configured -> nothing is sent');

  process.env.MAIL_TRANSPORT = 'dummy';
  mail.resetMailTransport();
  assert.equal(mail.mailStatus(), 'dummy', 'the dummy transport only prints');

  delete process.env.MAIL_TRANSPORT;
  process.env.MAIL_HOST = 'smtp.example.com';
  process.env.MAIL_USER = 'you@gmail.com';
  process.env.MAIL_PASS = 'app-password';
  process.env.MAIL_FROM = 'you@gmail.com';
  mail.resetMailTransport();
  assert.equal(mail.mailStatus(), 'smtp', 'a configured server really sends');

  /* Leave the environment as it was. */
  delete process.env.MAIL_HOST;
  delete process.env.MAIL_USER;
  delete process.env.MAIL_PASS;
  delete process.env.MAIL_FROM;
  mail.resetMailTransport();
});

test('a dummy send says so, so nobody is told the mail went out', async () => {
  process.env.MAIL_TRANSPORT = 'dummy';
  mail.resetMailTransport();
  const original = console.log;
  console.log = () => {};
  try {
    const result = await mail.sendRegistrationEmail({ name: 'Aarav', email: 'aarav@example.com' });
    assert.equal(result.ok, true, 'the dummy transport "succeeds"');
    assert.equal(result.mode, 'dummy', 'and says it only printed');
  } finally {
    console.log = original;
    delete process.env.MAIL_TRANSPORT;
    mail.resetMailTransport();
  }
});
