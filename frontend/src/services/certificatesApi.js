import api from './api';
import { pdfFilename } from '../utils/certificateShare';

/*
 * Certificates API.
 *
 * Most endpoints here are gated server-side by roleMiddleware('superadmin') acting
 * on certificates (students, issue, settings, generate, sent); this wrapper exists
 * to give the screens one place to talk to, and to normalise the two error shapes
 * the backend returns (a plain 500 with { message, error } and a 422 from the
 * generate endpoint, which carries the certificate back so the UI can show why the
 * PDF failed).
 *
 * Two are self-service and intentionally NOT superadmin-only: getTemplate() (the
 * artwork, which holds no student data) and listMyCertificates() (the signed-in
 * student's own records, resolved from the session).
 */

function messageOf(error, fallback) {
  return (
    error?.response?.data?.message
    || error?.response?.data?.error
    || error?.message
    || fallback
  );
}

/** Throw an Error carrying the server's own message plus the parsed body. */
function fail(error, fallback) {
  const err = new Error(messageOf(error, fallback));
  err.status = error?.response?.status || 0;
  err.body = error?.response?.data || null;
  throw err;
}

export async function listStudents(search = '') {
  try {
    const { data } = await api.get('/certificates/students', {
      params: search ? { search } : undefined,
    });
    return data.students || [];
  } catch (e) {
    return fail(e, 'Could not load students');
  }
}

export async function listStudentCertificates(studentId) {
  try {
    const { data } = await api.get(`/certificates/students/${studentId}`);
    return { student: data.student, certificates: data.certificates || [] };
  } catch (e) {
    return fail(e, 'Could not load certificates');
  }
}

/**
 * The signed-in student's OWN certificates.
 *
 * Deliberately takes no id: the server resolves the student from the session, so
 * there is no parameter to tamper with. Used by the student nav's Certificates
 * section; the admin's per-student view keeps using listStudentCertificates().
 */
export async function listMyCertificates() {
  try {
    const { data } = await api.get('/certificates/me');
    return { student: data.student, certificates: data.certificates || [] };
  } catch (e) {
    return fail(e, 'Could not load your certificates');
  }
}

/**
 * The artwork and layout geometry for the on-screen preview.
 *
 * Fetched once and cached for the session: the artwork arrives as a data URL
 * (~1.2MB of base64) because Vite fingerprints src/assets imports, so the server
 * cannot know the hashed filename. Sending it with every certificate in a list
 * would be absurd, so it is a separate endpoint.
 */
let templateCache = null;
export async function getTemplate() {
  if (templateCache) return templateCache;
  try {
    const { data } = await api.get('/certificates/template', { cacheTtl: 10 * 60 * 1000 });
    templateCache = data;
    return data;
  } catch (e) {
    return fail(e, 'Could not load the certificate template');
  }
}

/** Create or regenerate a certificate's PDF. */
export async function generate(id) {
  try {
    const { data } = await api.post(`/certificates/${id}/generate`);
    return data.certificate;
  } catch (e) {
    /* 422 means the row exists but the PDF failed, and the body carries the
       updated certificate (with file_error set). Hand that back instead of a
       bare error so the screen can show the real reason. */
    if (e?.response?.status === 422 && e.response.data?.certificate) {
      const err = new Error(messageOf(e, 'Certificate PDF could not be generated'));
      err.certificate = e.response.data.certificate;
      throw err;
    }
    return fail(e, 'Could not generate the certificate');
  }
}

/**
 * Record that the WhatsApp compose screen was opened.
 *
 * This is bookkeeping only: wa.me returns no delivery or read receipt, so
 * 'sent' means "the admin opened the compose screen", never "the parent
 * received it".
 */
export async function markSent(id) {
  try {
    const { data } = await api.patch(`/certificates/${id}/sent`);
    return data.certificate;
  } catch (e) {
    return fail(e, 'Could not update the certificate');
  }
}

export async function getSettings() {
  try {
    const { data } = await api.get('/certificates/settings');
    return data;
  } catch (e) {
    return fail(e, 'Could not load certificate settings');
  }
}

export async function saveSettings(patch) {
  try {
    const { data } = await api.put('/certificates/settings', patch);
    return data.settings;
  } catch (e) {
    return fail(e, 'Could not save certificate settings');
  }
}

/**
 * Load a certificate's PDF as a File, ready to hand to the OS share sheet.
 *
 * Fetched rather than linked, because the bytes have to be in hand for
 * `navigator.share` — the only way to attach the PDF to a WhatsApp message from a
 * browser. The absolute URL the API returns is used, so this keeps working when the
 * app and the API are served from different origins.
 */
export async function fetchCertificateFile(certificate) {
  const url = certificate.fileUrlAbsolute || certificate.fileUrl;
  if (!url) throw new Error('This certificate has no PDF yet');

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Could not download the certificate PDF (${res.status})`);

  const blob = await res.blob();
  return new File([blob], pdfFilename(certificate.certificateNo), { type: 'application/pdf' });
}

/**
 * Issue a certificate by hand.
 *
 * The automatic paths (level progression, tournament finalisation) are the normal
 * way a certificate comes into existence; this is for a corrected result or a
 * historic achievement the backfill did not match.
 *
 * `created: false` is a success response meaning the certificate already exists.
 */
export async function issue(payload) {
  try {
    const { data } = await api.post('/certificates/issue', payload);
    return data;
  } catch (e) {
    return fail(e, 'Could not issue the certificate');
  }
}