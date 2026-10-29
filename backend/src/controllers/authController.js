const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const roleMiddleware = require('../middleware/roleMiddleware');
const authMiddleware = require('../middleware/authMiddleware');
const sessionService = require('../services/sessionService');
const { touchLoginStreak } = require('../services/streakService');
const { APP_NAME } = require('../config/brand');
const mailService = require('../services/mailService');
const { normalisePhone } = require('../utils/phone');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/* ── Device identity helpers (concurrent-device cap) ───────────────────────── */

/** Trim + cap a client-supplied string; empty/absent → null. */
function normalise(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Coarse platform guess for the session row when the client did not say. */
function platformFromUserAgent(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '');
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac os|macintosh/i.test(ua)) return 'macos';
  if (/linux/i.test(ua)) return 'linux';
  return null;
}

/** Push `session_revoked` to each bumped device's socket room (optional path). */
function emitSessionRevoked(req, revokedIds, reason = 'revoked') {
  const io = req.app && typeof req.app.get === 'function' ? req.app.get('io') : null;
  sessionService.notifyRevoked(io, revokedIds, reason);
}

/* The one-time recovery code lives in its own module, so the registration
   path and the "resend the welcome mail" path can never disagree about it. */
const { generateRecoveryCode, hashRecoveryCode } = require('../services/recoveryCode');

function sanitizeUsernameBase(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/** Reserve a case-insensitive-unique username. */
async function uniqueUsername(desired, excludeId = null) {
  const base = sanitizeUsernameBase(desired) || `user${Math.floor(Math.random() * 1e6)}`;
  let candidate = base.slice(0, 20);
  let n = 2;
  // Re-check against Discord-style edge cases is unnecessary: the DB index
  // enforces lower(username) uniqueness; this loop keeps backfills friendly.
  for (;;) {
    const r = await db.query(
      `SELECT 1 FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [candidate]
    );
    if (r.rows.length === 0) return candidate;
    candidate = base.slice(0, 14) + '_' + n++;
  }
}

function signToken(user, sessionId = null) {
  const payload = { id: user.id, role: user.role, name: user.name, email: user.email };
  // Session-bound tokens let authMiddleware reject a device that was bumped.
  if (sessionId != null) payload.session_id = sessionId;
  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/** Deterministic starter avatar — same student always gets the same look
 *  until they customize it. Mirrors frontend src/avatar-assets/index.js. */
function defaultAvatarConfig(seed) {
  const pieces = ['king', 'queen', 'knight', 'bishop', 'rook', 'pawn'];
  const colors = ['#e74c3c', '#f1c40f', '#2ecc71', '#4a90d9', '#9b59b6', '#e91e63', '#ff8c42', '#1abc9c', '#2b2b2b', '#f2f0e6'];
  const faces = ['happy', 'laugh', 'wink', 'surprised', 'sleepy', 'determined', 'cool', 'shy'];
  const accessories = ['none', 'partyHat', 'headphones', 'bandana', 'scarf', 'halo', 'propeller', 'crown'];
  const backgrounds = ['#ffd966', '#b6e3f4', '#d0f4de', '#fde2e4', '#e8d5f5', '#fff3b0', 'gradient-sunset', 'gradient-ocean'];
  const s = String(seed || 'student');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  h = Math.abs(h);
  const step = (n) => Math.floor(h / (1 << n)) % 100000;
  return {
    basePiece: pieces[step(0) % pieces.length],
    bodyColor: colors[step(3) % colors.length],
    face: faces[step(5) % faces.length],
    accessory: accessories[step(7) % accessories.length],
    background: backgrounds[step(9) % backgrounds.length],
  };
}

/** Fire-and-forget in-app notification — never breaks the auth flow. */
async function notify(userId, title, message) {
  try {
    await db.query(
      'INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)',
      [userId, title, message]
    );
  } catch (e) {
    console.warn('Failed to create notification:', e.message);
  }
}

/* Where a student signs in. The mail carries this link. */
function buildLoginUrl() {
  const base = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173')
    .replace(/\/+$/, '');
  return `${base}/login`;
}

/**
 * PATCH /api/auth/me/password — set your own password.
 *
 * This is the other half of the welcome mail: the student signs in with the
 * password the academy issued, is sent here, and the flag is cleared. The old
 * password stops working the moment the new one is stored.
 */
exports.changeMyPassword = [authMiddleware, async (req, res) => {
  try {
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query(
      `UPDATE users
          SET password = $1,
              must_change_password = false,
              updated_at = NOW()
        WHERE id = $2`,
      [hashed, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Could not change the password', error: err.message });
  }
}];

exports.register = [
  authMiddleware,
  roleMiddleware('superadmin'),
  async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword, role } = req.body;
    const studentDetails = {
      nickname: req.body.nickname,
      birthdate: req.body.birthdate,
      parentName: req.body.parentName,
      gender: req.body.gender,
      preferredLanguage: req.body.preferredLanguage,
    };

    if (!name || !email) {
      return res.status(400).json({ message: 'Name and email are required' });
    }
    /* The address is validated HERE as well as on the form: the form can be
       bypassed, and a bad address would only be discovered by the mail server
       (or, worse, not at all). */
    if (!mailService.isValidEmail(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    /* The password is OPTIONAL. An admin who leaves it empty gets a random
       temporary one, which is mailed to the student and flagged so they must
       change it at their first sign-in. When the admin DOES set one, it is used
       as it is (and still flagged, so the student owns their own password). */
    const hasPassword = typeof password === 'string' && password.length > 0;
    if (hasPassword && password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }
    if (hasPassword && confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }
    if (req.body.username !== undefined
        && (typeof req.body.username !== 'string' || !USERNAME_RE.test(req.body.username.trim()))) {
      return res.status(400).json({
        message: 'Username must be 3–20 characters and use only letters, numbers and underscores',
      });
    }

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const savedPhone = normalisePhone({
      phone,
      countryCode: req.body.countryCode,
      phoneNumber: req.body.phoneNumber,
    });
    if (savedPhone.error) return res.status(400).json({ message: savedPhone.error });

    /* The plain password lives in this function's memory only: it is hashed
       into the row, mailed to the student and then forgotten. It is never
       stored and never logged. */
    const plainPassword = hasPassword ? password : mailService.generateTemporaryPassword();
    const generatedPassword = !hasPassword;
    const hashed = await bcrypt.hash(plainPassword, 10);
    // Accounts are created only by a super admin; students are never
    // self-registered. The super admin may also create coach (admin) accounts
    // and additional super admin accounts.
    const finalRole = role === 'superadmin' ? 'superadmin' : role === 'admin' ? 'admin' : 'student';

    // Every account needs a username for sign-in. Prefer an explicit one,
    // otherwise derive it from the email local-part.
    const username = await uniqueUsername(req.body.username || email.split('@')[0]);

    /* Mint a recovery code and store only its digest. Self-registration used to
       be the only place this happened, so closing it left every admin-created
       account with no way to reset a forgotten password — /reset-password would
       have rejected them forever. The code is returned ONCE in this response so
       the admin can hand it to the member; it is never retrievable afterwards. */
    const recoveryCode = generateRecoveryCode();

    const userResult = await db.query(
      `INSERT INTO users (name, email, password, username, phone, role, board_theme, piece_set,
                          recovery_code_hash, recovery_code_created_at, must_change_password, country_code)
       VALUES ($1, $2, $3, $4, $5, $6, 'classic-green', 'cburnett', $7, NOW(), $8, $9)
       RETURNING id, name, email, username, phone, country_code, role, board_theme, piece_set, board_frame, created_at`,
      [name, email, hashed, username, savedPhone.phone || null, finalRole, hashRecoveryCode(recoveryCode),
       /* A student starts on the password the ACADEMY issued, so the account is
          flagged: the app sends them to a change-password screen at their
          first sign-in and clears the flag when they do. A coach account is
          signed in by the academy itself, so it is not flagged. */
       finalRole === 'student',
       savedPhone.countryCode || null]
    );
    const user = userResult.rows[0];

    let studentId = null;
    if (finalRole === 'student') {
      const studentResult = await db.query(
        `INSERT INTO students (user_id, nickname, birthdate, parent_name, gender, preferred_language)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          user.id,
          studentDetails.nickname || null,
          studentDetails.birthdate || null,
          studentDetails.parentName || null,
          studentDetails.gender || null,
          studentDetails.preferredLanguage || null,
        ]
      );
      studentId = studentResult.rows[0].id;
      // Auto-generate the default avatar_config (seeded by student id) so no
      // blank placeholder is ever shown.
      const avatarConfig = defaultAvatarConfig(`student_${studentResult.rows[0].id}`);
      await db.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [avatarConfig, user.id]);
      user.avatar_config = avatarConfig;
    }

    const token = signToken(user);

    await notify(
      user.id,
      `Welcome to ${APP_NAME}, ${name}! 🎉`,
      'Your account is ready — your coach created it for you. Use the credentials you were given to sign in.'
    );

    /* ── the confirmation email ──
       Sent AFTER the record is saved, and NOT awaited: a slow or broken mail
       server must not hold (or fail) a registration. The promise is detached and
       every failure is swallowed and logged by the service.
       Only students get it (a coach account is not "registered" with the
       institute in the same sense), and only on CREATION - never on an edit.

       The status reported back is the TRUTH: 'queued' only when a real mail
       server is configured, 'dummy' when the message was merely printed to the
       log, 'skipped' when there is no way to send it. A registration must never
       claim "email sent" when nothing was sent. */
    let emailStatus = 'skipped';
    if (finalRole === 'student') {
      const mode = mailService.mailStatus();
      const canSend = mode === 'smtp' || mode === 'relay';
      emailStatus = canSend ? 'queued' : (mode === 'dummy' ? 'dummy' : 'skipped');
      if (!canSend) {
        console.warn(`[mail] registration email NOT sent (${mode}) for ${user.email}.`);
      } else {
        const mailStudent = {
          name: user.name,
          email: user.email,
          studentId,
          username: user.username,
          /* The plain password, in memory only, for this one message. */
          password: plainPassword,
          /* The one-time recovery code, in memory only, for this one message.
             The database stores only its hash, so this is the only moment it
             can ever be sent. */
          recoveryCode,
          loginUrl: buildLoginUrl(),
        };
        mailService.sendRegistrationEmail(mailStudent)
          .then((result) => {
            if (!result.ok) {
              console.warn('[mail] registration email could not be sent:', result.error || result.skipped);
            }
          })
          .catch((err) => {
            /* The service already swallows its own errors; this is the belt to
               its braces, so a rejection can never become an unhandled one. */
            console.error('[mail] registration email failed:', err && err.message);
          });
      }
    }

    res.status(201).json({
      user,
      token,
      // Plaintext, shown to the admin exactly once so they can pass it on. Only
      // the hash is stored, so it cannot be re-displayed or emailed later.
      recoveryCode,
      /* The generated temporary password, shown ONCE and only when the SERVER
         generated it (the admin chose their own otherwise). It is the fallback
         for the case where the mail could not be delivered: the admin can
         still hand the student their password. */
      ...(generatedPassword ? { temporaryPassword: plainPassword } : {}),
      /* 'queued' = handed to the mail service, 'skipped' = not a student or no
         address. The client uses it for the toast. */
      emailStatus,
      notification: {
        title: `Welcome to ${APP_NAME}, ${name}! 🎉`,
        message: 'Your account is ready — your coach created it for you. Use the credentials you were given to sign in.',
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Registration failed', error: err.message });
  }
  },
];

/* Public self-registration is permanently disabled.
 *
 * This used to be a fully open endpoint: no auth, no invite, no approval — any
 * visitor who POSTed a username and password got a working student account and
 * a signed JWT. The academy is invite-only (a coach creates each account), so
 * that endpoint contradicted the whole model and is kept only as a tombstone
 * that fails closed with a clear message.
 *
 * Account creation now lives in `exports.register` above, which requires a
 * superadmin token. The recovery-code flow below is unchanged and still powers
 * POST /auth/reset-password.
 */
exports.signup = async (req, res) =>
  res.status(403).json({
    message: 'Self-registration is closed. Ask your coach to create an account for you.',
  });

exports.login = async (req, res) => {
  try {
    const identifier = (req.body.username ?? req.body.email ?? '').trim();
    const { password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }
    // Device identity (sent by the client) — drives the 2-device session cap.
    const deviceId = normalise(req.body.device_id ?? req.body.deviceId, 128);
    const deviceName = normalise(req.body.device_name ?? req.body.deviceName, 150);
    const platform = normalise(req.body.platform, 60) || platformFromUserAgent(req);
    // Sign-in accepts a username (the primary identifier) or a legacy email.
    const result = await db.query(
      'SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1)',
      [identifier]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await notify(
        user.id,
        'Invalid password attempt',
        `A sign-in was attempted for your account with an incorrect password. If that was you, double-check your password and try again.`
      );
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Enforce the concurrent-device cap and bind this login to a session row.
    // createSession evicts the oldest device when a third one signs in; the
    // evicted session's token is then refused by authMiddleware.
    const { session, reused, revoked, refreshToken } = await sessionService.createSession({
      userId: user.id,
      deviceId,
      deviceName,
      platform,
    });

    const token = signToken(user, session.id);
    delete user.password;

    // Daily login streak — never allowed to break the auth flow.
    try {
      const ls = await touchLoginStreak(user.id);
      user.login_streak = ls.streak;
      user.last_login = ls.lastLogin;
    } catch (e) {
      user.login_streak = 0;
      user.last_login = null;
    }

    // Attach the student's coach-recommended board theme (admin default) when present.
    if (user.role === 'student') {
      const sr = await db.query(
        `SELECT s.default_board_theme, s.id AS student_id, s.group_id, g.name AS group_name,
                COALESCE(sp.name, gp.name) AS coach_name,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
                                  ORDER BY (c.id = s.coach_id) DESC, c.name)
                  FROM student_coaches sc JOIN users c ON c.id = sc.coach_id
                  WHERE sc.student_id = s.id
                ), '[]'::jsonb) AS coach_names
         FROM students s
         LEFT JOIN groups g ON g.id = s.group_id
         LEFT JOIN users sp ON sp.id = s.coach_id
         LEFT JOIN users gp ON gp.id = g.coach_id
         WHERE s.user_id = $1`,
        [user.id]
      );
      const row = sr.rows[0] || {};
      user.recommended_board_theme = row.default_board_theme || null;
      user.student_id = row.student_id ?? user.student_id ?? null;
      user.group_id = row.group_id ?? user.group_id ?? null;
      user.group_name = row.group_name ?? null;
      user.coach_name = row.coach_name ?? null;
      user.coach_names = Array.isArray(row.coach_names) ? row.coach_names : [];
    }

    await notify(
      user.id,
      `Welcome back, ${user.name}! 👋`,
      'Good to see you again — your classes, puzzles and progress are waiting.'
    );
    // Best-effort: tell any device we just bumped to log out immediately.
    emitSessionRevoked(req, revoked, 'max_devices');
    res.json({
      user,
      token,
      refresh_token: refreshToken,
      session: {
        id: session.id,
        device_id: session.device_id,
        device_name: session.device_name,
        platform: session.platform,
        reused: reused === true,
      },
      // Surfaced so a client could explain "you were signed out on another
      // device" without guessing.
      revoked_sessions: revoked.length,
      notification: {
        title: `Welcome back, ${user.name}! 👋`,
        message: 'Good to see you again — your classes, puzzles and progress are waiting.',
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed', error: err.message });
  }
};

/* Logout now revokes the session row, not just the client's copy of the token.
 * That is what frees a device slot immediately: a signed-out device no longer
 * counts against the 2-device cap. */
exports.logout = async (req, res) => {
  try {
    const sessionId = req.user && req.user.session_id;
    if (sessionId) await sessionService.revokeSession(sessionId);
  } catch (err) {
    console.warn('logout revoke failed:', err.message);
  }
  res.json({ message: 'Logged out' });
};

/* Logout from every device at once (current one included). */
exports.logoutAll = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });
    const revoked = await sessionService.revokeAllSessions(userId);
    emitSessionRevoked(req, revoked, 'logout_all');
    res.json({ message: 'Logged out from all devices', revoked: revoked.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to log out from all devices', error: err.message });
  }
};

/* Exchange a (still-active) refresh token for a fresh access token bound to the
 * SAME session. Rotating here means a stolen refresh token is only ever useful
 * until the next legitimate refresh — and a revoked session can never be
 * refreshed back to life. */
exports.refresh = async (req, res) => {
  try {
    const refreshToken = String(req.body.refresh_token ?? req.body.refreshToken ?? '').trim();
    if (!refreshToken) {
      return res.status(400).json({ message: 'refresh_token is required' });
    }
    const session = await sessionService.findByRefreshToken(refreshToken);
    if (!session) {
      return res.status(401).json({
        code: sessionService.SESSION_REVOKED_CODE,
        message: sessionService.SESSION_REVOKED_MESSAGE,
      });
    }
    const found = await db.query('SELECT * FROM users WHERE id = $1', [session.user_id]);
    const user = found.rows[0];
    if (!user) return res.status(401).json({ message: 'User not found' });

    await sessionService.touchSession(session.id);

    // Rotate: mint a new refresh token for this session, invalidating the old.
    const { refreshToken: rotated } = await sessionService.rotateRefreshToken(session.id);
    const token = signToken(user, session.id);
    res.json({ token, refresh_token: rotated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to refresh token', error: err.message });
  }
};

// Reset a forgotten password using the one-time recovery code issued at signup.
// Responses are deliberately generic: we never reveal whether a username exists
// or whether the code was correct (anti-enumeration).
exports.resetPassword = async (req, res) => {
  try {
    const username = (req.body.username ? String(req.body.username) : '').trim();
    const recoveryCode = req.body.recoveryCode ? String(req.body.recoveryCode).trim().toUpperCase() : '';
    const { newPassword } = req.body;

    if (!username || !recoveryCode || !newPassword) {
      return res.status(400).json({
        message: 'Username, recovery code and new password are required',
      });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }
    if (!/^[A-Z2-9]{10}$/.test(recoveryCode)) {
      return res.status(400).json({ message: 'Recovery code must be 10 characters long' });
    }

    const result = await db.query(
      'SELECT id, recovery_code_hash FROM users WHERE lower(username) = lower($1)',
      [username]
    );
    const user = result.rows[0];
    if (
      user &&
      user.recovery_code_hash &&
      hashRecoveryCode(recoveryCode) === user.recovery_code_hash
    ) {
      const hashed = await bcrypt.hash(newPassword, 10);
      await db.query(
        `UPDATE users
         SET password = $1, recovery_code_hash = NULL, recovery_code_created_at = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [hashed, user.id]
      );
      // A new password invalidates every existing session (all devices).
      const revoked = await sessionService.revokeAllSessions(user.id);
      emitSessionRevoked(req, revoked, 'password_change');
      // One-time code: invalidated on successful use.
    }

    res.json({
      message: 'If the details were correct, your password has been reset. You can now log in with your new password.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Password reset failed', error: err.message });
  }
};

exports.me = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.username, u.phone, u.country_code, u.role, u.profile_image, u.avatar_config, u.board_theme, u.piece_set, u.board_frame, u.created_at,
               u.must_change_password,
               s.default_board_theme AS recommended_board_theme,
               s.id AS student_id, s.group_id, s.active, s.nickname, s.birthdate, s.parent_name,
               s.gender, s.preferred_language, g.name AS group_name,
               COALESCE(cu.name, gc.name) AS coach_name,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
                                 ORDER BY (c.id = s.coach_id) DESC, c.name)
                 FROM student_coaches sc JOIN users c ON c.id = sc.coach_id
                 WHERE sc.student_id = s.id
               ), '[]'::jsonb) AS coach_names
        FROM users u
        LEFT JOIN students s ON s.user_id = u.id
        LEFT JOIN groups g ON g.id = s.group_id
        LEFT JOIN users cu ON cu.id = s.coach_id
        LEFT JOIN users gc ON gc.id = g.coach_id
        WHERE u.id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch profile', error: err.message });
  }
};

exports.updatePreferences = async (req, res) => {
  try {
    const { boardTheme, pieceSet, boardFrame } = req.body;
    if (boardTheme === undefined && pieceSet === undefined && boardFrame === undefined) {
      return res.status(400).json({ message: 'Provide boardTheme, pieceSet and/or boardFrame' });
    }
    /* Coerce to a real boolean rather than trusting the client's JSON — this
       column drives whether the frame renders, so a stray "false" string would
       otherwise silently turn the frame ON. */
    if (boardFrame !== undefined && typeof boardFrame !== 'boolean') {
      return res.status(400).json({ message: 'boardFrame must be a boolean' });
    }

    const fields = [];
    const params = [req.user.id];

    if (boardTheme !== undefined) {
      params.push(boardTheme);
      fields.push(`board_theme = $${params.length}`);
    }
    if (pieceSet !== undefined) {
      params.push(pieceSet);
      fields.push(`piece_set = $${params.length}`);
    }
    if (boardFrame !== undefined) {
      params.push(boardFrame);
      fields.push(`board_frame = $${params.length}`);
    }

    if (fields.length === 0) return res.status(400).json({ message: 'Nothing to update' });

    const result = await db.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, email, username, phone, role, profile_image, avatar_config, board_theme, piece_set, board_frame, created_at`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update preferences', error: err.message });
  }
};

/* Uploaded photos are served straight from disk, so a replaced or cleared file
   has to be removed here — nothing else ever deletes it. */
function unlinkUploadedPhoto(profileImage) {
  if (!profileImage) return;
  const fileName = String(profileImage).split('/').pop();
  if (!fileName) return;
  const filePath = path.join(__dirname, '..', '..', 'uploads', fileName);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

exports.uploadPhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file provided' });

    const publicUrl = `/uploads/${req.file.filename}`;
    /* A profile photo and a custom avatar are mutually exclusive: uploading a
       photo replaces whatever the profile was showing, avatar included. */
    const result = await db.query(
      `WITH previous AS (SELECT profile_image FROM users WHERE id = $2)
       UPDATE users
          SET profile_image = $1, avatar_config = NULL, updated_at = NOW()
         FROM previous
        WHERE users.id = $2
        RETURNING users.id, users.name, users.email, users.username, users.phone, users.role,
                  users.profile_image, users.avatar_config, users.board_theme, users.piece_set,
                  users.board_frame, users.created_at, previous.profile_image AS previous_image`,
      [publicUrl, req.user.id]
    );
    if (result.rows.length === 0) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(404).json({ message: 'User not found' });
    }

    const { previous_image: previousImage, ...user } = result.rows[0];
    if (previousImage && previousImage !== publicUrl) unlinkUploadedPhoto(previousImage);

    res.json({ user, profile_image: publicUrl });
  } catch (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    console.error(err);
    res.status(500).json({ message: 'Failed to upload photo', error: err.message });
  }
};

exports.removePhoto = async (req, res) => {
  try {
    /* Removing either profile image leaves the default placeholder: neither
       field is allowed to become the other's fallback. */
    const result = await db.query(
      `WITH previous AS (SELECT profile_image FROM users WHERE id = $1)
       UPDATE users SET profile_image = NULL, avatar_config = NULL, updated_at = NOW()
         FROM previous
        WHERE users.id = $1
        RETURNING previous.profile_image AS previous_image`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    unlinkUploadedPhoto(result.rows[0].previous_image);
    res.json({ profile_image: null });
  } catch (err) {
    res.status(500).json({ message: 'Failed to remove photo', error: err.message });
  }
};

// Save a DiceBear style avatar config for the signed-in user (any role —
// students customise via /students/me/avatar, coaches/admins via /auth/me/avatar).
exports.updateMyAvatar = async (req, res) => {
  try {
    const config = req.body.avatar_config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({ message: 'avatar_config object is required' });
    }

    const clean = {};
    for (const key of ['basePiece', 'bodyColor', 'face', 'accessory', 'background']) {
      if (config[key] !== undefined && config[key] !== null) {
        if (typeof config[key] !== 'string') {
          return res.status(400).json({ message: `avatar_config.${key} must be a string` });
        }
        clean[key] = config[key];
      }
    }
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ message: 'avatar_config must include at least one valid field' });
    }

    /* The avatar replaces an uploaded photo (and its file), matching the
       one-image-per-profile rule the upload endpoint enforces. */
    const result = await db.query(
      `WITH previous AS (SELECT profile_image FROM users WHERE id = $2)
       UPDATE users SET avatar_config = $1, profile_image = NULL, updated_at = NOW()
         FROM previous
        WHERE users.id = $2
        RETURNING previous.profile_image AS previous_image`,
      [clean, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    unlinkUploadedPhoto(result.rows[0].previous_image);
    res.json({ avatar_config: clean });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save avatar', error: err.message });
  }
};

// Remove the custom avatar so nothing but the default placeholder shows.
exports.resetMyAvatar = async (req, res) => {
  try {
    const result = await db.query(
      `WITH previous AS (SELECT profile_image FROM users WHERE id = $1)
       UPDATE users SET avatar_config = NULL, profile_image = NULL, updated_at = NOW()
         FROM previous
        WHERE users.id = $1
        RETURNING previous.profile_image AS previous_image`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    unlinkUploadedPhoto(result.rows[0].previous_image);
    res.json({ avatar_config: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to remove avatar', error: err.message });
  }
};
