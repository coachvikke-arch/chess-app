/* Sidebar order API (mounted at /api/sidebar).
 *
 *   GET  /            the rank map for every menu  — any signed-in user
 *   PUT  /order       { menu, keys: [...] }       — Super Admin only
 *   POST /order/reset { menu }                    — Super Admin only
 *
 * The read is open to every authenticated user because every one of them has to
 * apply the order, while the writes configure it for all of them and are
 * therefore Super Admin only. */

const service = require('../services/sidebarService');

/* Newer controllers use this so a rejected promise reaches the global error
   handler in app.js instead of hanging the request. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** A nav key is a client-side route. The cap is well above the real list sizes
 *  (23 admin links, 16 student links) and exists only to stop a single request
 *  from writing an unbounded number of rows. */
const MAX_KEYS = 200;
const MAX_KEY_LENGTH = 120;

/** Validate a menu name, answering the request itself on failure. Returns the
 *  menu, or null when the response has already been sent. */
function readMenu(req, res) {
  const menu = String(req.body?.menu ?? '').trim();
  if (!service.isMenu(menu)) {
    res.status(400).json({ message: `menu must be one of: ${service.MENUS.join(', ')}` });
    return null;
  }
  return menu;
}

exports.getOrder = wrap(async (req, res) => {
  res.json({ orders: await service.getRanks() });
});

exports.setOrder = wrap(async (req, res) => {
  const menu = readMenu(req, res);
  if (!menu) return;

  const raw = req.body?.keys;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ message: 'keys must be an array of nav item keys' });
  }
  if (raw.length > MAX_KEYS) {
    return res.status(400).json({ message: `keys may contain at most ${MAX_KEYS} items` });
  }

  /* Trim, drop blanks, and de-duplicate: rank is assigned from array position, so
     a repeated key would otherwise silently consume a position and leave the
     last item unranked. */
  const seen = new Set();
  const keys = [];
  for (const value of raw) {
    if (typeof value !== 'string') {
      return res.status(400).json({ message: 'every key must be a string' });
    }
    const key = value.trim();
    if (!key || key.length > MAX_KEY_LENGTH) {
      return res.status(400).json({ message: `every key must be 1-${MAX_KEY_LENGTH} characters` });
    }
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  const ranks = await service.setOrder(menu, keys, req.user.id);
  res.json({ ok: true, menu, orders: { [menu]: ranks } });
});

exports.resetOrder = wrap(async (req, res) => {
  const menu = readMenu(req, res);
  if (!menu) return;
  await service.resetOrder(menu);
  res.json({ ok: true, menu, orders: { [menu]: {} } });
});
