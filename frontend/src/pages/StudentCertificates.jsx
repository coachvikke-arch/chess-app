import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Page, Card, Chip, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import CertificatePreviewModal from '../components/CertificatePreviewModal';
import CertificateInline from '../components/CertificateInline';
import {
  listStudentCertificates, generate, markSent, issue, fetchCertificateFile,
} from '../services/certificatesApi';
import { shareCertificate, openWhatsApp, canShareFiles } from '../utils/certificateShare';
import Button from '../components/Button';
import { formatPhoneDisplay } from '../utils/phone';

/*
 * One student's certificates.
 *
 * The rows here are the unit of work: preview the certificate, download it, send
 * it on WhatsApp, and — when the PDF could not be produced — see exactly why and
 * regenerate it.
 *
 * The level badge shown next to a certificate comes from the server
 * (preview._badge) rather than from a frontend copy of the tier table, so it
 * cannot disagree with the tier names printed on the certificate itself.
 *
 * Each certificate is sent on its own, from its own Send button. There is
 * deliberately no bulk "send all": a WhatsApp share sheet is a user interaction, so
 * a queue would just be the same action repeated by hand with extra clicks, and it
 * makes it too easy to mark several certificates sent without looking at them.
 */
export default function StudentCertificates() {
  const { studentId } = useParams();
  const { showToast } = useToast();

  const [student, setStudent] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [preview, setPreview] = useState(null);
  /* Which certificate is drawn inline on the page ("Show in page"). */
  const [inlineId, setInlineId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listStudentCertificates(studentId);
      setStudent(data.student);
      setCertificates(data.certificates);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { load(); }, [load]);

  const blocked = useMemo(
    () => certificates.filter((c) => c.status === 'pending' && !c.canSend),
    [certificates]
  );

  function patchLocal(updated) {
    setCertificates((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  }

  async function onGenerate(cert) {
    setBusyId(cert.id);
    try {
      const updated = await generate(cert.id);
      patchLocal(updated);
      showToast(`${updated.certificateNo} is ready.`, { tone: 'success', title: 'Certificate generated' });
    } catch (err) {
      if (err.certificate) patchLocal(err.certificate);
      showToast(err.message, { tone: 'error', title: 'Could not generate', duration: 9000 });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Send on WhatsApp.
   *
   * The wa.me link can only prefill text, so the PDF is attached by handing it to
   * the OS share sheet, where WhatsApp is one tap. The rendered greeting travels
   * with it as the payload's `text`, so the parent gets the message AND the document
   * together - sharing the file alone would deliver a bare PDF with no explanation.
   * Where the browser cannot attach files, the PDF is saved to the device instead
   * and the prefilled conversation is opened. See utils/certificateShare.js.
   */
  async function onSend(cert) {
    /* Captured before the send, because the response overwrites it. */
    const isResend = cert.status === 'sent';
    setBusyId(cert.id);
    try {
      const file = await fetchCertificateFile(cert);
      const outcome = await shareCertificate({
        file,
        waUrl: cert.waUrl,
        filename: file.name,
        text: cert.message,
        title: cert.title,
      });

      if (outcome.result === 'cancelled') {
        /* Dismissing the share sheet is not a send — leaving the certificate
           pending is the correct outcome. */
        setBusyId(null);
        return;
      }
      if (outcome.result === 'failed') {
        showToast(outcome.reason || 'Could not open WhatsApp.', { tone: 'error', title: 'Send failed' });
        setBusyId(null);
        return;
      }

      if (outcome.result === 'shared_without_text') {
        showToast(outcome.reason, { tone: 'warning', duration: 9000 });
      }
      if (outcome.result === 'downloaded') {
        /* The PDF is on the device now; open the conversation so the admin can
           attach it. The record is only marked once that has happened. */
        const win = openWhatsApp(cert.waUrl);
        if (!win) {
          showToast('Your browser blocked the WhatsApp tab. Allow pop-ups for this site and try again.', {
            tone: 'warning', title: 'Pop-up blocked', duration: 9000,
          });
          setBusyId(null);
          return;
        }
        showToast(
          'This browser cannot attach files automatically. The PDF has been saved — attach it in WhatsApp.',
          { tone: 'info', title: 'PDF downloaded', duration: 9000 }
        );
      }

      const updated = await markSent(cert.id);
      patchLocal(updated);
      showToast(
        outcome.result === 'shared'
          ? (isResend ? 'Resent with the greeting and PDF.' : 'Greeting and PDF handed to WhatsApp.')
          : (isResend ? 'Resent — marked as opened in WhatsApp.' : 'Marked as opened in WhatsApp.'),
        {
          tone: 'success',
          title: updated.sendCount > 1 ? `${cert.certificateNo} · sent ${updated.sendCount}×` : cert.certificateNo,
        }
      );
    } catch (err) {
      showToast(err.message, { tone: 'error', title: 'Could not send' });
    } finally {
      setBusyId(null);
    }
  }

  /* Manual issue is for a corrected tournament result or a historic achievement
     the backfill did not match. */
  async function onIssueTournament() {
    const name = window.prompt('Tournament id (see the tournaments page):');
    if (!name) return;
    const rankRaw = window.prompt('Finishing position (1 = winner):');
    if (rankRaw === null) return;
    const rank = Number(rankRaw);
    if (!Number.isInteger(rank) || rank < 1) {
      showToast('The finishing position must be 1 or more.', { tone: 'error', title: 'Invalid position' });
      return;
    }
    try {
      const res = await issue({
        studentId: Number(studentId),
        type: 'tournament',
        tournamentId: Number(name),
        rank,
      });
      if (res.created) {
        showToast(`${res.certificate.certificateNo} issued.`, { tone: 'success', title: 'Certificate issued' });
        load();
      } else {
        showToast(res.reason || 'That certificate already exists.', { tone: 'info' });
      }
    } catch (err) {
      showToast(err.message, { tone: 'error', title: 'Could not issue' });
    }
  }

  if (loading) return <Page title="Certificates" piece="♕"><Spinner text="Loading certificates…" /></Page>;

  if (error) {
    return (
      <Page title="Certificates" piece="♕">
        <Card>
          <Button variant="secondary" size="sm" className="!px-3 !py-1 text-xs" to="/super/certificates">
            ← All students
          </Button>
          <p className="text-sm text-red-400 mt-3">{error}</p>
          <Button type="button" variant="primary" size="md" className="mt-3" onClick={load}>Try again</Button>
        </Card>
      </Page>
    );
  }

  return (
    <Page title={student?.name || 'Certificates'} piece="♕" sub={student?.parentName ? `Parent: ${student.parentName}` : undefined} wide>
      <Button variant="secondary" size="sm" className="!px-3 !py-1 text-xs" to="/super/certificates">
        ← All students
      </Button>

      {/* The phone rule is shown up front because it decides whether anything on
          this page can actually be sent. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-ivory-500">
          Phone: <span className="text-ivory-300">{formatPhoneDisplay(student?.phone, student?.country_code) || 'not saved'}</span>
        </span>
        {student?.phoneValid ? (
          <Chip tone="green">Ready to send on WhatsApp</Chip>
        ) : (
          <Chip tone="amber">{student?.phoneError}</Chip>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Button type="button" variant="secondary" size="md" onClick={onIssueTournament}>
          Issue a tournament certificate
        </Button>
      </div>

      {blocked.length > 0 && (
        <Card className="mt-4">
          <h2 className="chess-card-title"><span className="chess-card-piece">⚠</span><span className="flex-1">Cannot be sent</span></h2>
          <ul className="mt-2 space-y-2">
            {blocked.map((c) => (
              <li key={c.id}>
                <span className="font-semibold text-ivory-300">{c.title}</span>
                <span className="block text-xs text-amber-400">{c.blockers.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 space-y-3">
        {certificates.length === 0 && (
          <Card>
            <p className="chess-empty">
              No certificates yet. They are issued automatically when this student
              completes a level or finishes on a tournament podium.
            </p>
          </Card>
        )}

        {certificates.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display font-bold text-ivory-200">{c.title}</h3>
                <p className="text-xs text-ivory-500 mt-1">
                  {c.certificateNo} · issued {new Date(c.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {c.preview?._badge ? ` · ${c.preview._badge}` : ''}
                  {c.tournamentName ? ` · ${c.tournamentName}` : ''}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {c.status === 'sent' ? (
                    <Chip tone="green">
                      Sent{c.sendCount > 1 ? ` ×${c.sendCount}` : ''}
                      {c.sentAt ? ` · last ${new Date(c.sentAt).toLocaleDateString()}` : ''}
                    </Chip>
                  ) : (
                    <Chip tone="amber">Not sent</Chip>
                  )}
                  {c.needsGeneration && <Chip tone="red">No PDF</Chip>}
                </div>
                {c.fileError && (
                  <p className="text-xs text-red-400 mt-2">
                    Generation failed: {c.fileError}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" className="!px-3 !py-1 text-xs" onClick={() => setPreview(c)}>
                  Preview
                </Button>
                <Button
                  type="button"
                  variant={inlineId === c.id ? 'primary' : 'secondary'}
                  size="sm"
                  className="!px-3 !py-1 text-xs"
                  aria-pressed={inlineId === c.id}
                  onClick={() => setInlineId((id) => (id === c.id ? null : c.id))}
                >
                  {inlineId === c.id ? 'Hide from page' : 'Show in page'}
                </Button>
                {c.fileUrl ? (
                  <>
                    <Button variant="secondary" size="sm" className="!px-3 !py-1 text-xs" href={c.fileUrlAbsolute || c.fileUrl} target="_blank" rel="noopener noreferrer">
                      Open PDF
                    </Button>
                    <Button variant="secondary" size="sm" className="!px-3 !py-1 text-xs" href={c.fileUrl} download>
                      Download
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="primary" size="sm" className="!px-3 !py-1 text-xs"
                    disabled={busyId === c.id}
                    onClick={() => onGenerate(c)}
                  >
                    {busyId === c.id ? 'Generating…' : c.fileError ? 'Retry PDF' : 'Generate PDF'}
                  </Button>
                )}
{/* Offered for an already-sent certificate too: WhatsApp confirms no delivery, so
                    "they said they never received it" can only be answered by
                    sending again. The button says so plainly rather than pretending
                    a resend is a first send. */}
                <Button
                  type="button"
                  variant={c.status === 'pending' ? 'primary' : 'secondary'}
                  size="sm"
                  className="!px-3 !py-1 text-xs"
                  disabled={!c.canSend || busyId === c.id}
                  title={c.canSend
                    ? (canShareFiles()
                      ? 'Opens the share sheet - choose WhatsApp and the greeting and PDF go together.'
                      : 'This browser cannot attach files in WhatsApp: the PDF will be downloaded first, then the message opens.')
                    : c.blockers.join(' · ')}
                  onClick={() => onSend(c)}
                >
                  {busyId === c.id
                    ? 'Sending…'
                    : c.status === 'pending' ? 'Send on WhatsApp' : 'Resend on WhatsApp'}
                </Button>
              </div>
            </div>

            {inlineId === c.id && (
              <CertificateInline certificate={c} onHide={() => setInlineId(null)} />
            )}
          </Card>
        ))}
      </div>

      {preview && <CertificatePreviewModal certificate={preview} onClose={() => setPreview(null)} />}
    </Page>
  );
}