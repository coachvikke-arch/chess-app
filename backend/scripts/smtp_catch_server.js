/* A local SMTP server that CATCHES the mail and prints it.
 *
 *   npm run test:smtp            (listens on 127.0.0.1:2525)
 *
 * Then point the app at it and register a student:
 *
 *   MAIL_HOST=127.0.0.1
 *   MAIL_PORT=2525
 *   MAIL_USER=anything
 *   MAIL_PASS=anything
 *   MAIL_FROM=you@gmail.com
 *
 * The message arrives HERE, in full, exactly as it would arrive at a real
 * provider. That proves the whole path - the service, the transport, the
 * headers, the HTML and the text - without a mail server, without a Gmail
 * App Password and without sending anything to anybody.
 *
 * It is a TEST tool: it accepts any credentials and stores nothing.
 */
const net = require('net');

const PORT = Number(process.env.SMTP_CATCH_PORT || 2525);
const HOST = '127.0.0.1';

let session = 0;

const server = net.createServer((socket) => {
  const id = ++session;
  let inData = false;
  const chunks = [];

  const say = (line) => socket.write(`${line}\r\n`);
  say('220 knight-riders.local ESMTP mail catcher');

  socket.on('data', (buf) => {
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);

    for (const raw of lines) {
      if (inData) {
        if (raw === '.') {
          inData = false;
          const message = chunks.join('\n');
          chunks.length = 0;
          console.log('\n──────── MAIL CAUGHT ────────');
          console.log(message);
          console.log('──────── END OF MAIL ────────\n');
          say('250 2.0.0 Ok: queued');
          continue;
        }
        /* Undo dot-stuffing. */
        chunks.push(raw.startsWith('..') ? raw.slice(1) : raw);
        continue;
      }

      const line = raw.trim();
      if (!line) continue;
      const verb = line.split(' ')[0].toUpperCase();

      if (verb === 'EHLO' || verb === 'HELO') {
        say('250-knight-riders.local');
        say('250 AUTH PLAIN LOGIN');
      } else if (verb === 'AUTH') {
        /* Any credentials are accepted - this is a catcher, not a gate. */
        say('235 2.7.0 Authentication successful');
      }
      else if (verb === 'MAIL') say('250 2.1.0 Ok');
      else if (verb === 'RCPT') say('250 2.1.5 Ok');
      else if (verb === 'DATA') { inData = true; say('354 End data with <CR><LF>.<CR><LF>'); }
      else if (verb === 'RSET') say('250 2.0.0 Ok');
      else if (verb === 'NOOP') say('250 2.0.0 Ok');
      else if (verb === 'QUIT') { say('221 2.0.0 Bye'); socket.end(); }
      else say('250 2.0.0 Ok');
    }
  });

  socket.on('error', () => { /* a client that hangs up is normal here */ });
  socket.on('close', () => { /* nothing to clean up */ });
});

server.listen(PORT, HOST, () => {
  console.log(`[smtp-catcher] listening on ${HOST}:${PORT}`);
  console.log('[smtp-catcher] point the app here to see the real mail:');
  console.log(`  MAIL_HOST=${HOST}`);
  console.log(`  MAIL_PORT=${PORT}`);
  console.log('  MAIL_USER=anything   MAIL_PASS=anything');
  console.log('  MAIL_FROM=you@gmail.com   MAIL_TRANSPORT= (empty)\n');
});
