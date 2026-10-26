
import Button from './Button';
import usePageTitle from '../hooks/usePageTitle';

export function Piece({ p = '♞', className = '', spin, soft }) {
  const cls = [
    'piece-glyph',
    spin ? 'piece-glyph-spin' : '',
    soft ? 'piece-glyph-soft' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} aria-hidden="true">
      {p}
    </span>
  );
}

/**
 * Scroll-reveal wrapper. Add `style={{ '--d': '0.2s' }}` via delay prop for stagger.
 */
export function Reveal({ children, delay = 0, className = '' }) {
  return (
    <div className={`chess-reveal ${className}`} style={{ '--d': `${delay}s` }}>
      {children}
    </div>
  );
}

export function Page({ title, piece = '♞', sub, children, wide, className = '' }) {
  usePageTitle(title);
  return (
    <div className={`chess-page ${wide ? 'chess-page-wide' : ''}${className ? ` ${className}` : ''}`}>
      {(title || sub) && (
        <header className="chess-page-head">
          <h1 className="chess-page-title">
            <span className="piece-title-icon">{piece}</span>
            {title && <span className="chess-gradient-text">{title}</span>}
          </h1>
          {sub && <p className="chess-page-sub">{sub}</p>}
        </header>
      )}
      {children}
    </div>
  );
}

export function Card({ title, piece = '♞', children, className = '', hover, actions }) {
  return (
    <Reveal className={className}>
      <div className={`chess-card ${hover ? 'chess-card-hover' : ''}`}>
        {title && (
          <h2 className="chess-card-title">
            <span className="chess-card-piece">{piece}</span>
            <span className="flex-1">{title}</span>
            {actions}
          </h2>
        )}
        {children}
      </div>
    </Reveal>
  );
}

export function Stat({ label, value, icon = '♙', small }) {
  return (
    <Reveal>
      <div className="chess-stat">
        <span className="chess-stat-icon">{icon}</span>
        <p className="chess-stat-label">{label}</p>
        <p className={`chess-stat-value ${small ? 'text-lg' : ''}`}>{value}</p>
      </div>
    </Reveal>
  );
}

export function Bar({ pct }) {
  return (
    <div className="chess-bar">
      <div className="chess-bar-fill" style={{ width: `${Number(pct) || 0}%` }} />
    </div>
  );
}

export function Chip({ children, tone = '' }) {
  const toneClass = tone ? `chess-chip-${tone}` : '';
  return <span className={`chess-chip ${toneClass}`}>{children}</span>;
}

export function Spinner({ text = 'Preparing the board…' }) {
  return (
    <div className="p-12 text-center">
      <div className="chess-spinner">
        <span>♞</span>
      </div>
      <p className="mt-4 text-ivory-500 text-sm animate-pulse">{text}</p>
    </div>
  );
}

/**
 * Suspense fallback for lazy route chunks. Deliberately NOT a white or
 * full-screen spinner: it sits inside the persistent shell's content area,
 * on the app's own background, so a chunk load never paints a white frame.
 */
export function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-label="Loading section">
      <div className="chess-spinner">
        <span>♞</span>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', variant = 'danger' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--z-modal-backdrop)] overflow-y-auto bg-black/60 grid place-items-center p-4" onClick={onCancel}>
      <div
        className="chess-card max-w-md w-full flex flex-col max-h-[94vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'board-pop .3s both' }}
      >
        <h2 className="font-display text-xl font-semibold text-ivory-100 mb-4">{title}</h2>
        <p className="text-sm text-ivory-300 mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button
            onClick={onCancel}
            variant="secondary" size="md" className="!px-4 !py-2 text-sm"
          >
            {cancelText}
          </Button>
          <Button
            onClick={onConfirm}
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="md" className="!px-4 !py-2 text-sm"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Re-export PageHeader from HeaderContext for convenient imports
export { PageHeader } from '../context/HeaderContext';