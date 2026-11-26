import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from '../utils/clipboard';
import { useToast } from './Toast';

/**
 * Bottom sheet shared by My Profile and the public /card/:token page.
 * Copy link · WhatsApp · native share (when the browser has it) · optional
 * "Save card as image" · Close.
 */
export default function ShareCardSheet({ open, onClose, name, url, onSaveImage }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [savingImage, setSavingImage] = useState(false);

  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const shareText = `${name || 'MateZone player'}'s MateZone player card ${url}`;
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      showToast('Link copied.', { tone: 'success', title: 'Share card' });
    } else {
      showToast('Could not copy — select the link and copy it manually.', { tone: 'error', title: 'Share card' });
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({
        title: `${name || 'MateZone player'} · MateZone Chess Academy`,
        text: `${name || 'MateZone player'}'s MateZone player card`,
        url,
      });
    } catch {
      /* Closing the share sheet is not an error. */
    }
  };

  const saveImage = async () => {
    if (!onSaveImage) return;
    setSavingImage(true);
    try {
      await onSaveImage();
    } finally {
      setSavingImage(false);
    }
  };

  return createPortal(
    <div className="pc-sheet-layer" onClick={onClose} role="presentation">
      <div
        className="pc-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Share card"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="pc-sheet-grab" aria-hidden="true" />
        <h2>Share card</h2>

        <label className="pc-sheet-label" htmlFor="pc-share-url">Card link</label>
        <div className="pc-sheet-link">
          <input id="pc-share-url" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" className="myqr-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>

        <div className="pc-sheet-actions">
          <a
            className="myqr-btn pc-sheet-wa"
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
          {canNativeShare && (
            <button type="button" className="myqr-btn" onClick={nativeShare}>More…</button>
          )}
          {onSaveImage && (
            <button type="button" className="myqr-btn" onClick={saveImage} disabled={savingImage}>
              {savingImage ? 'Saving…' : 'Save card as image'}
            </button>
          )}
          <button type="button" className="myqr-btn myqr-btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
