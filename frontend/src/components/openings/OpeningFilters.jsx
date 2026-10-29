import { STYLES, DIFFICULTIES, POPULARITY_TIERS, listFamilies } from '../../lib/openings';

/* Chip-style toggle for the facets that are genuinely multi-select (Style):
   a dropdown cannot express "several styles at once". */
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

/** One labelled dropdown. `value` and `onChange` go straight at the same facet
    the chip toggles used to drive, so filtering itself is untouched. */
function Select({ label, value, onChange, ariaLabel, children }) {
  return (
    <label className="op-select">
      <span>{label}</span>
      <select
        className="chess-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      >
        {children}
      </select>
    </label>
  );
}

/* Every facet back to its opening value. Same object the library page uses as
   its default, and applied through the existing onChange. */
const RESET = {
  search: '',
  side: '',
  styles: [],
  difficulty: '',
  popularity: 'all',
  family: '',
  sort: 'popularity',
};

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
      <div className="op-toolbar">
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

        <Select label="Plays as" value={side} onChange={(v) => set({ side: v })} ariaLabel="Filter by colour">
          <option value="">Both</option>
          <option value="white">♔ White</option>
          <option value="black">♚ Black</option>
        </Select>

        <Select label="Level" value={difficulty} onChange={(v) => set({ difficulty: v })} ariaLabel="Filter by difficulty">
          <option value="">Any</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>

        <Select label="Popularity" value={popularity} onChange={(v) => set({ popularity: v })} ariaLabel="Filter by popularity">
          {POPULARITY_TIERS.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </Select>

        <Select label="Family" value={family} onChange={(v) => set({ family: v })} ariaLabel="Filter by family">
          <option value="">All</option>
          {listFamilies().map((f) => (
            <option key={f.family} value={f.family} title={`${f.count} opening${f.count === 1 ? '' : 's'}`}>
              {f.family} ({f.count})
            </option>
          ))}
        </Select>

        <Select label="Sort" value={sort} onChange={(v) => set({ sort: v })} ariaLabel="Sort openings">
          <option value="popularity">Most popular</option>
          <option value="name">Name (A–Z)</option>
          <option value="difficulty">Difficulty</option>
          <option value="eco">ECO code</option>
        </Select>

        <button type="button" className="op-clear" onClick={() => set(RESET)}>
          Clear
        </button>
      </div>

      {/* Multi-select, so it stays a row of toggles rather than a dropdown. */}
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

      <p className="op-filters-count" aria-live="polite">
        Showing <strong>{resultCount}</strong> of {totalCount} openings
      </p>
    </div>
  );
}
