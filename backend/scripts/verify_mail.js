/* Send a real test email, and say exactly what happened.
 *
 *   npm run test:mail -- you@gmail.com
 *
 * This is the check that tells you whether the mail will actually arrive:
 * it uses the SAME service, the SAME transport and the SAME environment as the
 * registration flow, and it reports the provider's own answer (a Gmail
 * "535-5.7.1" or a "Sender address not owned" comes back here instead of
 * disappearing into a log nobody reads).
 *
 * With MAIL_TRANSPORT=dummy it prints the message instead of sending it - use
 * that to check the content without a mail server.
 */
require('dotenv').config();
const mail = require('../src/services/mailService');

const to = String(process.argv[2] || '').trim();

if (!to) {
  console.error('Usage: npm run test:mail -- you@gmail.com');
  process.exit(1);
}
if (!mail.isValidEmail(to)) {
  console.error(`"${to}" is not a valid email address.`);
  process.exit(1);
}

const status = mail.checkMailSetup();
console.log(`\nmail status: ${status}`);
if (status === 'off') {
  console.error('\nSMTP is not configured, so nothing can be sent.');
  console.error('Add these to backend/.env and restart the server:\n');
  console.error('  MAIL_HOST=smtp.gmail.com');
  console.error('  MAIL_PORT=587');
  console.error('  MAIL_USER=you@gmail.com');
  console.error('  MAIL_PASS=your-16-character-app-password');
  console.error('  MAIL_FROM=you@gmail.com\n');
  process.exit(1);
}

(async () => {
  const result = await mail.sendRegistrationEmail({
    name: 'Test Student',
    email: to,
    studentId: 0,
    batch: 'Test batch',
    branch: 'Test branch',
    username: 'test_student',
    loginUrl: mail.buildLoginUrl(),
  });
  if (!result.ok) {
    console.error(`\nFAILED: ${result.error || result.skipped}`);
    if (result.error && /Sender address|not owned|550|535|553/i.test(result.error)) {
      console.error('\nThat is the classic "From address not owned" refusal:');
      console.error('MAIL_FROM must be the SAME address as MAIL_USER (or an alias of it).');
    }
    if (result.error && /auth|login|invalid credentials|535/i.test(result.error)) {
      console.error('\nThat is a sign-in failure: with Gmail, MAIL_PASS must be an APP PASSWORD');
      console.error('(Google Account -> Security -> 2-Step Verification -> App passwords).');
    }
    process.exit(1);
  }
  console.log(`\nSENT (${result.mode}). Check ${to} - and the SPAM folder if it is not in the inbox.`);
  process.exit(0);
})();
