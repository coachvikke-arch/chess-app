/*
 * Preview / export / send for a tournament certificate.
 *
 * Preview and export share one rendered stage: the PNG is rasterised from the
 * node on screen, so the file cannot differ from what the admin approved. The
 * PDF is that same PNG placed on an A4 landscape page — the certificate's
 * proportions (1999:1414) are within 0.05% of A4's, so it fills the page with no
 * letterboxing.
 *
 * WhatsApp is a deep link, which cannot carry an attachment. So the image is
 * saved to the device first, the conversation is opened second, and only then is
 * the certificate recorded as sent. A missing or unusable phone number is
 * reported inline and the button stays disabled rather than opening a broken
 * chat.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TournamentCertificate from './TournamentCertificate';
import Button from '../Button';
import { useOverlayHistory } from '../../hooks/useOverlayHistory';
import { buildWhatsAppUrl } from '../../utils/certificateTemplate';
import {
  buildTournamentMessage,
  TCERT_W,
  tournamentCertificateData,
} from '../../utils/tournamentCertificate';
import {
  certificateFileName,
  downloadCertificatePdf,
  downloadCertificatePng,
  downloadDataUrl,
  renderCertificatePng,
} from '../../utils/certificateExport';
import { markSent } from '../../services/certificatesApi';
import './tournamentCertificateModal.css';

export default function TournamentCertificateModal({
  open, onClose, certificate, onSent, initialAction = null, readOnly = false,
}) {
  useOverlayHistory('tournament-certificate', open, onClose);

  const data = tournamentCertificateData(certificate || {});
  const stageRef = useRef(null);
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const phone = certificate?.phone || '';
  const phoneError = certificate?.phoneError || (phone ? '' : 'No phone number saved for this student');
  const phoneValid = Boolean(phone) && !phoneError;

  useEffect(() => {
    if (!open) return undefined;
    setBusy('');
    setError('');
    setSent(certificate?.status === 'sent');
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, certificate?.id, certificate?.status]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* The stage is a fixed 1999px wide drawing; the wrapper decides how much room
     it has, and the certificate is scaled (never re-laid out) to fit. */
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

  /* A card button names the action it wants (PNG / PDF / send). Run it once the
     stage has been measured, or the capture would be of a zero-width frame. */
  const firedRef = useRef('');
  useEffect(() => {
    if (!open || !initialAction || scale <= 0) return undefined;
    const key = `${certificate?.id}:${initialAction}`;
    if (firedRef.current === key) return undefined;
    firedRef.current = key;
    const timer = setTimeout(() => {
      if (initialAction === 'png') onDownloadPng();
      else if (initialAction === 'pdf') onDownloadPdf();
      else if (initialAction === 'send') onSend();
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAction, scale, certificate?.id]);

  if (!open) return null;

  const fileNameBase = certificateFileName(certificate?.certificateNo, data.studentName, 'png').replace(/\.png$/, '');
  const message = buildTournamentMessage(data);

  async function run(label, fn) {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy('');
    }
  }

  function onDownloadPng() {
    return run('png', async () => {
      await downloadCertificatePng(stageRef.current, `${fileNameBase}.png`);
    });
  }

  function onDownloadPdf() {
    return run('pdf', async () => {
      await downloadCertificatePdf(stageRef.current, `${fileNameBase}.pdf`);
    });
  }

  function onSend() {
    return run('send', async () => {
      let waUrl;
      try {
        waUrl = buildWhatsAppUrl(phone, message);
      } catch (err) {
        throw new Error(err.message);
      }

      /* Opened before the await so the browser still counts it as part of the
         click; the tab is pointed at WhatsApp once the image has been saved. */
      const win = window.open('about:blank', '_blank');
      if (win) {
        win.opener = null;
        win.document.title = 'WhatsApp';
      }

      const dataUrl = await renderCertificatePng(stageRef.current);
      downloadDataUrl(dataUrl, `${fileNameBase}.png`);
      if (win) win.location.replace(waUrl);
      else window.open(waUrl, '_blank', 'noopener,noreferrer');

      const updated = await markSent(certificate.id);
      setSent(true);
      onSent?.(updated);
    });
  }

  return createPortal(
    <div className="tcm-overlay" role="dialog" aria-modal="true" aria-labelledby="tcm-title" onClick={onClose}>
      <div className="tcm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="tcm-head">
          <div className="tcm-head-text">
            <h2 className="tcm-title" id="tcm-title">Certificate preview</h2>
            <p className="tcm-sub">
              {certificate?.certificateNo}
              {data.studentName ? ` · ${data.studentName}` : ''}
            </p>
          </div>
          <button type="button" className="tcm-close" onClick={onClose} aria-label="Close preview">×</button>
        </header>

        <div className="tcm-stage-wrap" ref={wrapRef}>
          {scale > 0 && (
            <TournamentCertificate data={data} scale={scale} innerRef={stageRef} />
          )}
        </div>

        {error && <p className="tcm-error" role="alert">{error}</p>}
        {!readOnly && !phoneValid && <p className="tcm-note">{phoneError}</p>}
        {sent && phoneValid && !readOnly && <p className="tcm-sent">Marked as sent.</p>}

        <div className="tcm-actions">
          <Button type="button" variant="secondary" size="md" disabled={Boolean(busy)} loading={busy === 'png'} onClick={onDownloadPng}>
            Download PNG
          </Button>
          <Button type="button" variant="secondary" size="md" disabled={Boolean(busy)} loading={busy === 'pdf'} onClick={onDownloadPdf}>
            Download PDF
          </Button>
          {!readOnly && (
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!phoneValid || Boolean(busy)}
              loading={busy === 'send'}
              title={phoneValid ? 'Saves the image, then opens WhatsApp with the greeting.' : phoneError}
              onClick={onSend}
            >
              Send on WhatsApp
            </Button>
          )}
        </div>

        {!readOnly && (
          <p className="tcm-hint">
            WhatsApp cannot receive a file from a link, so the image is saved first — attach it in the chat that opens.
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
