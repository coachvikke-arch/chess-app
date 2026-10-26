const jwt = require('jsonwebtoken');
const sessionService = require('../services/sessionService');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = header.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  req.user = decoded; // { id, role, name, email, session_id? }

  /* Tokens minted by the session-aware login carry `session_id`. Honour them
     ONLY while that row is still active — this is what makes the 2-device cap
     stick: when a third device signs in, the oldest session is revoked and that
     device's very next request is rejected here. Tokens without a session_id
     (older tokens, service tokens) are left exactly as they were before. */
  if (decoded.session_id) {
    try {
      const active = await sessionService.isSessionActive(decoded.session_id, decoded.id);
      if (!active) {
        return res.status(401).json({
          code: sessionService.SESSION_REVOKED_CODE,
          message: sessionService.SESSION_REVOKED_MESSAGE,
        });
      }
      // Best-effort activity stamp (throttled to ~1 write/minute/session).
      sessionService.touchSessionThrottled(decoded.session_id);
    } catch (err) {
      /* A database hiccup must never lock every signed-in user out. */
      console.warn('session check failed:', err.message);
    }
  }

  return next();
}

module.exports = authMiddleware;
