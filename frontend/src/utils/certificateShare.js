/*
 * Sending a certificate over WhatsApp, with the PDF attached.
 *
 * WHY NOT JUST THE wa.me LINK
 * `https://wa.me/<phone>?text=...` can only ever prefill TEXT. It has no way to
 * attach a document — that is a limitation of the deep-link format, not of this
 * app. Attaching the PDF therefore needs a different mechanism.
 *
 * WHAT ACTUALLY WORKS FROM A BROWSER
 * The Web Share API can hand FILES to the operating system's share sheet:
 *
 *   navigator.share({ files: [pdfFile], title, text })
 *
 * On a phone that sheet lists WhatsApp directly, and the message goes out with the
 * PDF already attached. This is the only route that attaches the file without a
 * server-side WhatsApp Business account, and it needs no configuration.
 *
 * WHERE IT IS NOT AVAILABLE
 * Desktop Firefox, and some desktop browsers, do not support sharing files. There
 * the fallback is: save the PDF to the device, then open the prefilled wa.me
 * message, and the admin attaches the file they just downloaded. Annoying, but it
 * is a platform limit rather than something this code can work around.
 *
 * The other option — the WhatsApp Cloud API — would attach the PDF server-side and
 * send without the admin in the loop, but it needs a Meta Business account, a
 * verified phone number and an access token, and it changes the product from
 * "the academy sends from WhatsApp" to "the academy's own number sends". That is a
 * decision to make deliberately, not one to slip in here. See CERTIFICATES.md.
 */

/**
 * Open the wa.me conversation.
 *
 * Used on the fallback path: the PDF has been saved to the device and the prefilled
 * greeting is opened, so the parent gets both.
 */
export function openWhatsApp(waUrl) {
  if (!waUrl) return false;
  const win = window.open(waUrl, '_blank', 'noopener,noreferrer');
  return Boolean(win);
}

/**
 * Save a PDF to the device.
 *
 * Used by the fallback path. Object URLs are revoked afterwards so a long session
 * does not leak the blob.
 */
export function savePdf(file, filename) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'certificate.pdf';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  /* Revoking immediately can cancel the download in some browsers, so this waits
     for the current task to finish. */
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** A sensible download name: the certificate number, which is its identity. */
export function pdfFilename(certificateNo) {
  const safe = String(certificateNo || 'certificate').replace(/[^A-Za-z0-9_-]/g, '');
  return `${safe || 'certificate'}.pdf`;
}

const PDF_MIME = 'application/pdf';

/** True when this browser can share files at all. */
export function canShareFiles() {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([new Blob()], 'probe.pdf', { type: PDF_MIME })] });
  } catch (err) {
    return false;
  }
}

/**
 * True when this browser can share the file AND the greeting text together.
 *
 * This is checked separately from canShareFiles because the two are not the same
 * question. Several browsers will happily share a file on its own but reject a
 * payload that mixes files with text — and it is the greeting that matters here, so
 * a file-only share is not good enough. When the combination is unsupported the
 * caller falls back to downloading the PDF and opening the prefilled message,
 * which carries the greeting.
 */
export function canShareFileWithText() {
  if (!canShareFiles()) return false;
  try {
    return navigator.canShare({
      files: [new File([new Blob()], 'probe.pdf', { type: PDF_MIME })],
      text: 'probe',
    });
  } catch (err) {
    return false;
  }
}

/**
 * Share the certificate PDF with the greeting message.
 *
 * `text` is the rendered greeting the server produced, so the parent receives the
 * same words whether the message arrives as a share payload or as a prefilled wa.me
 * conversation.
 *
 * @returns {Promise<
 *   | { result: 'shared' }
 *   | { result: 'shared_without_text', reason: string }
 *   | { result: 'downloaded', reason: string }
 *   | { result: 'cancelled' }
 *   | { result: 'failed', reason: string }
 * >}
 */
export async function shareCertificate({ file, waUrl, filename, text, title }) {
  if (!file) return { result: 'failed', reason: 'The certificate PDF could not be loaded' };

  const payload = { files: [file], title: title || filename };
  if (text) payload.text = text;

  if (canShareFiles()) {
    try {
      await navigator.share(payload);
      return { result: 'shared' };
    } catch (err) {
      /* An aborted share is the admin changing their mind, not an error, and must
         not mark the certificate as sent. */
      if (err && err.name === 'AbortError') return { result: 'cancelled' };
      /* Some browsers report an unsupported payload as a TypeError here rather than
         failing canShare up front. If it was the text that broke it, retry with the
         file alone so the PDF still reaches the parent. */
      if (err instanceof TypeError && text) {
        try {
          await navigator.share({ files: [file], title: title || filename });
          return {
            result: 'shared_without_text',
            reason: 'This browser cannot include the greeting with the file — the parent will get the PDF on its own.',
          };
        } catch (retryErr) {
          if (retryErr && retryErr.name === 'AbortError') return { result: 'cancelled' };
        }
      }
      if (err instanceof TypeError) {
        savePdf(file, filename);
        return { result: 'downloaded', reason: 'This browser cannot attach files in WhatsApp' };
      }
      return { result: 'failed', reason: err && err.message ? err.message : 'Sharing failed' };
    }
  }

  savePdf(file, filename);
  return { result: 'downloaded', reason: 'This browser cannot attach files in WhatsApp' };
}