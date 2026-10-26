/**
 * Tactics — the detail screen for one tactic.
 *
 * Three ways to move between tactics, because a phone reader needs all three and
 * a desktop reader needs at least the buttons:
 *   - Prev / Next buttons at the bottom, always visible;
 *   - horizontal swipe on the card, which is the gesture a phone user expects;
 *   - the scrollable tab strip at the top, which doubles as "where am I".
 *
 * `useArrowKeys` is bound too, so ← / → work like everywhere else in the app.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../../components/ui';
import useArrowKeys from '../../../hooks/useArrowKeys';
import TacticCard from '../components/TacticCard';
import useTacticsProgress from '../hooks/useTacticsProgress';
import { TACTICS, findTactic, neighbours } from '../data';

/* A horizontal swipe must not fire while the user is scrolling the strip. */
const SWIPE_PX = 48;

export default function TacticDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const tactic = findTactic(slug);
  const touchStart = useRef(null);
  const stripRef = useRef(null);
  const { isSolved, markViewed, markSolved } = useTacticsProgress();
  const handleExplained = useCallback((shown) => markSolved(shown.slug), [markSolved]);

  /* The base path is whichever shell mounted us, so the tab strip and the Prev /
     Next links never jump between /tactics, /student/tactics and /admin/tactics. */
  const base = typeof window !== 'undefined'
    ? window.location.pathname.replace(/\/[^/]*$/, '') || '/tactics'
    : '/tactics';

  /* Opening a card counts as viewing it, which is a separate fact from solving
     it — the list screen draws those two differently. */
  useEffect(() => { if (tactic) markViewed(tactic.slug); }, [tactic?.slug, markViewed]);

  const { prev, next } = neighbours(tactic);

  useArrowKeys(
    () => { if (prev) navigate(`${base}/${prev.slug}`); },
    () => { if (next) navigate(`${base}/${next.slug}`); },
    { enabled: Boolean(tactic) },
  );

  /* Keep the current tab in view when arriving by Prev/Next rather than a tap. */
  useEffect(() => {
    const el = stripRef.current?.querySelector('[data-current="true"]');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [slug]);

  if (!tactic) {
    return (
      <Page title="Chess Tactics" piece="♗">
        <p className="text-sm text-ivory-500">
          That tactic does not exist.{' '}
          <Link to={base} className="chess-link">Back to all tactics</Link>
        </p>
      </Page>
    );
  }

  return (
    <Page
      title={`Tactic ${String(tactic.id).padStart(2, '0')} — ${tactic.title}`}
      piece="♗"
      sub={tactic.category}
    >
      <nav className="tactic-strip" ref={stripRef} aria-label="All tactics">
        {TACTICS.map((t) => (
          <Link
            key={t.slug}
            to={`${base}/${t.slug}`}
            data-current={t.slug === tactic.slug ? 'true' : undefined}
            className={`tactic-tab${t.slug === tactic.slug ? ' is-current' : ''}${isSolved(t.slug) ? ' is-solved' : ''}`}
            title={`The ${t.title}`}
          >
            {String(t.id).padStart(2, '0')}
          </Link>
        ))}
      </nav>

      <div
        onTouchStart={(e) => { touchStart.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (start == null) return;
          const dx = (e.changedTouches[0]?.clientX ?? start) - start;
          if (Math.abs(dx) < SWIPE_PX) return;
          const target = dx < 0 ? next : prev;
          if (target) navigate(`${base}/${target.slug}`);
        }}
      >
        <TacticCard
          tactic={tactic}
          solved={isSolved(tactic.slug)}
          onExplained={handleExplained}
        />
      </div>

      <div className="tactic-pager">
        {prev ? (
          <Link to={`${base}/${prev.slug}`} className="tactic-page-btn">← {prev.title}</Link>
        ) : <span />}
        {next ? (
          <Link to={`${base}/${next.slug}`} className="tactic-page-btn">{next.title} →</Link>
        ) : <span />}
      </div>
    </Page>
  );
}