/* The ONE origin rule shared by the HTTP API and the Socket.IO server.

 * Both used to read only CLIENT_URL, and that list drifts from the URLs the app
 * is actually served from: every Vercel preview gets its own
 * `<project>-<hash>.vercel.app` host, and a host missing from the list cannot
 * open a socket — the browser blocks the handshake, so realtime dies in silence
 * while every REST call keeps working through the /api rewrite (a rewrite is
 * same-origin and never needed this header).
 *
 * The deployed origins are therefore matched here instead of pasted into an
 * environment variable nobody remembers to update, and CLIENT_URL stays as the
 * way to add another one (a custom domain, for instance).
 */

const DEPLOYED_FRONTEND = /^https:\/\/mate-zone-chess-academy(?:-[a-z0-9]+)?-chess-app4\.vercel\.app$/;
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

function configuredOrigins() {
  return (process.env.CLIENT_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowed(origin) {
  /* A request with no Origin header is not a browser cross-origin call — curl,
     the mobile app shell, the /api rewrite itself. Those are never gated. */
  if (!origin) return true;
  return DEV_ORIGINS.has(origin) || configuredOrigins().includes(origin) || DEPLOYED_FRONTEND.test(origin);
}

/* express/cors and socket.io's `cors` option both call this as (origin, cb).
   Refusing says so by omitting the header, exactly like the package default. */
function corsOrigin(origin, callback) {
  callback(null, isAllowed(origin));
}

module.exports = { corsOrigin, isAllowed, configuredOrigins };
