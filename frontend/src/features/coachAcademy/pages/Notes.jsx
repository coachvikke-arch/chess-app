/**
 * AI Coach Training Academy — notes.
 *
 * Every note the coach has written, grouped by level and searchable. Notes are
 * the one artifact that outlives the session, so they get their own page rather
 * than being trapped inside a lesson.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Card, Chip } from '../../../components/ui';
import useAcademyProgress from '../hooks/useAcademyProgress';
import { allNotes } from '../services/academyStore';
import { formatRelative } from '../utils/format';
import { Empty } from '../components/AcademyUI';

export default function CoachAcademyNotes() {
  const p = useAcademyProgress();
  const [query, setQuery] = useState('');

  const notes = useMemo(() => allNotes(p.user), [p.user, p.state]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.name.toLowerCase().includes(q) || String(n.notes).toLowerCase().includes(q),
    );
  }, [notes, query]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const n of filtered) {
      const key = n.level ?? 0;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(n);
    }
    return [...map.entries()].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  }, [filtered]);

  return (
    <Page title="Coach notes" piece="✎" sub="Everything you have written down, by level.">
      <div className="mb-5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          className="w-full rounded-xl bg-black/[0.06] border border-ivory-700/50 px-4 py-2.5 text-sm text-ivory-100 placeholder:text-ivory-700 focus:outline-none focus:border-gold-500/70"
        />
      </div>

      {filtered.length === 0 ? (
        <Card title="Notes" piece="✎">
          <Empty hint="Open any topic and use the Coach notes box.">
            {query ? 'No notes match that search.' : 'No notes yet.'}
          </Empty>
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(([levelN, list]) => (
            <Card key={levelN} title={levelN ? `Level ${levelN}` : 'Unassigned'} piece="♟">
              <ul className="space-y-3">
                {list.map((n) => (
                  <li key={n.topicId} className="rounded-xl border border-ivory-700/40 bg-black/[0.03] p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Link
                        to={`/coach/ai-coach-training/topic/${n.topicId}`}
                        className="text-sm font-semibold text-ivory-100 hover:text-gold-600 transition flex-1"
                      >
                        {n.name}
                      </Link>
                      <span className="text-xs text-ivory-700">
                        {formatRelative(p.state.topics?.[n.topicId]?.lastSeen)}
                      </span>
                    </div>
                    <p className="text-sm text-ivory-300 whitespace-pre-wrap">{n.notes}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-ivory-700">
        {notes.length} note{notes.length === 1 ? '' : 's'} · stored on this device only
        {p.user ? ` for ${p.user.name ?? p.user.email ?? 'your account'}` : ''}
        <Chip>local</Chip>
      </p>
    </Page>
  );
}