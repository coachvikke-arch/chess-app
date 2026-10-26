/**
 * Tactics — the index screen: all 45 tactics, grouped into the four categories,
 * with search, an overall progress bar, and a studied tick per tactic.
 *
 * Navigation follows the app's existing idiom (see the coach Academy dashboard):
 * a `Page` shell, `chess-card` sections, and links for the detail view. Nothing
 * here is specific to any one role, so the same component serves the standalone
 * `/tactics` route and the student and admin shells.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../../components/ui';
import useTacticsProgress from '../hooks/useTacticsProgress';
import { searchTactics, tacticsByCategory } from '../data';

export default function TacticsList() {
  const [query, setQuery] = useState('');
  const { total, solved, viewed, percent, isSolved, isViewed } = useTacticsProgress();

  const groups = useMemo(() => tacticsByCategory(), []);
  const searching = query.trim().length > 0;

  /* In search mode the grouping goes away: a reader looking for "fork" does not
     want to hunt for it inside a category heading. */
  const results = useMemo(() => (searching ? searchTactics(query) : null), [query, searching]);

  const row = (tactic) => {
    /* Explanation mode has no solve step, so "studied" is the completion state:
       it is set once the card's annotated board has been shown. */
    const done = isSolved(tactic.slug);
    const seen = isViewed(tactic.slug);
    return (
      <li key={tactic.slug}>
        <Link to={`${baseFor()}/${tactic.slug}`} className={`tactic-row${done ? ' is-solved' : ''}`}>
          <span className="tactic-row-num" aria-hidden="true">
            {String(tactic.id).padStart(2, '0')}
          </span>
          <span className="tactic-row-name">The {tactic.title}</span>
          {!searching && <span className="tactic-row-cat">{tactic.category}</span>}
          <span className="tactic-row-tick" aria-label={done ? 'Studied' : seen ? 'Opened' : 'Not opened'}>
            {done ? '✓' : seen ? '•' : ''}
          </span>
        </Link>
      </li>
    );
  };

  /* The detail links must stay inside whichever shell mounted this screen. The
     pathname is the honest signal — it is already correct for /tactics,
     /student/tactics and /admin/tactics, and needs no prop threading. */
  const baseFor = () => (typeof window !== 'undefined' ? window.location.pathname.replace(/\/$/, '') : '/tactics');

  return (
    <Page
      title="Chess Tactics"
      piece="♗"
      sub="All 45 essential patterns, one short position each. Open a tactic and read the arrows to see the idea and why it wins."
      wide
    >
      <div className="chess-card mb-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-semibold text-ivory-100">Your progress</p>
          <p className="text-sm font-bold text-ivory-100 tabular-nums">
            {solved} / {total} completed
          </p>
        </div>
        <div
          className="h-2.5 rounded-full overflow-hidden"
          style={{ background: 'rgba(15,19,13,0.12)' }}
          role="progressbar"
          aria-valuenow={solved}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Tactics studied"
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${percent}%`, background: '#22c55e' }}
          />
        </div>
        <p className="text-xs text-ivory-500 mt-2">
          {viewed} opened · {solved} studied. Progress is saved on this device.
        </p>
      </div>

      <div className="chess-card mb-4">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-ivory-500 font-semibold mb-1.5 block">
            Search tactics
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="fork, mate, knight…"
            className="chess-input"
          />
        </label>
      </div>

      {results ? (
        <section className="chess-card">
          <h2 className="chess-card-title mb-3">{results.length} match{results.length === 1 ? '' : 'es'}</h2>
          {results.length === 0 ? (
            <p className="text-sm text-ivory-500">No tactic matches “{query}”.</p>
          ) : (
            <ul className="tactic-rows">{results.map(row)}</ul>
          )}
        </section>
      ) : (
        groups.map((group) => (
          <section key={group.name} className="chess-card mb-4">
            <h2 className="chess-card-title mb-3">{group.name}</h2>
            <ul className="tactic-rows">{group.items.map(row)}</ul>
          </section>
        ))
      )}
    </Page>
  );
}