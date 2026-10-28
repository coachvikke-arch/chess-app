import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Card, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { getSettings, saveSettings } from '../services/certificatesApi';
import {
  PLACEHOLDERS, renderMessage, unknownPlaceholders, validatePhone, PHONE_RULE_MESSAGE,
} from '../utils/certificateTemplate';
import Button from '../components/Button';
import { APP_NAME } from '../config/brand';

/*
 * Certificate settings: the message template and the identity printed on every
 * certificate.
 *
 * THE LIVE PREVIEW IS TEXT, NOT HTML
 * The template is plain text that ends up in a WhatsApp composer. It is rendered
 * into a <pre>-style block as literal characters — never with
 * dangerouslySetInnerHTML — so a stored template cannot inject markup into this
 * page. The backend strips tag-shaped input on save as a second line of defence,
 * and wa.me itself only understands *bold*.
 *
 * The sample values below stand in for a real student so the admin can see the
 * greeting, the placement and the link in context.
 */
const SAMPLE = {
  name: 'Ramesh',
  title: 'Level 3 · Bishop completed',
  link: 'https://academy.example.com/uploads/certificates/CERT-2026-0001.pdf',
};

export default function CertificateSettings() {
  const { showToast } = useToast();
  const [form, setForm] = useState(null);
  const [meta, setMeta] = useState({ placeholders: PLACEHOLDERS, phoneRule: PHONE_RULE_MESSAGE });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((data) => {
        if (!alive) return;
        setForm(data.settings);
        setMeta({
          placeholders: data.placeholders || PLACEHOLDERS,
          phoneRule: data.phoneRule || PHONE_RULE_MESSAGE,
        });
      })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const preview = form
    ? renderMessage(form.message_template, { ...SAMPLE, institute_name: form.institute_name })
    : '';
  const stray = form ? unknownPlaceholders(form.message_template) : [];

  async function onSave() {
    setSaving(true);
    try {
      const saved = await saveSettings({
        message_template: form.message_template,
        institute_name: form.institute_name,
        coach_name: form.coach_name,
        logo_url: form.logo_url,
        participation_certificates: Boolean(form.participation_certificates),
      });
      setForm(saved);
      showToast('Certificate settings saved. New certificates will use them.', {
        tone: 'success', title: 'Saved',
      });
    } catch (err) {
      showToast(err.message, { tone: 'error', title: 'Could not save' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageHeader title="Certificate settings" icon="♕"><Spinner text="Loading settings…" /></PageHeader>;

  if (error) {
    return (
      <PageHeader title="Certificate settings" icon="♕">
        <Card>
          <Button variant="secondary" size="sm" className="!px-3 !py-1 text-xs" to="/super/certificates">← All students</Button>
          <p className="text-sm text-red-400 mt-3">{error}</p>
        </Card>
      </PageHeader>
    );
  }

  return (
    <PageHeader
      title="Certificate settings"
      icon="♕"
      subtitle="The greeting sent over WhatsApp, and the identity printed on every certificate."
      wide
    >
      <Button variant="secondary" size="sm" className="!px-3 !py-1 text-xs" to="/super/certificates">← All students</Button>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <div className="space-y-4">
          <Card title="WhatsApp message" piece="✈">
            <label className="block text-xs font-semibold text-ivory-500 mb-1" htmlFor="cert-template">
              Message template
            </label>
            <textarea
              id="cert-template"
              className="chess-input font-mono text-xs"
              rows={5}
              value={form.message_template || ''}
              onChange={(e) => set('message_template', e.target.value)}
            />

            <div className="flex flex-wrap gap-1.5 mt-2">
              {meta.placeholders.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chess-chip chess-chip-gold !cursor-pointer"
                  title={`Insert ${p}`}
                  onClick={() => set('message_template', `${form.message_template || ''}${p}`)}
                >
                  {p}
                </button>
              ))}
            </div>

            {stray.length > 0 && (
              <p className="text-xs text-amber-400 mt-2">
                Not a supported placeholder: {stray.join(', ')}. It will be sent to
                the parent exactly as written.
              </p>
            )}

            <p className="text-xs text-ivory-700 mt-3">
              {'{name}'} is replaced with the student’s first name only.
            </p>
          </Card>

          <Card title="Printed on the certificate" piece="♕">
            <Field
              label="Institute name"
              value={form.institute_name || ''}
              onChange={(v) => set('institute_name', v)}
              placeholder={APP_NAME}
            />
            <Field
              label="Coach name"
              value={form.coach_name || ''}
              onChange={(v) => set('coach_name', v)}
              placeholder="Shown in the signature block"
            />
            <Field
              label="Logo URL"
              value={form.logo_url || ''}
              onChange={(v) => set('logo_url', v)}
              placeholder="/uploads/logo.png — leave empty for none"
            />
            <p className="text-xs text-ivory-700 mt-2">
              PNG or JPEG only. A logo that cannot be read is skipped rather than
              failing the certificate.
            </p>
          </Card>

          <Card title="Tournament certificates" piece="♜">
            <label className="flex items-start gap-3 cursor-pointer" htmlFor="cert-participation">
              <input
                id="cert-participation"
                type="checkbox"
                className="mt-1"
                checked={Boolean(form.participation_certificates)}
                onChange={(e) => set('participation_certificates', e.target.checked)}
              />
              <span>
                <span className="block text-sm font-semibold text-ivory-200">
                  Issue participation certificates
                </span>
                <span className="block text-xs text-ivory-500 mt-1 leading-relaxed">
                  Off by default: only the top three finishers receive a tournament
                  certificate. Turn this on to issue one to every player who
                  completed at least one game.
                </span>
              </span>
            </label>
          </Card>

          <Card title="Phone numbers" piece="☎">
            <p className="text-xs text-ivory-500 leading-relaxed">{meta.phoneRule}</p>
            <p className="text-xs text-ivory-700 mt-2">
              Numbers are validated when a certificate is sent, and a certificate
              with an unusable number cannot be sent at all — the button is
              disabled with the reason shown.
            </p>
            <PhoneExamples />
          </Card>

          <Button type="button" variant="primary" size="md" disabled={saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>

        <div className="space-y-4">
          <Card title="Message preview" piece="✉">
            <pre className="cert-queue-message text-xs text-ivory-300 whitespace-pre-wrap font-sans">
              {preview || 'Write a template to see the message.'}
            </pre>
            <p className="text-xs text-ivory-700 mt-3">
              Shown with a sample student. {'{name}'} is a first name, {'{title}'}
              {' '}is the certificate title and {'{link}'} is the PDF the parent
              opens.
            </p>
          </Card>

          <Card title="What gets checked" piece="✓">
            <ul className="space-y-2 text-xs text-ivory-500">
              <li>Each certificate is issued automatically when it is earned.</li>
              <li>
                The number is <span className="text-gold-400">CERT-YYYY-0001</span>,
                allocated in order and never reused.
              </li>
              <li>
                If the PDF cannot be produced the certificate is kept and the
                reason is shown, so it can be regenerated.
              </li>
              <li>
                “Sent” records that the WhatsApp compose screen was opened —
                WhatsApp gives no delivery receipt.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </PageHeader>
  );
}

function Field({ label, value, onChange, placeholder }) {
  const id = `cert-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="mt-3 first:mt-0">
      <label className="block text-xs font-semibold text-ivory-500 mb-1" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="chess-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Live feedback on the phone rule, using the same validator the send flow uses. */
function PhoneExamples() {
  const samples = ['91984100001', '+91984100001', '91984 100001', '91984-100001', '0984100001'];
  return (
    <ul className="mt-3 space-y-1">
      {samples.map((sample) => {
        const result = validatePhone(sample);
        return (
          <li key={sample} className="flex items-center gap-2 text-xs">
            <span className={result.valid ? 'text-emerald-400' : 'text-red-400'}>{result.valid ? '✓' : '✕'}</span>
            <span className="font-mono text-ivory-500">{sample}</span>
            {!result.valid && <span className="text-ivory-700">rejected</span>}
          </li>
        );
      })}
    </ul>
  );
}