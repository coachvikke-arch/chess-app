import { useEffect, useRef, useState } from 'react';
import StudentAvatar from './StudentAvatar';
import { Skeleton } from './skeleton';
import { useToast } from './Toast';
import emblemUrl from '../assets/logo-emblem.png';

/* Fixed, evenly spread sparkle field. Deterministic (no Math.random) so the
   card looks identical on every open and in screenshots. */
const SPARKLES = Array.from({ length: 16 }, (_, i) => ({
  left: `${((i * 37 + 13) % 97) + 1.5}%`,
  top: `${((i * 61 + 7) % 88) + 4}%`,
  size: 8 + (i % 4) * 3,
  delay: `${((i * 29) % 40) / 10}s`,
  dur: `${2.4 + ((i * 17) % 18) / 10}s`,
}));

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* Pointer-driven tilt + glare. The pointer position is written straight to CSS
   variables on the tilt node (rAF-throttled), so moving the mouse never
   re-renders React. Events sit on the outer .pc-hit layer: listening on the
   tilting element itself moves its own rect under the cursor and jitters. */
function useTilt({ enabled, max = 10, delay = 0 }) {
  const hitRef = useRef(null);
  const tiltRef = useRef(null);
  const [hovering, setHovering] = useState(false);
  const hoveringRef = useRef(false);
  const readyRef = useRef(false);
  const rafRef = useRef(0);
  const pointRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    if (!enabled) return undefined;
    readyRef.current = false;
    const timer = window.setTimeout(() => { readyRef.current = true; }, delay);
    return () => window.clearTimeout(timer);
  }, [enabled, delay]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const paint = () => {
    rafRef.current = 0;
    const el = tiltRef.current;
    if (!el) return;
    const { x, y } = pointRef.current;
    el.style.setProperty('--rx', `${(0.5 - y) * 2 * max}deg`);
    el.style.setProperty('--ry', `${(x - 0.5) * 2 * max}deg`);
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
  };

  const setHover = (on) => {
    hoveringRef.current = on;
    setHovering(on);
  };

  const onMove = (e) => {
    if (!enabled || !readyRef.current) return;
    const rect = hitRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    pointRef.current = {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
    if (!hoveringRef.current) setHover(true);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(paint);
  };

  const reset = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setHover(false);
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  const onUp = (e) => {
    if (e.pointerType !== 'mouse') reset();
  };

  return { hitRef, tiltRef, hovering, onEnter: onMove, onMove, onLeave: reset, onUp };
}

/* Ease-out count from 0. Starts after the stagger has revealed the number so
   the climb is actually seen, and lands on the real value when it finishes. */
function useCountUp(target, play, duration = 1300, startDelay = 1100) {  const [value, setValue] = useState(() => (typeof target === 'number' && play ? 0 : (target ?? null)));
  useEffect(() => {
    if (typeof target !== 'number' || !Number.isFinite(target)) {
      setValue(null);
      return undefined;
    }
    if (!play) {
      setValue(target);
      return undefined;
    }
    let raf;
    let timer;
    const start = () => {
      const t0 = performance.now();
      const frame = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const eased = 1 - (1 - p) ** 3;
        setValue(Math.round(target * eased));
        if (p < 1) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    timer = window.setTimeout(start, startDelay);
    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, play, duration, startDelay]);
  return value;
}

function Num({ value, play }) {
  const shown = useCountUp(value, play);
  if (typeof value !== 'number' || !Number.isFinite(value)) return <>—</>;
  return <>{(shown ?? value).toLocaleString('en-IN')}</>;
}

function joinedLabel(joinedAt) {
  const d = joinedAt ? new Date(joinedAt) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function statsFor(card) {
  const joined = joinedLabel(card.joinedAt);
  if (card.roleLabel === 'COACH') {
    return [
      { key: 'streak', label: 'Day streak', number: card.dayStreak },
      { key: 'students', label: 'Students', number: card.studentsCount },
      { key: 'classes', label: 'Classes', number: card.classesCount },
      { key: 'since', label: 'Member since', text: joined },
    ];
  }
  return [
    { key: 'streak', label: 'Day streak', number: card.dayStreak },
    { key: 'puzzle', label: 'Puzzle rating', number: card.puzzleRating },
    { key: 'games', label: 'Games played', number: card.gamesPlayed },
    { key: 'joined', label: 'Joined', text: joined },
  ];
}

/**
 * The white/sky player card. One renderer for the public /card/:token page and
 * for the "Preview scan" modal, so the preview is the same card, not a lookalike.
 * `animate` plays the burst → rise → stagger → count-up sequence.
 * `interactive` turns on the pointer tilt/glare/veil skin and the save button.
 * `onShare` adds the caption row — the public page has its own action row, so
 * it only renders in the preview modal.
 */
export default function PlayerCard({ card, animate = true, innerRef = null, interactive = false, onShare = null }) {
  const localRef = useRef(null);
  const ref = innerRef || localRef;
  const rating = typeof card.rating === 'number' ? card.rating : null;
  const ratingValue = useCountUp(rating, animate);
  const stats = statsFor(card);
  const avatar = card.avatar || {};
  const { showToast } = useToast();
  const [saved, setSaved] = useState(false);
  const tilt = useTilt({ enabled: interactive, max: 10, delay: animate ? 1600 : 0 });
  const roleText = card.roleLabel === 'COACH' ? 'Coach' : 'Student';

  const toggleSaved = (e) => {
    e.stopPropagation();
    const next = !saved;
    setSaved(next);
    showToast(next ? 'Saved to my cards' : 'Removed from saved', {
      tone: next ? 'success' : 'info',
      title: 'Player card',
    });
  };

  let avatarNode;
  if (avatar.config) {
    avatarNode = (
      <StudentAvatar
        config={avatar.config}
        seed={card.username || card.name}
        size={98}
        className="pc-avatar-svg"
        alt=""
      />
    );
  } else if (avatar.image) {
    avatarNode = <img src={avatar.image} alt="" className="pc-avatar-img" />;
  } else {
    avatarNode = <span className="pc-initial">{(card.name || '?').trim().charAt(0).toUpperCase()}</span>;
  }

  return (
    <div className="pc-stage" data-animate={animate ? 'true' : 'false'}>
      {animate && <span className="pc-burst" aria-hidden="true" />}
      <div className="pc-sparkles" aria-hidden="true">
        {SPARKLES.map((s, i) => (
          <span
            key={i}
            className="pc-sparkle"
            style={{ left: s.left, top: s.top, fontSize: s.size, animationDelay: s.delay, animationDuration: s.dur }}
          >
            ✦
          </span>
        ))}
      </div>
      <div
        className="pc-hit"
        ref={tilt.hitRef}
        onPointerEnter={tilt.onEnter}
        onPointerMove={tilt.onMove}
        onPointerLeave={tilt.onLeave}
        onPointerUp={tilt.onUp}
        onPointerCancel={tilt.onLeave}
      >
        <div className={`pc-tl${tilt.hovering ? ' hov' : ''}`} ref={tilt.tiltRef}>
          {interactive && (
            <button
              type="button"
              className={`pc-bm${saved ? ' is-saved' : ''}`}
              aria-label="Save card"
              aria-pressed={saved}
              onClick={toggleSaved}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M6 4.5h12a1 1 0 0 1 1 1V21l-7-4.2L5 21V5.5a1 1 0 0 1 1-1Z" />
              </svg>
            </button>
          )}
          <div className="pc-enter">
            <article
              ref={ref}
              className="pc-card"
              aria-label={`${card.name || 'Player'} — MateZone player card`}
              tabIndex={interactive ? 0 : undefined}
            >
              <span className="pc-fr" aria-hidden="true" />
              <div className="pc-inner">
                <span className="pc-shine" aria-hidden="true" />
                <span className="pc-veil" aria-hidden="true" />
                <span className="pc-glare" aria-hidden="true" />
                <span className="pc-sweep" aria-hidden="true" />
                <header className="pc-head pc-rise" style={{ '--i': 0 }}>
                  <span className="pc-brand">
                    <img src={emblemUrl} alt="" />
                    <span className="pc-brand-name">MATEZONE<br />CHESS ACADEMY</span>
                  </span>
                  <span className="pc-chip">{card.roleLabel}</span>
                </header>

                <div className="pc-ring pc-rise" style={{ '--i': 1 }}>
                  <div className="pc-photo">{avatarNode}</div>
                </div>

                <h1 className="pc-name pc-rise" style={{ '--i': 2 }}>{card.name || 'MateZone player'}</h1>
                <div className="pc-minor pc-rise" style={{ '--i': 2 }}>
                  {card.username ? `@${card.username}` : ''}
                  {card.subtitle ? <span className="pc-tier">{card.subtitle}</span> : null}
                </div>

                <div className="pc-rating pc-rise" style={{ '--i': 4 }}>
                  <span className="pc-rating-num">
                    {typeof rating === 'number' ? (ratingValue ?? rating).toLocaleString('en-IN') : '—'}
                  </span>
                  <span className="pc-rating-label">RAPID RATING</span>
                </div>

                <div className="pc-stats">
                  {stats.map((s, idx) => (
                    <div key={s.key} className="pc-stat pc-rise" style={{ '--i': 5 + idx }}>
                      <span className="pc-stat-val">
                        {s.number !== undefined ? <Num value={s.number} play={animate} /> : s.text}
                      </span>
                      <span className="pc-stat-label">{s.label}</span>
                    </div>
                  ))}
                </div>

                <footer className="pc-foot pc-rise" style={{ '--i': 9 }}>
                  <span>Member ID {card.memberId}</span>
                  <span className="pc-verified">✔ Verified member</span>
                </footer>
              </div>
            </article>
          </div>
          {interactive && onShare && (
            <div className="pc-caption pc-rise" style={{ '--i': 10 }}>
              <span className="pc-cap-main">
                <span className="pc-cap-name">{card.name || 'MateZone player'}</span>
                <span className="pc-cap-meta">
                  {roleText} · Rapid {typeof rating === 'number' ? rating.toLocaleString('en-IN') : '—'}
                </span>
              </span>
              <span className="pc-cap-right">
                <span className="pc-cap-verified">✔ Verified member</span>
                {onShare && (
                  <button type="button" className="pc-cap-share" onClick={onShare}>Share</button>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Card-shaped loading state built on the app's shimmer primitives. */
export function PlayerCardSkeleton() {
  return (
    <div className="pc-stage pc-stage--skeleton">
      <div className="pc-skel-card" role="status" aria-label="Loading player card" aria-busy="true">
        <div className="pc-skel-row">
          <Skeleton width="46%" height="0.9rem" />
          <Skeleton width="22%" height="0.9rem" />
        </div>
        <Skeleton width="104px" height="104px" radius="50%" className="pc-skel-ring" />
        <Skeleton width="62%" height="1.4rem" className="pc-skel-center" />
        <Skeleton width="38%" height="0.8rem" className="pc-skel-center" />
        <Skeleton width="46%" height="2.6rem" className="pc-skel-center" />
        <div className="pc-skel-stats">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height="3.4rem" radius="12px" />)}
        </div>
        <Skeleton width="100%" height="0.8rem" />
      </div>
    </div>
  );
}
