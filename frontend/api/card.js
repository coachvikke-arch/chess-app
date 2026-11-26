/* OG preview tags for the public gold player card.
 *
 * A link-preview crawler never runs the SPA, so /card/:token has to answer
 * with real <meta property="og:*"> tags in the HTML. This function fetches the
 * same public endpoint a scan hits (nothing else), injects those tags into the
 * built index.html and serves it at the scanned URL. Unknown or hidden tokens
 * get the untouched shell, so a private card leaks neither name nor rating.
 */

const API_ORIGIN = process.env.API_ORIGIN || 'https://mate-zone-api-production.up.railway.app';
const TOKEN_RE = /^[A-Za-z0-9]{8,64}$/;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function fetchCard(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${API_ORIGIN}/api/public/card/${encodeURIComponent(token)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.card ? body.card : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function metaTags(card, pageUrl) {
  const title = `${card.name} · MateZone Chess Academy`;
  const parts = [
    typeof card.rating === 'number' ? `Rapid ${card.rating}` : null,
    card.subtitle || null,
    'MateZone Chess Academy',
  ].filter(Boolean);
  const description = parts.join(' · ');
  return [
    '<meta property="og:type" content="profile" />',
    '<meta property="og:site_name" content="MateZone Chess Academy" />',
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(pageUrl)}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<title>${esc(title)}</title>`,
  ].join('');
}

/* The shell already carries the academy's own og/twitter tags. Leaving both
   sets in place makes crawlers pick between a player name and the generic
   site name, so the shell's copies are dropped before ours go in. */
const SHELL_META_RE = /<meta\s+(?:property="og:(?:type|site_name|title|description|url)"|name="twitter:(?:card|title|description)")\s+content="[^"]*"\s*\/?>\s*/gi;

function inject(html, tags) {
  const page = html.replace(SHELL_META_RE, '');
  if (/<title>[^<]*<\/title>/i.test(page)) {
    return page.replace(/<title>[^<]*<\/title>/i, tags);
  }
  return page.replace('</head>', `${tags}</head>`);
}

export default async function handler(req, res) {
  const token = String(req.query.token || '').trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
  const origin = host ? `${proto}://${host}` : '';
  const pageUrl = `${origin}/card/${encodeURIComponent(token)}`;

  let html;
  try {
    const shell = await fetch(`${origin}/index.html`, { cache: 'no-store' });
    html = await shell.text();
    if (!shell.ok) throw new Error('shell');
  } catch {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');

  if (!TOKEN_RE.test(token)) {
    res.statusCode = 404;
    res.end(html);
    return;
  }

  const card = await fetchCard(token);
  if (!card) {
    res.statusCode = 404;
    res.end(html);
    return;
  }

  res.statusCode = 200;
  res.end(inject(html, metaTags(card, pageUrl)));
}
