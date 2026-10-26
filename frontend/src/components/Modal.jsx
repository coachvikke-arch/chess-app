import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * One centered dialog used by every Play Arena popup.
 *
 * Handles the shared behaviour so the six popups cannot drift apart:
 * portal rendering, scroll lock, focus trap/restore, Escape, backdrop click
 * and the fade + scale entrance. Content and footer are supplied by callers.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  icon = null,
  children,
  footer = null,
  size = 'md',
  id,
  closeLabel = 'Close dialog',
  returnFocusRef = null,
  busy = false,
}) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const body = document.body;
    const root = document.getElementById('root');
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const previousInert = root ? root.inert : undefined;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    if (root) root.inert = true;

    const panel = panelRef.current;
    const focusTimer = window.setTimeout(() => {
      const first = panel?.querySelector(FOCUSABLE);
      (first || panel)?.focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const items = Array.from(panel.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      if (root) root.inert = previousInert;

      const target = returnFocusRef?.current || previouslyFocused;
      if (target && typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    };
    // returnFocusRef is a ref object; its identity is stable, the current value
    // is read on cleanup so the tile clicked most recently gets focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="mz-modal-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) closeRef.current?.();
      }}
    >
      <div
        className={`mz-modal mz-modal-${size}`}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="mz-modal-head">
          <div className="mz-modal-heading">
            <h2 className="mz-modal-title" id={titleId}>
              {icon && <span className="mz-modal-icon" aria-hidden>{icon}</span>}
              <span>{title}</span>
            </h2>
            {description && <p className="mz-modal-desc" id={descId}>{description}</p>}
          </div>
          <button
            type="button"
            className="mz-modal-close"
            onClick={() => closeRef.current?.()}
            aria-label={closeLabel}
            title={closeLabel}
          >
            ✕
          </button>
        </header>

        <div className="mz-modal-body">{children}</div>
        {footer && <footer className="mz-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
