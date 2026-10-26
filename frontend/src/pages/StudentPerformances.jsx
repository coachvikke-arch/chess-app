import { useEffect, useState } from 'react';
import api from '../services/api';
import { Page, Spinner } from '../components/ui';
import Button from '../components/Button';

/* Student gallery: every Top Performance the student may see. The server
   decides visibility (Super Admin posts reach everyone, a coach's posts reach
   only their allocated students), so this page renders whatever comes back —
   no id, no role logic, nothing to get wrong on the client. */
export function PerformanceCard({ item, onOpen }) {
  return (
    <article
      className="chess-card overflow-hidden !p-0 cursor-pointer transition hover:border-gold-500/50"
      onClick={onOpen ? () => onOpen(item) : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item); } } : undefined}
      tabIndex={onOpen ? 0 : undefined}
      role={onOpen ? 'button' : undefined}
      aria-label={onOpen ? `Open ${item.title} full size` : undefined}
    >
      {item.image_url ? (
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          className="w-full h-44 sm:h-48 object-cover"
        />
      ) : (
        <div className="w-full h-44 sm:h-48 grid place-items-center bg-black/[0.04] text-4xl" aria-hidden="true">
          🏆
        </div>
      )}
      <div className="p-4">
        <h3 className="font-display font-bold text-ivory-100 leading-snug">{item.title}</h3>
        {item.details && (
          <p className="mt-1.5 text-sm text-ivory-500 leading-relaxed whitespace-pre-line">{item.details}</p>
        )}
        <p className="mt-3 text-xs text-ivory-500">
          {item.creator_name || 'Academy'}
          {item.created_at && (
            <> · {new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</>
          )}
        </p>
      </div>
    </article>
  );
}

export default function StudentPerformances() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [openItem, setOpenItem] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .get('/performances', { cache: false })
      .then((res) => alive && setItems(res.data || []))
      .catch((err) => alive && setError(err.response?.data?.message || 'Could not load performances.'));
    return () => { alive = false; };
  }, []);

  /* Escape closes the full-size view. */
  useEffect(() => {
    if (!openItem) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpenItem(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openItem]);

  return (
    <Page title="Top Performances" piece="🏆" sub="Celebrating our students' wins">
      {error ? (
        <div className="chess-card p-8 text-center">
          <p className="text-4xl mb-3">😕</p>
          <p className="font-semibold text-ivory-100">Couldn’t load performances</p>
          <p className="text-sm text-ivory-500 mt-1">{error}</p>
        </div>
      ) : items === null ? (
        <Spinner text="Loading performances…" />
      ) : items.length === 0 ? (
        <div className="chess-card p-8 text-center">
          <p className="text-4xl mb-3">🏆</p>
          <p className="font-semibold text-ivory-100">No performances yet</p>
          <p className="text-sm text-ivory-500 mt-1">
            Tournament wins and prizes celebrated by your coach will appear here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <PerformanceCard key={item.id} item={item} onOpen={setOpenItem} />
          ))}
        </div>
      )}

      {/* Full-size popup: uploaded photo large, title bold, details readable. */}
      {openItem && (
        <div
          className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center p-3 sm:p-6"
          style={{ background: 'rgba(28, 33, 23, 0.7)' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpenItem(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={openItem.title}
            className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-ivory-700/60 bg-ink-800 shadow-2xl"
          >
            {openItem.image_url ? (
              <img src={openItem.image_url} alt="" className="w-full max-h-[62vh] object-contain bg-black/40" />
            ) : (
              <div className="w-full py-10 grid place-items-center text-5xl bg-black/[0.04]" aria-hidden="true">🏆</div>
            )}
            <div className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-xl sm:text-2xl font-extrabold text-ivory-100 leading-snug">
                  {openItem.title}
                </h2>
                <Button
                  type="button"
                  onClick={() => setOpenItem(null)}
                  title="Close"
                  aria-label="Close full view"
                  variant="secondary" size="md" className="!h-9 !w-9 !p-0 grid place-items-center text-lg font-semibold shrink-0"
                  style={{ color: 'var(--ivory-300)' }}
                >
                  ✕
                </Button>
              </div>
              {openItem.details && (
                <p className="mt-2 text-base font-semibold text-ivory-100 leading-relaxed whitespace-pre-line">
                  {openItem.details}
                </p>
              )}
              <p className="mt-3 text-xs text-ivory-500">
                {openItem.creator_name || 'Academy'}
                {openItem.created_at && (
                  <> · {new Date(openItem.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
