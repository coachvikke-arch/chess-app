import { useState } from 'react';
import Button from './Button';

/* The academy's contact form, in one component.
 *
 * It used to live on its own /contact page, which the landing header linked to and
 * the login page ignored. The page is gone: this is mounted inline on the landing
 * page and, collapsed, on the login card — so "contact us" is wherever the visitor
 * already is, and there is no address to type or remember.
 *
 * Mail form only on purpose: no academy email address, phone number or WhatsApp
 * link is rendered anywhere. The form is the contact method.
 *
 * NOTE ON DELIVERY: there is no backend endpoint for this. `onSend` is a prop so a
 * real POST can be wired in without touching either page; with no handler the
 * component reports the message as queued locally, exactly as the old /contact
 * page did.
 */
export default function ContactForm({ compact = false, onSend = null }) {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (sent) {
    return (
      <div className="cz-contact-done" role="status">
        <span className="cz-contact-done-icon" aria-hidden="true">♛</span>
        <p className="cz-contact-done-title">Message sent</p>
        <p className="cz-contact-done-text">Thanks — we&apos;ll get back to you soon.</p>
        <button type="button" className="cz-contact-again" onClick={() => { setSent(false); setForm({ name: '', email: '', message: '' }); }}>
          Send another
        </button>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (onSend) await onSend(form);
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`cz-contact${compact ? ' cz-contact-compact' : ''}`} onSubmit={submit}>
      <div className="cz-field">
        <label htmlFor="cz-name">Your name</label>
        <input id="cz-name" required value={form.name} onChange={set('name')} placeholder="Full name" autoComplete="name" />
      </div>
      <div className="cz-field">
        <label htmlFor="cz-email">Your email</label>
        <input id="cz-email" required type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" />
      </div>
      <div className="cz-field">
        <label htmlFor="cz-message">Message</label>
        <textarea id="cz-message" required rows={compact ? 3 : 5} value={form.message} onChange={set('message')} placeholder="Tell us how we can help…" />
      </div>
      <Button type="submit" variant="primary" size="md" disabled={busy} loading={busy}>
        <span aria-hidden="true">♘</span> Send Message
      </Button>
    </form>
  );
}
