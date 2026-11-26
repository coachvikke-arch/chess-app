/* The ONE origin rule shared by the HTTP API and the Socket.IO server.
 *
 * Cloudflare Pages serves one production URL per branch, so hard-coding one
 * old host (or guessing preview names) cannot work. Set the exact browser
 * origins in CLIENT_URL (comma-separated). FRONTEND_URL and CORS_ORIGINS are
 * accepted as aliases so older deployments do not silently lose access.
 *
 * localhost is always allowed for development. A request with no Origin header
 * (curl, server-to-server) is never gated.
 */

const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

function configuredOrigins() {
  const raw = [process.env.CLIENT_URL, process.env.FRONTEND_URL, process.env.CORS_ORIGINS]
    .filter(Boolean)
    .join(',');
  return [...new Set(raw.split(',').map((origin) => origin.trim()).filter(Boolean))];
}

function isAllowed(origin) {
  if (!origin) return true;
  return DEV_ORIGINS.has(origin) || configuredOrigins().includes(origin);
}

/* express/cors and socket.io's `cors` option both call this as (origin, cb).
   Refusing says so by omitting the header, exactly like the package default. */
function corsOrigin(origin, callback) {
  callback(null, isAllowed(origin));
}

module.exports = { corsOrigin, isAllowed, configuredOrigins };
