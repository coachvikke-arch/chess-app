import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Certificate, { CERT_W } from './Certificate';

/**
 * <CertificateModal open onClose={fn} certificate={{ playerName, tournamentName, position, score, date }} />
 * PNG download needs:  npm i html-to-image
 */
export default function CertificateModal({ open, onClose, certificate }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
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

  if (!open || !certificate) return null;

  const fileName = `${certificate.tournamentName}-${certificate.playerName}`.replace(/[^a-z0-9]+/gi, '_');

  async function downloadPng() {
    setError('');
    setBusy(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(ref.current, { pixelRatio: 2, cacheBust: true, style: { transform: 'none' } });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${fileName}.png`;
      a.click();
    } catch (e) {
      setError('PNG download failed. Use Print / Save as PDF instead.');
    } finally {
      setBusy(false);
    }
  }

  const btn = { padding: '10px 18px', borderRadius: 8, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
  const ghost = { ...btn, background: 'transparent', color: '#cfe0ff' };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Certificate preview" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(3,6,14,0.88)', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" style={btn} onClick={() => window.print()}>Print / Save as PDF</button>
        <button type="button" style={btn} onClick={downloadPng} disabled={busy}>{busy ? 'Preparing…' : 'Download PNG'}</button>
        <button type="button" style={ghost} onClick={onClose}>Close</button>
      </div>
      {error && <div style={{ color: '#ffb4b4', fontSize: 14 }}>{error}</div>}
      <Certificate {...certificate} scale={scale} innerRef={ref} />
    </div>,
    document.body
  );
}
