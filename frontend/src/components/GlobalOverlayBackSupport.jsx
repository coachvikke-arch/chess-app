import { useEffect } from 'react';

const OVERLAY_SELECTOR = '[role="dialog"], [aria-modal="true"], .modal, .modal-overlay, .backdrop, .dialog, .popup, .drawer, .sheet, [data-overlay]';

function isOverlay(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.getAttribute && el.getAttribute('data-overlay-connected') === '1') return false;
  const style = window.getComputedStyle(el);
  const fixed = style.position === 'fixed';
  const full = el.classList && (el.classList.contains('modal') || el.classList.contains('overlay') || el.classList.contains('backdrop') || el.classList.contains('dialog') || el.classList.contains('popup') || el.classList.contains('drawer') || el.classList.contains('sheet'));
  if (!fixed && !full) return false;
  // ignore toasts/tooltips/dropdowns
  if (el.classList && (el.classList.contains('toast') || el.classList.contains('tooltip') || el.classList.contains('dropdown'))) return false;
  return el.matches(OVERLAY_SELECTOR);
}

export default function GlobalOverlayBackSupport() {
  useEffect(() => {
    const stack = [];
    let handlingPop = false;
    const MAX_STACK = 20;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (isOverlay(node)) {
            if (!stack.includes(node) && stack.length < MAX_STACK) {
              stack.push(node);
              try { window.history.pushState({ globalOverlay: true }, ''); } catch {}
            }
          }
        }
        for (const node of m.removedNodes) {
          const idx = stack.indexOf(node);
          if (idx !== -1) {
            stack.splice(idx, 1);
            if (!handlingPop) {
              handlingPop = true;
              try { window.history.back(); } catch {}
              setTimeout(() => { handlingPop = false; }, 0);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onPop = () => {
      const top = stack[stack.length - 1];
      if (!top) return;
      // try close
      const closeBtn = top.querySelector('[aria-label*="lose" i], .close, [data-close]');
      if (closeBtn) { closeBtn.click(); return; }
      const backdrop = top.querySelector('.backdrop, .overlay');
      if (backdrop && backdrop !== top) { backdrop.click(); return; }
      top.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      console.warn('GlobalOverlayBackSupport: could not close overlay', top.className || top.id);
    };
    window.addEventListener('popstate', onPop);

    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  return null;
}
