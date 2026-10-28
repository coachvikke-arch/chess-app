import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * Certificate preview — renders the SAME artwork and the SAME field geometry the
 * PDF renderer uses.
 *
 * This is deliberately not an approximation. It draws the identical template PNG
 * (the prepared artwork, with the sample name already erased) with the field
 * values the server resolved, positioned from the identical layout JSON. The only
 * differences from the generated file are that this is HTML text over an <img>
 * rather than text drawn into a PDF, and that the browser substitutes a
 * web-safe face where the PDF embeds a real font file.
 *
 * TYPE SIZE IS MEASURED, NOT GUESSED
 * The layout's font sizes are in template pixels. To place them at the same scale
 * as the PDF the component measures its own rendered width and converts:
 *
 *   rendered font size = width * (layout size / layout template width)
 *
 * which is exactly the PDF's px -> pt conversion in reverse. A CSS-only
 * approximation (vh, %, cqw) would drift as the modal resizes, and a percentage
 * font-size resolves against the PARENT's font size rather than the image.
 */

/* The browser cannot embed a TTF the way pdfkit does, so each layout font key maps
   to the closest available face. The PDF embeds the real files; the preview only
   has to look the same. French Script MT is installed on Windows, and the generic
   families keep macOS and Linux close. */
const FONT_STACKS = {
  script: '"French Script MT", "Vivaldi", "Segoe Script", "Brush Script MT", cursive',
  displayRegular: 'Georgia, "Times New Roman", serif',
  displayBold: 'Georgia, "Times New Roman", serif',
  bodyRegular: '"Segoe UI", Helvetica, Arial, sans-serif',
  bodyBold: '"Segoe UI", Helvetica, Arial, sans-serif',
};

/** Template pixels -> rendered pixels, from the measured element width. */
function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

/**
 * One positioned field.
 *
 * Every box is a percentage of the artwork, so the layout scales with the modal at
 * any size. Text is clamped to the layout's maxLines, mirroring the renderer's
 * shrink-to-fit: the browser cannot shrink type the way pdfkit measures glyphs, so
 * the preview keeps the nominal size and clamps. The PDF is the authority on final
 * size, and it never overflows.
 */
function Field({ field, value, ratio, template, segments }) {
  const pctX = (v) => `${(v / template.width) * 100}%`;
  const pctY = (v) => `${(v / template.height) * 100}%`;

  if (field.role === 'image') {
    if (!value) return null;
    return (
      <img
        src={value}
        alt=""
        className="cert-field"
        style={{
          left: pctX(field.x),
          top: pctY(field.y),
          width: pctX(field.w),
          height: pctY(field.h),
          objectFit: 'contain',
        }}
      />
    );
  }

  if (field.rich && Array.isArray(segments) && segments.length) {
    return (
      <div
        className="cert-field cert-field-text"
        style={{
          left: pctX(field.x),
          top: pctY(field.y),
          width: pctX(field.w),
          fontSize: `${field.size * ratio}px`,
          lineHeight: 1.18,
          color: field.color,
          textAlign: field.align || 'left',
          fontFamily: FONT_STACKS[field.font] || FONT_STACKS.bodyRegular,
          whiteSpace: 'nowrap',
        }}
      >
        {/* Centred as one unit, exactly as the renderer composes the weighted
            runs before drawing them. */}
        <span className="cert-rich">
          {segments.map((s, i) => (
            <span key={i} style={{ fontWeight: s.bold ? 700 : 400 }}>{s.text}</span>
          ))}
        </span>
      </div>
    );
  }

  const text = field.uppercase ? String(value ?? '').toUpperCase() : String(value ?? '');
  if (!text.trim()) return null;

  return (
    <div
      className="cert-field cert-field-text"
      style={{
        left: pctX(field.x),
        top: pctY(field.y),
        width: pctX(field.w),
        fontSize: `${field.size * ratio}px`,
        lineHeight: 1.18,
        letterSpacing: field.letterSpacing ? `${field.letterSpacing * ratio}px` : undefined,
        color: field.color,
        textAlign: field.align || 'left',
        textTransform: field.uppercase ? 'uppercase' : undefined,
        fontFamily: FONT_STACKS[field.font] || FONT_STACKS.bodyRegular,
        WebkitLineClamp: field.maxLines || 1,
      }}
    >
      {text}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.layout   layout JSON from GET /certificates/template
 * @param {object} props.content  server-resolved field values
 * @param {string} props.artwork  artwork (a data URL from the server)
 * @param {string} [props.className]
 */
export default function CertificatePreview({ layout, content, artwork, className = '' }) {
  const [ref, width] = useElementWidth();

  const template = layout?.template || { width: 1490, height: 1055 };
  const fields = layout?.fields || [];
  /* Zero until measured, so nothing renders for a frame at the wrong size. */
  const ratio = width ? width / template.width : 0;

  /* Draw once the width is known so the first painted frame is already correct. */
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => { if (ratio > 0) setReady(true); }, [ratio]);

  const [imgSrc, setImgSrc] = useState(artwork);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgSrc(artwork);
    setImgError(false);
  }, [artwork]);

  return (
    <div
      ref={ref}
      className={`cert-preview ${className}`}
      style={{ aspectRatio: `${template.width} / ${template.height}` }}
    >
      {!imgError ? (
        <img 
          src={imgSrc} 
          alt="Certificate artwork" 
          className="cert-preview-art" 
          draggable={false}
          onError={() => {
            // Try fallback paths
            if (imgSrc && imgSrc.includes('data:')) {
              setImgSrc('/certificate-template.png');
            } else if (imgSrc && imgSrc.includes('/certificate-template')) {
              // try api base if available
              const apiBase = import.meta.env.VITE_API_URL || '';
              if (apiBase) {
                setImgSrc(`${apiBase}/certificate-template.png`);
              } else {
                setImgError(true);
              }
            } else {
              setImgError(true);
            }
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fdfbf4', flexDirection: 'column', gap: '8px' }}>
          <div style={{ color: '#8b7355', fontSize: '14px' }}>Certificate artwork failed to load</div>
          <button onClick={() => { setImgError(false); setImgSrc(artwork || '/certificate-template.png'); }} style={{ padding: '4px 8px', fontSize: '12px' }}>Retry</button>
        </div>
      )}
      {ready && !imgError && fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={content?.[field.key]}
          segments={content?.[`${field.key}_segments`]}
          ratio={ratio}
          template={template}
        />
      ))}
    </div>
  );
}