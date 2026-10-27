const db = require('../config/database');
const svc = require('../services/certificateService');
const { layout, templateDataUrl, templateUrl } = require('../config/certificateAssets');
const { buildCertificateContent } = require('../services/certificateContent');
const { validatePhone } = require('../services/certificateWhatsApp');

/**
 * Certificates API — Super Admin only (enforced in certificateRoutes.js).
 *
 * TWO ID CONVENTIONS COLLIDE IN THIS SCHEMA, and both are handled explicitly:
 *   • `certificates.student_id`    references students(id)
 *   • `tournament_registrations.student_id` references users(id)
 * Every query below therefore names which id it means rather than trusting the
 * bare column name to be self-explanatory.
 *
 * Student name and phone come from `users` (students has neither column), so
 * every read joins through students.user_id.
 */

/**
 * Turn a stored relative file path into an absolute URL for the WhatsApp message.
 *
 * The database keeps "/uploads/certificates/..." so a link survives a change of
 * domain, but wa.me needs something a phone can open, so the origin is taken from
 * the incoming request. X-Forwarded-* is honoured because the app is served
 * behind a proxy in production, where a plain http link would be mixed-content.
 */
function absoluteUrl(req, fileUrl) {
  if (!fileUrl) return null;
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || req.protocol
    || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (!host) return fileUrl;
  return `${proto}://${host}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
}

/** One row, everything the cards, preview and send flow need. */
const CERT_SELECT = `
  SELECT c.*,
         COALESCE(u.name, 'Student #' || c.student_id) AS student_name,
         u.phone      AS phone,
         t.name       AS tournament_name,
         sb.name      AS sent_by_name
    FROM certificates c
    JOIN students s        ON s.id = c.student_id
    LEFT JOIN users u      ON u.id = s.user_id
    LEFT JOIN users sb     ON sb.id = c.sent_by
    LEFT JOIN tournaments t ON t.id = c.tournament_id
`;

/**
 * Shape a certificate row for the API.
 *
 * The preview `content` is the SAME resolved field values the PDF renderer draws,
 * computed on the server. The browser only positions them using the shared layout
 * JSON — it never recomputes a title, a date or a tier name — so the preview and
 * the generated file cannot drift apart.
 */
function shape(req, row, settings) {
  const student = { name: row.student_name, phone: row.phone };
  const fileUrlAbsolute = absoluteUrl(req, row.file_url);
  const delivery = svc.deliveryFor(row, student, settings, fileUrlAbsolute);

  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    type: row.type,
    title: row.title,
    rank: row.rank ?? null,
    /* `position` is the tournament-facing name for the same column; NULL means
       Participant (outside the top three). */
    position: row.rank ?? null,
    rankLabel: row.rank
      ? svc.ordinal(row.rank)
      : (row.type === 'tournament' ? 'Participant' : null),
    levelNo: row.level_no ?? null,
    tournamentId: row.tournament_id ?? null,
    tournamentName: row.tournament_name || null,
    score: row.score || null,
    issuedAt: row.issued_at,
    certificateNo: row.certificate_no,
    fileUrl: row.file_url,
    fileUrlAbsolute,
    /* Non-null means the last generate attempt failed; the UI shows the reason
       and offers Regenerate. */
    fileError: row.file_error || null,
    needsGeneration: !row.file_url,
    status: row.status,
    sendStatus: row.status,
    sentAt: row.sent_at,
    sentBy: row.sent_by,
    sentByName: row.sent_by_name || null,
    /* How many times this has gone out. WhatsApp confirms no delivery, so a
       certificate may need sending more than once; the UI offers a resend and
       shows the count. */
    sendCount: row.send_count ?? 0,
    ...delivery,
    preview: buildCertificateContent({ certificate: row, student, settings }),
  };
}

/**
 * GET /api/certificates/template
 *
 * The artwork and the layout geometry, fetched ONCE by the preview modal.
 *
 * The image is returned as a data URL deliberately: Vite fingerprints
 * src/assets imports, so the server cannot know the hashed bundle filename, and
 * sending ~1.2MB of base64 with every certificate in a list would be absurd. One
 * fetch per modal open is the right trade.
 */
exports.template = async (req, res) => {
  try {
    res.json({
      template: { ...layout.template, url: templateUrl(), dataUrl: templateDataUrl() },
      layout: { template: layout.template, fonts: layout.fonts, fields: layout.fields },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load certificate template', error: err.message });
  }
};

/**
 * GET /api/certificates/students  (?search=)
 * Every student with their certificate counts — the screen the admin works from.
 */
exports.listStudents = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE COALESCE(u.name, '') ILIKE $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT s.id,
              s.user_id,
              COALESCE(u.name, 'Student #' || s.id) AS name,
              u.phone         AS phone,
              u.avatar_config AS avatar_config,
              u.profile_image AS profile_image,
              COUNT(c.id)::int AS total,
              COUNT(c.id) FILTER (WHERE c.status = 'pending')::int AS pending,
              COUNT(c.id) FILTER (WHERE c.file_url IS NULL)::int AS needs_generation
         FROM students s
         LEFT JOIN users u  ON u.id = s.user_id
         LEFT JOIN certificates c ON c.student_id = s.id
         ${where}
        GROUP BY s.id, s.user_id, u.name, u.phone, u.avatar_config, u.profile_image
        ORDER BY name ASC`,
      params
    );

    res.json({
      students: rows.map((r) => {
        const phone = validatePhone(r.phone);
        return {
          id: r.id,
          userId: r.user_id,
          name: r.name,
          /* Avatar data, so the list shows the same face the rest of the app
             shows. `initial` is only the last-resort fallback. */
          avatarConfig: r.avatar_config || null,
          profileImage: r.profile_image || null,
          initial: (r.name || '?').trim().charAt(0).toUpperCase() || '?',
          phone: r.phone,
          phoneValid: phone.valid,
          phoneError: phone.valid ? null : phone.reason,
          total: r.total,
          pending: r.pending,
          needsGeneration: r.needs_generation,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load students', error: err.message });
  }
};

/**
 * Shared read for one student's certificates.
 *
 * The admin route (by student id) and the student's own route (by the signed-in
 * user) must return EXACTLY the same shape — a certificate that looks different
 * depending on who opened it is a bug waiting to be reported.
 */
async function sendStudentCertificates(req, res, studentId) {
  const student = await svc.getStudent(studentId);
  if (!student) return res.status(404).json({ message: 'Student not found' });

  const settings = await svc.getSettings();
  const { rows } = await db.query(
    `${CERT_SELECT} WHERE c.student_id = $1 ORDER BY c.issued_at DESC, c.id DESC`,
    [studentId]
  );
  const phone = validatePhone(student.phone);

  return res.json({
    student: {
      id: student.id,
      name: student.name,
      phone: student.phone,
      phoneValid: phone.valid,
      phoneError: phone.valid ? null : phone.reason,
      parentName: student.parent_name || null,
    },
    certificates: rows.map((r) => shape(req, r, settings)),
  });
}

/** GET /api/certificates/students/:studentId */
exports.listStudentCertificates = async (req, res) => {
  try {
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ message: 'Invalid student id' });
    }
    return await sendStudentCertificates(req, res, studentId);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load certificates', error: err.message });
  }
};

/**
 * GET /api/certificates/me — the signed-in student's own certificates.
 *
 * This is what the student nav's Certificates section reads. The student row is
 * resolved from the SESSION, never from an id in the URL, so editing the request
 * cannot reach another student's certificates. It is mounted ABOVE the
 * superadmin gate in certificateRoutes.js for exactly that reason.
 */
exports.listMine = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id FROM students WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: 'No student profile is linked to this account' });
    }
    return await sendStudentCertificates(req, res, rows[0].id);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load certificates', error: err.message });
  }
};

/**
 * POST /api/certificates/:id/generate — create or regenerate the PDF.
 *
 * Regeneration replaces the file in place, so any link already sent keeps
 * working. A generation failure returns 422 with the stored reason rather than
 * a generic 500: the certificate row exists and is still pending, and the admin
 * needs to know why before they can fix it.
 */
exports.generate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid certificate id' });
    }

    const result = await svc.regenerate(id);
    if (!result) return res.status(404).json({ message: 'Certificate not found' });

    const { rows } = await db.query(`${CERT_SELECT} WHERE c.id = $1`, [id]);
    if (!result.ok) {
      return res.status(422).json({
        message: 'Certificate PDF could not be generated',
        error: result.error,
        certificate: shape(req, rows[0], await svc.getSettings()),
      });
    }
    res.json({ certificate: shape(req, rows[0], await svc.getSettings()) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate certificate', error: err.message });
  }
};

/**
 * PATCH /api/certificates/:id/sent
 *
 * Records that the WhatsApp share sheet was used, or the conversation was opened.
 * wa.me and the share API both return no delivery or read receipt, so this
 * deliberately does NOT claim the parent received anything — it is an
 * admin-side bookkeeping flag, and the UI must not imply delivery.
 *
 * The same endpoint serves a resend. WhatsApp confirms nothing, so "they said they
 * never got it" can only be answered by sending again; send_count accumulates so
 * the attempts stay visible.
 */
exports.markSent = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid certificate id' });
    }

    const row = await svc.markSent(id, req.user ? req.user.id : null);
    if (!row) return res.status(404).json({ message: 'Certificate not found' });

    const settings = await svc.getSettings();
    const full = await db.query(`${CERT_SELECT} WHERE c.id = $1`, [id]);
    res.json({ certificate: shape(req, full.rows[0], settings) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update certificate', error: err.message });
  }
};

/** GET /api/certificates/settings */
exports.getSettings = async (req, res) => {
  try {
    const settings = await svc.getSettings();
    res.json({
      settings,
      /* The accepted placeholders and the phone rule, so the settings screen can
         document them instead of hard-coding the list. */
      placeholders: ['{name}', '{title}', '{link}', '{institute_name}'],
      phoneRule: svc.PHONE_RULE_MESSAGE,
      defaults: { message_template: require('../services/certificateWhatsApp').DEFAULT_MESSAGE_TEMPLATE },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load settings', error: err.message });
  }
};

/** PUT /api/certificates/settings */
exports.saveSettings = async (req, res) => {
  try {
    const { message_template, institute_name, coach_name, logo_url } = req.body || {};
    const settings = await svc.saveSettings(
      { message_template, institute_name, coach_name, logo_url },
      req.user ? req.user.id : null
    );
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save settings', error: err.message });
  }
};

/**
 * POST /api/certificates/issue — issue one certificate by hand.
 *
 * The automatic paths (rating progression, tournament finalisation) are the normal
 * way a certificate comes into existence; this endpoint exists for the cases they
 * cannot cover — a result corrected after finalisation, or a historic achievement
 * the backfill did not match.
 */
exports.issue = async (req, res) => {
  try {
    const { studentId, type, level, tournamentId, rank, position, score } = req.body || {};
    const sid = Number(studentId);
    if (!Number.isInteger(sid) || sid <= 0) {
      return res.status(400).json({ message: 'studentId is required' });
    }

    const settings = await svc.getSettings();
    let cert;

    if (type === svc.CERT_TYPES.tournament) {
      const tid = Number(tournamentId);
      if (!Number.isInteger(tid) || tid <= 0) {
        return res.status(400).json({ message: 'tournamentId is required for a tournament certificate' });
      }
      const t = await db.query(`SELECT name FROM tournaments WHERE id = $1`, [tid]);
      if (!t.rows[0]) return res.status(404).json({ message: 'Tournament not found' });

      /* A missing position is a Participant certificate, not an error: that is
         what the automatic path issues outside the top three. */
      cert = await svc.issueTournamentCertificate({
        studentId: sid,
        tournamentId: tid,
        tournamentName: t.rows[0].name,
        rank: rank ?? position,
        score,
      });
    } else {
      const lvl = Number(level);
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > svc.MAX_LEVEL) {
        return res.status(400).json({ message: `level must be between 1 and ${svc.MAX_LEVEL}` });
      }
      /* One call, one level: manual issuance is explicit about which tier it is
         awarding. The automatic path passes the whole completed set instead. */
      const created = await svc.issueLevelCertificates({ studentId: sid, levels: [lvl] });
      cert = created[0] || null;
    }

    /* null means this achievement already has a certificate — a duplicate, not a
       failure. Reported as such so the admin can see nothing was lost. */
    if (!cert) {
      return res.status(200).json({ created: false, reason: 'Certificate already exists' });
    }

    const { rows } = await db.query(`${CERT_SELECT} WHERE c.id = $1`, [cert.id]);
    res.status(201).json({ created: true, certificate: shape(req, rows[0], settings) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to issue certificate', error: err.message });
  }
};

exports.absoluteUrl = absoluteUrl;
exports.CERT_SELECT = CERT_SELECT;
exports.shape = shape;