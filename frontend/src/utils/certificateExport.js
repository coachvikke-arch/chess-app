/*
 * Export the tournament certificate.
 *
 * Both the PNG and the PDF are rasterised from the SAME DOM node the admin is
 * looking at, by the browser itself (html-to-image wraps the node in an SVG
 * foreignObject). That is what makes "preview = export" true: there is no
 * second renderer to drift, and gradient type, the gold medal and the web fonts
 * all come out exactly as drawn on screen.
 *
 * The node is the fixed 1999x1414 stage, so the transform that shrinks it to fit
 * the modal is neutralised for the capture and the output is always full size,
 * regardless of the window.
 */

import { TCERT_H, TCERT_W } from './tournamentCertificate';

/** Fonts and images must be decoded before the first glyph is rasterised. */
export async function waitForCertificateAssets(node) {
  if (typeof document === 'undefined') return;
  try {
    await document.fonts.ready;
  } catch (err) {
    /* A browser without the Font Loading API still renders; it just cannot
       promise the serif is ready. */
  }
  const scope = node || document;
  const images = Array.from(scope.querySelectorAll?.('img') || []);
  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }));
}

/** The certificate stage as a 2x PNG data URL. */
export async function renderCertificatePng(node) {
  if (!node) throw new Error('The certificate is not on screen yet');
  await waitForCertificateAssets(node);
  const { toPng } = await import('html-to-image');
  return toPng(node, {
    width: TCERT_W,
    height: TCERT_H,
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: '#ffffff',
    style: {
      transform: 'none',
      transformOrigin: 'top left',
      width: `${TCERT_W}px`,
      height: `${TCERT_H}px`,
    },
  });
}

export function downloadDataUrl(dataUrl, fileName) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 'MZ-T-2026-0004-Nagavel-K.png' — stable, filesystem-safe, traceable. */
export function certificateFileName(certificateNo, studentName, ext) {
  const base = [certificateNo, studentName]
    .filter(Boolean)
    .join('-')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'certificate';
  return `${base}.${ext}`;
}

export async function downloadCertificatePng(node, fileName) {
  const dataUrl = await renderCertificatePng(node);
  downloadDataUrl(dataUrl, fileName);
  return dataUrl;
}

/** A4 landscape PDF, the certificate filling the page edge to edge. */
export async function downloadCertificatePdf(node, fileName) {
  const dataUrl = await renderCertificatePng(node);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  pdf.addImage(dataUrl, 'PNG', 0, 0, 297, 210, undefined, 'FAST');
  pdf.save(fileName);
  return dataUrl;
}
