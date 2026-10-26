import { STYLES, DIFFICULTIES, POPULARITY_TIERS, listFamilies } from '../../lib/openings';

/* Chip-style toggle used by every facet group. */
function Toggle({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`op-toggle ${active ? 'op-toggle--on' : ''}`}
    >
      {children}
    </button>
  );
}

/**
 * Library filter bar: free-text search plus colour / style / difficulty /
 * popularity / family facets and a sort selector.
 *
 * Fully controlled — the parent owns the filter state so it can be reflected in
 * the URL later without lifting anything else.
 */
export default function OpeningFilters({ filters, onChange, resultCount, totalCount }) {
  const { search, side, styles, difficulty, popularity, family, sort } = filters;

  const set = (patch) => onChange({ ...filters, ...patch });

  const toggleStyle = (s) => {
    const next = styles.includes(s) ? styles.filter((x) => x !== s) : [...styles, s];
    set({ styles: next });
  };

  return (
    <div className="op-filters">
      <div className="op-search">
        <span className="op-search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          className="chess-input op-search-input"
          placeholder="Search openings, ECO codes or moves…"
          value={search}
          onChange={(e) => set({ search: e.target.value })}
          aria-label="Search openings"
        />
        {search && (
          <button
            type="button"
            className="op-search-clear"
            onClick={() => set({ search: '' })}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      <div className="op-facet-row">
        <span className="op-facet-label">Plays as</span>
        <div className="op-facet-group" role="group" aria-label="Filter by colour">
          <Toggle active={!side} onClick={() => set({ side: '' })}>Both</Toggle>
          <Toggle active={side === 'white'} onClick={() => set({ side: side === 'white' ? '' : 'white' })}>
            ♔ White
          </Toggle>
          <Toggle active={side === 'black'} onClick={() => set({ side: side === 'black' ? '' : 'black' })}>
            ♚ Black
          </Toggle>
        </div>
      </div>

      <div className="op-facet-row">
        <span className="op-facet-label">Style</span>
        <div className="op-facet-group" role="group" aria-label="Filter by style">
          {STYLES.map((s) => (
            <Toggle key={s} active={styles.includes(s)} onClick={() => toggleStyle(s)}>
              {s}
            </Toggle>
          ))}
        </div>
      </div>

      <div className="op-facet-row">
        <span className="op-facet-label">Level</span>
        <div className="op-facet-group" role="group" aria-label="Filter by difficulty">
          <Toggle active={!difficulty} onClick={() => set({ difficulty: '' })}>Any</Toggle>
          {DIFFICULTIES.map((d) => (
            <Toggle
              key={d}
              active={difficulty === d}
              onClick={() => set({ difficulty: difficulty === d ? '' : d })}
            >
              {d}
            </Toggle>
          ))}
        </div>
      </div>

      <div className="op-facet-row">
        <span className="op-facet-label">Popularity</span>
        <div className="op-facet-group" role="group" aria-label="Filter by popularity">
          {POPULARITY_TIERS.map((t) => (
            <Toggle
              key={t.key}
              active={popularity === t.key}
              onClick={() => set({ popularity: t.key })}
            >
              {t.label}
            </Toggle>
          ))}
        </div>
      </div>

      <div className="op-facet-row">
        <span className="op-facet-label">Family</span>
        <div className="op-facet-group" role="group" aria-label="Filter by family">
          <Toggle active={!family} onClick={() => set({ family: '' })}>All</Toggle>
          {listFamilies().map((f) => (
            <Toggle
              key={f.family}
              active={family === f.family}
              onClick={() => set({ family: family === f.family ? '' : f.family })}
              title={`${f.count} opening${f.count === 1 ? '' : 's'}`}
            >
              {f.family}
              <span className="op-facet-count">{f.count}</span>
            </Toggle>
          ))}
        </div>
      </div>

      <div className="op-filters-foot">
        <label className="op-sort">
          <span>Sort by</span>
          <select
            className="chess-input"
            value={sort}
            onChange={(e) => set({ sort: e.target.value })}
            aria-label="Sort openings"
          >
            <option value="popularity">Most popular</option>
            <option value="name">Name (A–Z)</option>
            <option value="difficulty">Difficulty</option>
            <option value="eco">ECO code</option>
          </select>
        </label>

        <p className="op-filters-count" aria-live="polite">
          Showing <strong>{resultCount}</strong> of {totalCount} openings
        </p>
      </div>
    </div>
  );
}
