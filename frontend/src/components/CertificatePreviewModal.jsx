import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { useEffect, useState } from 'react';
import CertificatePreview from './CertificatePreview';
import { getTemplate } from '../services/certificatesApi';
import { Spinner } from './ui';
import Button from './Button';

/*
 * Modal wrapper around CertificatePreview.
 *
 * The artwork is fetched once and cached for the session (see getTemplate): it is
 * ~1.2MB of base64, far too heavy to send with every certificate in a list, so
 * it is a separate one-off request the first time a preview is opened.
 */
export default function CertificatePreviewModal({ certificate, onClose }) {
  useOverlayHistory('CertificatePreviewModal', true, onClose);
  const [template, setTemplate] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getTemplate()
      .then((data) => { if (alive) setTemplate(data); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Certificate preview: ${certificate.title}`}
    >
      <div
        className="chess-card w-full max-w-4xl p-5 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="chess-card-title">{certificate.title}</h3>
            <p className="text-xs text-ivory-500 mt-1">
              {certificate.studentName} · {certificate.certificateNo}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-ivory-500 hover:text-ivory-300 transition text-lg leading-none"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {!template && !error && <Spinner text="Loading the certificate artwork…" />}

        {template && (
          <>
            <CertificatePreview
              layout={template.layout}
              content={certificate.preview}
              artwork={template.template.dataUrl || template.template.url || '/certificate-template.png'}
            />

            {certificate.fileUrl && (
              <div className="flex flex-wrap gap-2 mt-4">
                <Button
                  variant="primary" size="md"
                  href={certificate.fileUrlAbsolute || certificate.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open PDF
                </Button>
                <Button variant="secondary" size="md" href={certificate.fileUrl} download>
                  Download
                </Button>
              </div>
            )}

            <p className="text-xs text-ivory-700 mt-3">
              This is a preview of the generated file, drawn from the same artwork
              and the same layout the PDF uses.
            </p>
          </>
        )}
      </div>
    </div>
  );
}