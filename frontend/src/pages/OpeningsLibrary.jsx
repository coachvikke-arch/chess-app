import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/ui';
import OpeningCard from '../components/openings/OpeningCard';
import OpeningFilters from '../components/openings/OpeningFilters';
import BadgeShelf from '../components/openings/BadgeShelf';
import { OPENINGS, GAMBITS, filterOpenings, fenAfterPly, listFamilies } from '../lib/openings';
import { getAllProgress, getStats, getAccuracy, badgeShelf, STATUS } from '../lib/openingsProgress';
import { useAuth } from '../context/AuthContext';

/* Default facets.
   NB: `side`, `difficulty` and `family` use '' (not 'all') for "any" — that is
   the sentinel `filterOpenings()` and OpeningFilters both use. Passing 'all'
   would be a truthy value that matches no opening and silently empty the grid. */
const DEFAULT_FILTERS = {
  search: '',
  side: '',
  styles: [],
  difficulty: '',
  popularity: 'all',   // this one IS 'all' — a POPULARITY_TIERS key
  family: '',
  sort: 'popularity',
};

/**
 * Openings Library — the grid of every opening in the curated library.
 *
 * Progress is per-user and namespaced by user id, so a signed-out visitor simply
 * sees an untouched library rather than someone else's state.
 */
export default function OpeningsLibrary() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const userId = user?.id ?? null;

  /* Deep link: the detail view links to /openings?family=… so "browse the
     family" lands on a pre-filtered grid. */
  const familyParam = params.get('family') || '';

  /* Facet state. `family` is mirrored into the URL (the detail view links to
     /openings?family=… so "browse the family" lands pre-filtered); everything
     else is session-only so typing in the search box never rewrites the URL. */
  const [local, setLocal] = useState(() => ({ ...DEFAULT_FILTERS }));
  const effective = useMemo(
    () => ({ ...local, family: familyParam || '' }),
    [local, familyParam]
  );
  /* `family` is mirrored into the URL (the detail view links to
     /openings?family=… so "browse the family" lands pre-filtered); everything
     else is session-only so typing in the search box never rewrites the URL.
     The URL is written OUTSIDE the setState updater — calling setParams from
     inside one updates the router while this component is still rendering. */
  const update = useCallback(
    (patch) => {
      const next = { ...local, ...patch };
      setLocal(next);
      // '' is the "any" sentinel; only a real family name goes in the URL.
      const f = next.family || null;
      if (f) setParams({ family: f }, { replace: true });
      else setParams({}, { replace: true });
    },
    [local, setParams]
  );

  const results = useMemo(() => filterOpenings(effective), [effective]);

  /* Card preview shows a position a few plies in, so the opening's ideas are
     visible on the board instead of the empty start position. */
  const fenFor = (opening) => fenAfterPly(opening, 4);

  const progress = useMemo(() => getAllProgress(userId), [userId]);
  const stats = useMemo(() => getStats(userId), [userId]);
  const accuracy = useMemo(() => getAccuracy(userId), [userId]);
  const badges = useMemo(() => badgeShelf(OPENINGS, userId), [userId]);

  /* getStats() reports practice counters (sessions / correct / total), NOT how
     many openings are learned — those two come from the per-opening entries. */
  const learnedCount = useMemo(
    () => Object.values(progress).filter((p) => p.status === STATUS.LEARNED).length,
    [progress]
  );
  const inProgressCount = useMemo(
    () => Object.values(progress).filter((p) => p.status === STATUS.IN_PROGRESS).length,
    [progress]
  );

  return (
    <Page title="Openings Library" piece="♞" sub="Study every line move by move, then play it against the engine." wide>
      {/* Headline stats */}
      <div className="op-stats">
        {[
          { label: 'Openings', value: OPENINGS.length, hint: `${listFamilies().length} families · ${GAMBITS.length} gambits` },
          { label: 'Learned', value: learnedCount, hint: `${OPENINGS.length - learnedCount} to go` },
          { label: 'In progress', value: inProgressCount, hint: `${stats.sessions || 0} sessions played` },
          { label: 'Accuracy', value: `${accuracy}%`, hint: `${stats.correct || 0}/${stats.total || 0} on book` },
          { label: 'Streak', value: stats.currentStreak || 0, hint: `best run ${stats.bestStreak || 0}` },
        ].map((s) => (
          <div key={s.label} className="op-stat">
            <span className="op-stat-label">{s.label}</span>
            <span className="op-stat-value">{s.value}</span>
            <span className="op-stat-hint">{s.hint}</span>
          </div>
        ))}
      </div>

      <BadgeShelf badges={badges} onSelect={(family) => update({ family })} />

      <OpeningFilters
        filters={effective}
        onChange={update}
        resultCount={results.length}
        totalCount={OPENINGS.length}
      />

      {results.length === 0 ? (
        <div className="chess-card text-center py-14">
          <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">♞</span>
          <p className="chess-empty">No openings match those filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((opening, i) => (
            <OpeningCard
              key={opening.slug}
              opening={opening}
              progress={progress[opening.slug]}
              fen={fenFor(opening)}
              index={i}
              userId={userId}
            />
          ))}
        </div>
      )}

      {results.length === 0 && (
        <p className="text-center mt-4">
          <button
            type="button"
            className="chess-link"
            onClick={() => update({ ...DEFAULT_FILTERS })}
          >
            Clear all filters
          </button>
        </p>
      )}

      {OPENINGS.length > 0 && results.length > 0 && (
        <p className="text-center mt-6 text-sm text-ivory-500">
          New here?{' '}
          <button
            type="button"
            className="chess-link"
            onClick={() => navigate('/openings/italian-game-giuoco-piano')}
          >
            Start with the Italian Game
          </button>
        </p>
      )}
    </Page>
  );
}
