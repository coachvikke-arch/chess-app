import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { checkToastDedupe, DEDUPE_WINDOW_MS } from '../utils/toastDedupe';
import Button from './Button';

/* TEMPORARY duplicate-toast diagnosis. Every show/suppress decision logs id,
 * tone, title/message, the caller-supplied source tag, dedupe key and a
 * timestamp, plus console.trace() so the exact handler/file shows in the
 * call stack. Remove once the duplicate source is confirmed fixed. */
const TOAST_DEBUG = true;
function toastDebugLog(verb, info) {
  if (!TOAST_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(
    `[toast-debug] ${verb} id=${info.id} tone=${info.tone} ` +
    `title=${JSON.stringify(info.title || '')} message=${JSON.stringify(info.message || '')} ` +
    `source=${info.source || '?'} dedupeKey=${info.dedupeKey || '-'} t=${new Date(info.at).toISOString()}`
  );
  // eslint-disable-next-line no-console
  console.trace('[toast-debug] call stack');
}

/*
 * Global toast notification system.
 *
 * Provides a "UI way" to surface important in-app notifications instantly
 * (e.g. "Welcome back", "Invalid password", account created). Toasts slide up
 * from the bottom-right of the viewport, are colour-coded by tone,
 * auto-dismiss, and share the same visual language as the notification feed
 * in the bell.
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast('Keep it up!', { tone: 'success', title: 'Puzzle solved' });
 *
 * Tones: success (green) · error (red) · warning (amber) · info (gold/blue).
 */

const ToastContext = createContext(null);
let nextId = 1;

const TONE_STYLES = {
  success: { border: 'border-emerald-400/40', glow: 'shadow-[0_10px_30px_-8px_rgba(96,165,250,0.35)]', icon: '✓', iconCls: 'text-emerald-700 bg-emerald-500/15 border-emerald-400/30' },
  error: { border: 'border-red-400/40', glow: 'shadow-[0_10px_30px_-8px_rgba(255,123,123,0.4)]', icon: '✕', iconCls: 'text-red-600 bg-red-500/15 border-red-400/30' },
  warning: { border: 'border-amber-400/40', glow: 'shadow-[0_10px_30px_-8px_rgba(59,130,246,0.4)]', icon: '!', iconCls: 'text-amber-600 bg-amber-500/15 border-amber-400/30' },
  info: { border: 'border-gold-500/40', glow: 'shadow-[0_10px_30px_-8px_rgba(96,165,250,0.35)]', icon: 'ℹ', iconCls: 'text-gold-400 bg-gold-500/15 border-gold-400/30' },
};

function ToastCard({ toast, onDismiss }) {
  const t = TONE_STYLES[toast.tone] || TONE_STYLES.info;
  const clickable = typeof toast.onClick === 'function';
  return (
    <div
      className={`chess-toast pointer-events-auto w-80 max-w-[90vw] rounded-xl border ${t.border} ${t.glow} bg-ink-800 px-4 py-3 flex items-start gap-3 shadow-2xl ${clickable ? 'cursor-pointer' : ''}`}
      role={clickable ? 'button' : 'status'}
      tabIndex={clickable ? 0 : undefined}
      aria-live="polite"
      onClick={clickable ? () => { toast.onClick(); onDismiss(toast.id); } : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toast.onClick();
          onDismiss(toast.id);
        }
      } : undefined}
    >
      <span className={`mt-0.5 grid place-items-center w-7 h-7 shrink-0 rounded-lg border text-xs font-bold ${t.iconCls}`}>
        {t.icon}
      </span>
      <div className="min-w-0 flex-1">
        {toast.title && <p className="text-sm font-semibold text-ivory-300 leading-tight">{toast.title}</p>}
        <p className="text-xs text-ivory-500 mt-0.5 leading-snug">{toast.message}</p>
        {toast.actions && toast.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {toast.actions.map((a, i) => (
              <Button
                key={i}
                onClick={(e) => { e?.stopPropagation?.(); a.onClick(); onDismiss(toast.id); }}
                variant={a.outline ? 'danger' : 'primary'}
                size="sm"
                className="!px-3 !py-1 text-xs"
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
        {toast.action && (
          <Button
            onClick={(e) => { e?.stopPropagation?.(); toast.action.onClick(); onDismiss(toast.id); }}
            variant="primary" size="sm" className="mt-2 !px-3 !py-1 text-xs"
          >
            {toast.action.label}
          </Button>
        )}
        {clickable && (
          <p className="mt-1 text-[0.62rem] font-semibold text-gold-400">Tap to open ↗</p>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}
        className="shrink-0 text-ivory-500 hover:text-ivory-300 transition text-sm leading-none mt-0.5"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  /* Ids of the toasts currently on screen, tracked synchronously alongside the
   * state array. A caller that kept a toast id needs to know whether it is still
   * alive (the ✕ button or the auto-dismiss timer may already have removed it)
   * before deciding to update it instead of creating a new one. */
  const ids = useRef(new Set());
  /* Central dedupe registry: dedupeKey -> timestamp of the last SHOWN toast
     with that key. Survives re-mounts (module-level ToastProvider state) so a
     remount + immediate re-fire still collapses. */
  const dedupeSeen = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    ids.current.delete(id);
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const hasToast = useCallback((id) => id != null && ids.current.has(id), []);

  const showToast = useCallback(
    (message, { tone = 'info', title = '', duration = 5000, action = null, actions = null, dedupeKey = null, dedupeWindowMs = DEDUPE_WINDOW_MS, source = null, placement = 'default', onClick = null } = {}) => {
      const at = Date.now();
      /* Central dedupe: the same logical notification (same dedupeKey, e.g.
         type + gameId + userId) shown twice within a few seconds collapses to
         one card. Callers that have no stable identity pass nothing and behave
         exactly as before. Returns the new toast's id, or null when suppressed
         (so callers can distinguish "shown" from "dropped as duplicate"). */
      const { suppressed } = checkToastDedupe(dedupeSeen.current, dedupeKey, at, dedupeWindowMs);
      if (suppressed) {
        toastDebugLog('SUPPRESSED-DUPLICATE', { id: null, tone, title, message, source, dedupeKey, at });
        return null;
      }
      const id = nextId++;
      ids.current.add(id);
      setToasts((prev) => [...prev, { id, title, message, tone, action, actions, placement, onClick }]);
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
      toastDebugLog('SHOW', { id, tone, title, message, source, dedupeKey, at });
      return id;
    },
    [dismiss]
  );

  /* Rewrite a toast that is already on screen instead of stacking a new one.
   * Used where the same thing can fire repeatedly in a burst (a chatty
   * conversation), so the user gets ONE card whose text updates. Restarts the
   * auto-dismiss timer so a busy thread doesn't cut the message off early. */
  const updateToast = useCallback(
    (id, { message, title, tone, duration = 5000 } = {}) => {
      if (id == null || !ids.current.has(id)) return;
      setToasts((prev) => prev.map((t) => (
        t.id === id
          ? { ...t, message: message ?? t.message, title: title ?? t.title, tone: tone ?? t.tone }
          : t
      )));
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast, updateToast, hasToast, dismissToast: dismiss }}>
      {children}
      {/* Notification popups: on phones they dock just under the header so they
          never cover the bottom nav or a game's controls; from `sm` up they
          join the bottom-right stack below. */}
      <div className="fixed inset-x-0 top-[4.25rem] z-[var(--z-modal-backdrop)] flex flex-col gap-2 items-center px-3 pointer-events-none sm:hidden">
        {toasts.filter((t) => t.placement === 'notification').map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
      {/* Toast stack — fixed bottom-right, above everything */}
      <div className="fixed bottom-4 right-4 z-[var(--z-modal-backdrop)] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.filter((t) => t.placement !== 'notification').map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
        <div className="hidden sm:flex sm:flex-col sm:gap-2 sm:items-end">
          {toasts.filter((t) => t.placement === 'notification').map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);