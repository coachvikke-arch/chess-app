const bcrypt = require('bcryptjs');
const db = require('../config/database');
const mailService = require('../services/mailService');
const sessionService = require('../services/sessionService');
const { generateRecoveryCode, hashRecoveryCode } = require('../services/recoveryCode');
const { normalisePhone } = require('../utils/phone');

/* ── Openings library ────────────────────────────────────────────────────── */
exports.listOpeningsLibrary = async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM opening_lines ORDER BY id LIMIT 200');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load openings library', error: err.message });
  }
};

/* ── Accounts / recovery codes ───────────────────────────────────────────── */
exports.listAccounts = async (req, res) => {
  try {
    const r = await db.query('SELECT id, name, email, username, phone, country_code, role, created_at FROM users ORDER BY id');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list accounts', error: err.message });
  }
};

/* Only what a password operation needs: whose account it is and whether they
   are a student (students must replace an academy-issued password). */
async function loadAccount(id) {
  const r = await db.query('SELECT id, name, username, role FROM users WHERE id = $1', [id]);
  return r.rows[0] || null;
}

exports.issueRecoveryCode = async (req, res) => {
  try {
    const account = await loadAccount(req.params.id);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    /* Overwrites any previous code: only the newest one is valid, so a code
       that was never passed on cannot linger as a working key. */
    const recoveryCode = generateRecoveryCode();
    await db.query(
      `UPDATE users
          SET recovery_code_hash = $1, recovery_code_created_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [hashRecoveryCode(recoveryCode), account.id]
    );
    /* Plaintext leaves the server exactly once — only the digest is stored. */
    res.json({ recoveryCode, username: account.username });
  } catch (err) {
    res.status(500).json({ message: 'Failed to issue a recovery code', error: err.message });
  }
};

exports.revokeRecoveryCode = async (req, res) => {
  try {
    const account = await loadAccount(req.params.id);
    if (!account) return res.status(404).json({ message: 'Account not found' });
    await db.query(
      `UPDATE users
          SET recovery_code_hash = NULL, recovery_code_created_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [account.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to revoke the recovery code', error: err.message });
  }
};

/* Plaintext passwords are unrecoverable (bcrypt), so "changing" one means
   minting a new one. Every session is revoked afterwards: a reset usually
   happens because the account was locked out or exposed, and leaving other
   devices signed in would defeat it. */
exports.resetUserPassword = async (req, res) => {
  try {
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    const account = await loadAccount(req.params.id);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const hashed = await bcrypt.hash(newPassword, 10);
    const mustChange = account.role === 'student';
    await db.query(
      `UPDATE users
          SET password = $1, must_change_password = $2, updated_at = NOW()
        WHERE id = $3`,
      [hashed, mustChange, account.id]
    );

    const revoked = await sessionService.revokeAllSessions(account.id);
    sessionService.notifyRevoked(req.app.get('io'), revoked, 'password_reset');

    res.json({ ok: true, mustChangePassword: mustChange, revokedSessions: revoked.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to reset the password', error: err.message });
  }
};

/* ── Admin CRUD ──────────────────────────────────────────────────────────── */
exports.listAdmins = async (req, res) => {
  try {
    const r = await db.query("SELECT id, name, email, username, phone, country_code, role, created_at FROM users WHERE role IN ('admin','superadmin') ORDER BY id");
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list admins', error: err.message });
  }
};

exports.listAdminStudents = async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM students WHERE coach_id = $1', [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list admin students', error: err.message });
  }
};

exports.adminReport = async (req, res) => {
  res.json({});
};

exports.performanceReport = async (req, res) => {
  res.json({});
};

exports.getAdmin = async (req, res) => {
  try {
    const r = await db.query(
      "SELECT id, name, email, username, phone, country_code, role, created_at FROM users WHERE id = $1 AND role IN ('admin','superadmin')",
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get admin', error: err.message });
  }
};

/* A coach may edit their own record; the super admin may edit any coach.
   The route-level guard enforces that before this runs. */
exports.updateAdmin = async (req, res) => {
  try {
    const target = await db.query(
      "SELECT id, name, email, phone, country_code, role FROM users WHERE id = $1 AND role IN ('admin','superadmin')",
      [req.params.id]
    );
    if (target.rows.length === 0) return res.status(404).json({ message: 'Admin not found' });
    const current = target.rows[0];

    const { name, email, phone } = req.body;
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ message: 'Name cannot be empty' });
    }
    if (email !== undefined) {
      if (!mailService.isValidEmail(String(email).trim())) {
        return res.status(400).json({ message: 'Enter a valid email address' });
      }
      const dup = await db.query('SELECT id FROM users WHERE email ILIKE $1 AND id <> $2', [String(email).trim(), current.id]);
      if (dup.rows.length > 0) {
        return res.status(400).json({ message: 'That email is already in use by another account' });
      }
    }

    const phoneChange = normalisePhone({
      phone,
      countryCode: req.body.countryCode,
      phoneNumber: req.body.phoneNumber,
    });
    if (phoneChange.error) return res.status(400).json({ message: phoneChange.error });

    const updates = [];
    const params = [current.id];
    if (name !== undefined) {
      updates.push(`name = $${params.length + 1}`);
      params.push(String(name).trim());
    }
    if (email !== undefined) {
      updates.push(`email = $${params.length + 1}`);
      params.push(String(email).trim());
    }
    if (phoneChange.changed) {
      updates.push(`phone = $${params.length + 1}`);
      params.push(phoneChange.phone);
      updates.push(`country_code = $${params.length + 1}`);
      params.push(phoneChange.countryCode);
    }
    if (updates.length === 0) {
      return res.json({ ...current });
    }

    const updated = await db.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1
       RETURNING id, name, email, username, phone, country_code, role, created_at`,
      params
    );
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update admin', error: err.message });
  }
};

exports.deleteAdmin = async (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
};
