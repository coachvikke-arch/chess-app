/* Send a real test email through Brevo, and say exactly what happened.
 *
 *   npm run test:mail -- you@example.com
 *
 * This uses the SAME service, the SAME HTTP API and the SAME environment as the
 * registration flow, and prints Brevo's own answer instead of hiding it. With
 * MAIL_TRANSPORT=dummy it prints the message instead of sending it - use that to
 * check the content without an account.
 */
require('dotenv').config();
const mail = require('../src/services/mailService');

const to = String(process.argv[2] || '').trim();

if (!to) {
  console.error('Usage: npm run test:mail -- you@example.com');
  process.exit(1);
}
if (!mail.isValidEmail(to)) {
  console.error(`"${to}" is not a valid email address.`);
  process.exit(1);
}

const status = mail.checkMailSetup();
console.log(`\nmail status: ${status}`);
if (status === 'off') {
  console.error('\nBrevo is not configured, so nothing can be sent.');
  console.error('Add these to backend/.env and restart the server:\n');
  console.error('  BREVO_API_KEY=your-brevo-api-key');
  console.error('  MAIL_FROM_EMAIL=sender@example.com');
  console.error('  MAIL_FROM_NAME="MATE ZONE Chess Academy"\n');
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
    console.error(`\nFAILED${result.status ? ` (HTTP ${result.status})` : ''}: ${result.error || result.skipped}`);
    if (result.error && /sender|not authorized|invalid sender|403/i.test(result.error)) {
      console.error('\nBrevo refuses an unverified sender. Add MAIL_FROM_EMAIL in');
      console.error('Brevo → Senders & Domains → Sender addresses, then confirm it by email.');
    }
    if (result.error && /api key|unauthorized|401/i.test(result.error)) {
      console.error('\nThat is an API-key problem. Copy a fresh key from Brevo → API keys.');
    }
    process.exit(1);
  }
  console.log(`\nACCEPTED (${result.mode}${result.status ? `, HTTP ${result.status}` : ''}). Check ${to} - and the SPAM folder if it is not in the inbox.`);
  process.exit(0);
})();
