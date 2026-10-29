import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { useEffect, useRef, useState } from 'react';
import CertificatePreview from './CertificatePreview';
import { getTemplate } from '../services/certificatesApi';
import { Spinner } from './ui';
import Button from './Button';

/* Available box for the artwork. The certificate is fitted by BOTH axes: its
   width is min(stage width, stage height x artwork ratio), so the preview never
   makes the modal taller than the viewport and never crops the layout. */
function useStageSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

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
  const [stageRef, stage] = useStageSize();

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

  const tpl = template?.layout?.template;
  const ratio = tpl && tpl.height ? tpl.width / tpl.height : 1490 / 1055;
  const fittedWidth = stage.width && stage.height
    ? Math.floor(Math.min(stage.width, stage.height * ratio))
    : 0;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Certificate preview: ${certificate.title}`}
    >
      <div
        className="chess-card w-full max-w-4xl p-5 max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 mb-3">
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

        {/* The stage always exists so its size is measured before the artwork
            arrives; the preview is then rendered at the fitted width. */}
        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">
          {!template && !error && <Spinner text="Loading the certificate artwork…" />}
          {template && fittedWidth > 0 && (
            <div style={{ width: `${fittedWidth}px` }}>
              <CertificatePreview
                layout={template.layout}
                content={certificate.preview}
                artwork={template.template.dataUrl || template.template.url || '/certificate-template.png'}
              />
            </div>
          )}
        </div>

        {template && (
          <>
            {certificate.fileUrl && (
              <div className="shrink-0 flex flex-wrap gap-2 mt-3">
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

            <p className="shrink-0 text-xs text-ivory-700 mt-2">
              Same artwork and layout as the generated PDF.
            </p>
          </>
        )}
      </div>
    </div>
  );
}