/*
 * The podium at once: one stage, walked through the list, so "download all"
 * exports exactly what the admin steps through on screen.
 *
 * Each certificate is rendered before it is captured (flushSync + two frames),
 * because the bitmap is taken from the live node — capturing during the React
 * commit would export the previous certificate for every file but the first.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import TournamentCertificate from './TournamentCertificate';
import Button from '../Button';
import { useOverlayHistory } from '../../hooks/useOverlayHistory';
import { TCERT_W, tournamentCertificateData } from '../../utils/tournamentCertificate';
import {
  certificateFileName,
  downloadDataUrl,
  renderCertificatePng,
  waitForCertificateAssets,
} from '../../utils/certificateExport';
import './tournamentCertificateModal.css';

export default function TournamentCertificateBatchModal({ open, onClose, certificates = [] }) {
  useOverlayHistory('tournament-certificate-batch', open, onClose);

  const stageRef = useRef(null);
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const data = certificates.map((c) => tournamentCertificateData(c || {}));
  const current = data[Math.min(index, Math.max(0, data.length - 1))];

  useEffect(() => {
    if (!open) return undefined;
    setIndex(0);
    setError('');
    setBusy('');
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, certificates]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const el = wrapRef.current;
    if (!el) return undefined;
    const fit = () => {
      const width = el.clientWidth;
      if (width > 0) setScale(Math.min(1, width / TCERT_W));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  if (!open || !data.length) return null;

  const nameFor = (d) => certificateFileName(null, d.studentName, 'png').replace(/\.png$/, '');

  async function saveOne(d) {
    await waitForCertificateAssets(stageRef.current);
    const dataUrl = await renderCertificatePng(stageRef.current);
    downloadDataUrl(dataUrl, `${nameFor(d)}.png`);
  }

  async function downloadCurrent() {
    if (busy) return;
    setError('');
    setBusy('one');
    try {
      await saveOne(current);
    } catch (err) {
      setError(err?.message || 'The download failed. Try again, or save one at a time.');
    } finally {
      setBusy('');
    }
  }

  async function downloadAll() {
    if (busy) return;
    setError('');
    setBusy('all');
    try {
      for (let i = 0; i < data.length; i += 1) {
        /* Show the certificate being written: the student's name on screen is
           the progress indicator, and the capture is of that same node. */
        flushSync(() => setIndex(i));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await saveOne(data[i]);
        /* A burst of downloads is throttled by the browser; give each file its
           own beat or later ones are silently dropped. */
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } catch (err) {
      setError(err?.message || 'Some downloads failed. Try saving them one at a time.');
    } finally {
      setBusy('');
    }
  }

  return createPortal(
    <div className="tcm-overlay" role="dialog" aria-modal="true" aria-labelledby="tcm-batch-title" onClick={onClose}>
      <div className="tcm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="tcm-head">
          <div className="tcm-head-text">
            <h2 className="tcm-title" id="tcm-batch-title">Podium certificates</h2>
            <p className="tcm-sub">
              {data.length} certificate{data.length === 1 ? '' : 's'}
              {current?.studentName ? ` · viewing ${current.studentName}` : ''}
            </p>
          </div>
          <button type="button" className="tcm-close" onClick={onClose} aria-label="Close preview">×</button>
        </header>

        {data.length > 1 && (
          <div className="tcm-pager">
            <Button type="button" variant="secondary" size="sm" disabled={Boolean(busy) || index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              ‹ Prev
            </Button>
            <span className="tcm-pager-label">{index + 1} / {data.length}{current?.studentName ? ` · ${current.studentName}` : ''}</span>
            <Button type="button" variant="secondary" size="sm" disabled={Boolean(busy) || index === data.length - 1} onClick={() => setIndex((i) => Math.min(data.length - 1, i + 1))}>
              Next ›
            </Button>
          </div>
        )}

        <div className="tcm-stage-wrap" ref={wrapRef}>
          {scale > 0 && <TournamentCertificate data={current} scale={scale} innerRef={stageRef} />}
        </div>

        {error && <p className="tcm-error" role="alert">{error}</p>}

        <div className="tcm-actions">
          <Button type="button" variant="secondary" size="md" disabled={Boolean(busy)} loading={busy === 'one'} onClick={downloadCurrent}>
            Download this one
          </Button>
          <Button type="button" variant="primary" size="md" disabled={Boolean(busy)} loading={busy === 'all'} onClick={downloadAll}>
            Download all ({data.length})
          </Button>
        </div>

        <p className="tcm-hint">
          Files are saved as PNG. Use the single preview for PDF or WhatsApp.
        </p>
      </div>
    </div>,
    document.body
  );
}
