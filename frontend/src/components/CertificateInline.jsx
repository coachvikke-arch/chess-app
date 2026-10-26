import { useEffect, useState } from 'react';
import CertificatePreview from './CertificatePreview';
import { getTemplate } from '../services/certificatesApi';
import { Spinner } from './ui';
import Button from './Button';

/*
 * "Show in page" — the certificate drawn INSIDE the page instead of in a modal.
 *
 * Same component, same artwork and same layout as the modal preview, because both
 * read the one document the PDF is generated from. The only difference is where it
 * is mounted, so the two cannot drift apart.
 *
 * The download/open links are repeated here rather than left to the card: once the
 * certificate is open in the page, the action the viewer wants is right below it,
 * not back up in the row they were looking at.
 */
export default function CertificateInline({ certificate, onHide, showOpenPdf = true, className = '' }) {
  const [template, setTemplate] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getTemplate()
      .then((data) => { if (alive) setTemplate(data); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);

  const href = certificate?.fileUrlAbsolute || certificate?.fileUrl;

  return (
    <div className={`cert-inline ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs uppercase tracking-[0.16em] text-ivory-500 font-bold">
          In page
        </p>
        {onHide && (
          <Button
            type="button"
            variant="secondary" size="sm" className="!px-3 !py-1 text-xs"
            onClick={onHide}
          >
            Hide
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!template && !error && <Spinner text="Loading the certificate artwork…" />}

      {template && (
        <>
          <CertificatePreview
            layout={template.layout}
            content={certificate.preview}
            artwork={template.template.dataUrl || template.template.url}
          />

          <div className="flex flex-wrap gap-2 mt-3">
            {href ? (
              <>
                {showOpenPdf && (
                  <Button
                    variant="primary" size="md"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open PDF
                  </Button>
                )}
                <Button variant="secondary" size="md" href={certificate.fileUrl} download>
                  Download
                </Button>
              </>
            ) : (
              <p className="text-xs text-ivory-500">
                The PDF has not been generated yet. An administrator can generate it
                from the Certificates page.
              </p>
            )}
          </div>

          <p className="text-xs text-ivory-700 mt-3">
            This is the same artwork and the same layout the PDF uses.
          </p>
        </>
      )}
    </div>
  );
}
