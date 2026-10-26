/* Family achievement shelf — one badge per opening family.
 *
 * Badges are derived entirely from stored progress (see openingsProgress), so
 * this component is pure presentation: it renders whatever `badges` says.
 */
export default function BadgeShelf({ badges = [], onSelect }) {
  if (!badges.length) return null;

  return (
    <section className="op-badges">
      <h2 className="op-badges-title">
        <span className="chess-card-piece">♛</span> Family badges
      </h2>

      <div className="op-badges-grid">
        {badges.map((b) => {
          const complete = b.total > 0 && b.learned >= b.total;
          const pct = b.total > 0 ? Math.round((b.learned / b.total) * 100) : 0;
          const Tag = onSelect ? 'button' : 'div';

          return (
            <Tag
              key={b.id}
              type={onSelect ? 'button' : undefined}
              onClick={onSelect ? () => onSelect(b.family) : undefined}
              className={`op-badge ${complete ? 'op-badge--earned' : ''} ${onSelect ? 'op-badge--clickable' : ''}`}
              title={
                complete
                  ? `${b.name} — earned!`
                  : `${b.name} — learn all ${b.total} ${b.family} openings (${b.learned}/${b.total} done)`
              }
            >
              <span className="op-badge-icon" aria-hidden="true">{b.icon}</span>
              <span className="op-badge-body">
                <span className="op-badge-name">{b.name}</span>
                <span className="op-badge-meta">
                  {b.learned}/{b.total} learned
                </span>
                <span className="op-badge-track" aria-hidden="true">
                  <span className="op-badge-fill" style={{ width: `${pct}%` }} />
                </span>
              </span>
              {complete && <span className="op-badge-tick" aria-hidden="true">✓</span>}
            </Tag>
          );
        })}
      </div>
    </section>
  );
}
