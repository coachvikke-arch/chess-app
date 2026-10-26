import nodemailer from 'nodemailer';

/* HTTPS mail relay.
 *
 * Railway blocks outbound SMTP (ports 25/465/587) on Hobby/Free plans, while
 * Vercel Functions only block port 25 - so the Express backend cannot reach
 * Gmail directly but this function can. The backend POSTs here instead of
 * talking SMTP; the SMTP credentials live only in this project's env vars.
 *
 * Every call must carry MAIL_RELAY_SECRET (constant-time compared): without it
 * this would be an open relay for anyone who finds the URL.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_CHARS = 500_000;

let transporter = null;

function getTransporter() {
  const host = process.env.MAIL_HOST;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  if (!host || !user || !pass) return null;
  if (!transporter) {
    const port = Number(process.env.MAIL_PORT || 587);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: String(process.env.MAIL_SECURE || '').toLowerCase() === 'true' || port === 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

function isAuthorised(req) {
  const expected = String(process.env.MAIL_RELAY_SECRET || '');
  const given = String(req.headers['x-mail-relay-secret'] || '');
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

function formatFrom() {
  const name = process.env.MAIL_FROM_NAME || 'MATE ZONE CHESS ACADEMY';
  const address = process.env.MAIL_FROM || process.env.MAIL_USER;
  return `"${name}" <${address}>`;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      configured: Boolean(getTransporter()) && Boolean(process.env.MAIL_RELAY_SECRET),
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
  }
  if (!isAuthorised(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorised' });
  }

  const body = readBody(req);
  if (!body) return res.status(400).json({ ok: false, error: 'invalid-json' });

  const to = String(body.to || '').trim();
  if (!to || !EMAIL_RE.test(to) || /[,;]/.test(to)) {
    return res.status(400).json({ ok: false, error: 'invalid-recipient' });
  }
  const subject = String(body.subject || '').trim().slice(0, 200);
  const html = String(body.html || '');
  const text = String(body.text || '');
  if (!subject || (!html && !text)) {
    return res.status(400).json({ ok: false, error: 'missing-content' });
  }
  if (html.length + text.length > MAX_BODY_CHARS) {
    return res.status(413).json({ ok: false, error: 'message-too-large' });
  }

  const t = getTransporter();
  if (!t) return res.status(503).json({ ok: false, error: 'smtp-not-configured' });

  try {
    const info = await t.sendMail({
      from: formatFrom(),
      to,
      subject,
      html: html || undefined,
      text: text || undefined,
    });
    return res.status(200).json({ ok: true, id: info && info.messageId });
  } catch (err) {
    console.error('[mail-relay] send failed:', err && err.message);
    return res.status(502).json({ ok: false, error: (err && err.message) || 'send-failed' });
  }
}
