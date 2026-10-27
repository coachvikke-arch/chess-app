import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import Certificate, { CERT_W } from './Certificate';

/* Same preview as CertificateModal, but walks a list of certificates so the
   podium (top 3) can be rendered and downloaded one at a time. */
export default function CertificateBatchModal({ open, onClose, certificates = [] }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const fit = () => setScale(Math.min(1, (window.innerWidth - 48) / CERT_W));
    const esc = (e) => e.key === 'Escape' && onClose?.();
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setError('');
  }, [open, certificates]);

  if (!open || !certificates.length) return null;

  const current = certificates[Math.min(index, certificates.length - 1)];
  const fileName = (c) => `${c.tournamentName}-${c.playerName}`.replace(/[^a-z0-9]+/gi, '_');

  async function saveCurrent() {
    setError('');
    setBusy(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(ref.current, { pixelRatio: 2, cacheBust: true, style: { transform: 'none' } });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${fileName(current)}.png`;
      a.click();
    } catch (e) {
      setError('PNG download failed. Use Print / Save as PDF instead.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadAll() {
    setError('');
    setBusy(true);
    try {
      const { toPng } = await import('html-to-image');
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      for (let i = 0; i < certificates.length; i += 1) {
        /* Render the certificate before capturing it: the preview shows each
           one in turn while the file is written. */
        flushSync(() => setIndex(i));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const dataUrl = await toPng(ref.current, { pixelRatio: 2, cacheBust: true, style: { transform: 'none' } });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${fileName(certificates[i])}.png`;
        a.click();
        /* Browsers throttle a burst of downloads; give each file its own beat. */
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } catch (e) {
      setError('Some downloads failed. Use Print / Save as PDF instead.');
    } finally {
      setBusy(false);
    }
  }

  const btn = { padding: '10px 18px', borderRadius: 8, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
  const ghost = { ...btn, background: 'transparent', color: '#cfe0ff' };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Certificate preview" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(3,6,14,0.88)', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" style={btn} onClick={downloadAll} disabled={busy}>{busy ? 'Preparing…' : `Download all (${certificates.length})`}</button>
        <button type="button" style={ghost} onClick={saveCurrent} disabled={busy}>Download this one</button>
        <button type="button" style={ghost} onClick={() => window.print()}>Print / Save as PDF</button>
        <button type="button" style={ghost} onClick={onClose}>Close</button>
      </div>
      {certificates.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#cfe0ff', fontSize: 14 }}>
          <button type="button" style={{ ...ghost, padding: '6px 12px' }} disabled={busy || index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>‹ Prev</button>
          <span>{index + 1} / {certificates.length} · {current.playerName}</span>
          <button type="button" style={{ ...ghost, padding: '6px 12px' }} disabled={busy || index === certificates.length - 1} onClick={() => setIndex((i) => Math.min(certificates.length - 1, i + 1))}>Next ›</button>
        </div>
      )}
      {error && <div style={{ color: '#ffb4b4', fontSize: 14 }}>{error}</div>}
      <Certificate {...current} scale={scale} innerRef={ref} />
    </div>,
    document.body
  );
}
