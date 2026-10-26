/* Openings library — the Super Admin view of the opening course catalogue.
 *
 * This is deliberately NOT the student Academy browser. That component renders
 * /academy/overview, which is built around the requesting user's XP, streak and
 * per-level unlock state — meaningless for an admin, and the reason a super admin
 * saw an empty-looking academy.
 *
 * Instead this reads a dedicated read-only inventory (GET /admins/openings/
 * library) that lists every course including drafts and unpublished ones, with
 * no progress join. Search and filters are client-side: the payload is a few
 * dozen small course records, so a round-trip per keystroke would be wasteful. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { Card, Chip, Spinner, Stat } from './ui';
import Button from './Button';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'official', label: 'Official' },
  { key: 'community', label: 'Community' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'reported', label: 'Reported' },
];

const DIFFICULTY_TONE = { Easy: 'green', Medium: 'amber', Hard: 'red' };

function matchesFilter(c, key) {
  switch (key) {
    case 'official': return c.isOfficial;
    case 'community': return !c.isOfficial;
    case 'drafts': return !c.published;
    case 'reported': return c.reports > 0;
    default: return true;
  }
}

function CourseCard({ c }) {
  return (
    <li className="rounded-2xl border border-ivory-700/40 bg-white p-3.5 shadow-sm flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-ivory-100 truncate">{c.title}</p>
          <p className="text-[0.6rem] text-ivory-500 mt-0.5 truncate">
            {c.ecoCode ? `${c.ecoCode} · ` : ''}
            <span className="capitalize">{c.side}</span>
            {c.authorName ? ` · ${c.authorName}` : ''}
          </p>
        </div>
        <Chip tone={DIFFICULTY_TONE[c.difficulty] || ''}>{c.difficulty}</Chip>
      </div>

      {c.description ? (
        <p className="text-xs text-ivory-500 leading-relaxed line-clamp-2">{c.description}</p>
      ) : null}

      {c.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {c.tags.map((t) => <Chip key={t}>{t}</Chip>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
        {c.isOfficial ? <Chip tone="gold">Official</Chip> : <Chip>Community</Chip>}
        {c.published
          ? <Chip tone="green">Published</Chip>
          : <Chip tone="amber">Unpublished</Chip>}
        {c.reports > 0 && <Chip tone="red">⚠ {c.reports} report{c.reports > 1 ? 's' : ''}</Chip>}
      </div>

      <p className="text-[0.6rem] text-ivory-500 border-t border-ivory-700/30 pt-1.5">
        {c.totalLines} line{c.totalLines === 1 ? '' : 's'} · {c.coverage} moves · ♡ {c.likes}
      </p>
    </li>
  );
}

export default function OpeningsLibraryPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(() => {
    setError(null);
    api.get('/admins/openings/library', { cache: false })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load the openings library'));
  }, []);

  useEffect(load, [load]);

  const all = data?.courses || [];

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((c) => {
      if (!matchesFilter(c, filter)) return false;
      if (!term) return true;
      return (
        c.title.toLowerCase().includes(term) ||
        (c.ecoCode || '').toLowerCase().includes(term) ||
        (c.authorName || '').toLowerCase().includes(term) ||
        c.tags.some((t) => t.toLowerCase().includes(term))
      );
    });
  }, [all, q, filter]);

  if (error) {
    return (
      <Card title="Something went wrong" piece="⚠">
        <p className="text-ivory-500 text-sm">{error}</p>
        <Button type="button" onClick={load} variant="primary" size="md" className="mt-3">Try again</Button>
      </Card>
    );
  }
  if (!data) return <Spinner text="Loading the openings library…" />;

  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Courses" value={s.total} icon="♘" />
        <Stat label="Official" value={s.official} icon="★" />
        <Stat label="Drafts" value={s.drafts} icon="✎" />
        <Stat label="Total lines" value={s.lines} icon="≡" />
      </div>

      <Card
        title="Openings library"
        piece="♘"
        actions={
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, ECO, author, tag…"
            className="w-40 sm:w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-ivory-100 outline-none focus:border-gold-500/60"
          />
        }
      >
        <p className="text-xs text-ivory-500 mb-3">
          Every opening course in the library, including drafts and unpublished entries.
          {s.reported > 0 && (
            <span className="text-red-500"> {s.reported} awaiting review.</span>
          )}
        </p>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {FILTERS.map((f) => {
            const n = all.filter((c) => matchesFilter(c, f.key)).length;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`text-[0.65rem] px-2.5 py-1 rounded-full border transition ${filter === f.key
                    ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
                    : 'border-ivory-700/40 text-ivory-500 hover:border-gold-500/30'
                  }`}
              >
                {f.label} ({n})
              </button>
            );
          })}
        </div>

        {visible.length === 0 ? (
          <p className="text-xs text-ivory-500 text-center py-10">No courses match this view.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map((c) => <CourseCard key={c.id} c={c} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}