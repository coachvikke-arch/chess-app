const rateLimit = require('express-rate-limit');

const jsonHandler = (message) => (req, res) => {
  res.status(429).json({ message });
};

// Brute-force protection for the auth endpoints. Login is keyed by IP + identifier
// so one shared username can't be hammered from behind a distributed address.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = String(req.body?.username ?? req.body?.email ?? '').trim().toLowerCase() || 'unknown';
    return `${req.ip}:${id}`;
  },
  handler: jsonHandler('Too many sign-in attempts. Please wait 15 minutes and try again.'),
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many sign-up attempts from this address. Please try again later.'),
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many reset attempts. Please wait 15 minutes and try again.'),
});

/* Per-USER limiter for queueing an automatic analysis.
 *
 * The POST is not a cheap write: it can start a multi-minute engine job, and
 * `?force=1` re-runs a game that is already done. The read (GET) is left on
 * app.js's global limiter because the review page polls it while a job runs.
 *
 * Keyed on the authenticated user id so several students behind one school IP
 * cannot exhaust each other's allowance — and so one student cannot exhaust
 * everyone's. */
const analysisRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.ANALYSIS_REQUEST_RATE_LIMIT || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    /* req.user is populated by authMiddleware, which runs first. */
    const id = req.user?.id ?? req.ip;
    return `analysis:${id}`;
  },
  handler: jsonHandler('Too many analysis requests. Please wait a minute and try again.'),
});

module.exports = {
  loginLimiter, signupLimiter, resetLimiter, analysisRequestLimiter,
};