import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import Button from './Button';

/**
 * Level-up celebration popup.
 *
 * Detects a NEWLY unlocked level by comparing the current rating profile's
 * permanent level list against a localStorage baseline (per student). When a
 * tier was reached that we hadn't seen before, fires a congratulatory overlay
 * and then "permanently locks" the baseline so it only celebrates once.
 *
 * Also listens for a manual `knightpath:levelup` event carrying
 * { level, badge, rating } so game flows can trigger it immediately.
 */
export default function LevelUpCelebration() {
  const [celebrate, setCelebrate] = useState(null);
  const fired = useRef(new Set());
  const { user } = useAuth();
  const isStudent = user?.role === 'student';

  useEffect(() => {
    if (!isStudent) return;
    let cancelled = false;

    const show = (info) => {
      if (info && !fired.current.has(info.level)) {
        fired.current.add(info.level);
        setCelebrate(info);
        const t = setTimeout(() => setCelebrate(null), 5200);
        return () => clearTimeout(t);
      }
    };

    api.get('/students/ratings/me', { cache: false })
      .then((res) => {
        if (cancelled || !res.data?.studentId) return;
        const baselineKey = `knightpath-levels-${res.data.studentId}`;
        const seen = new Set(JSON.parse(localStorage.getItem(baselineKey) || '[]'));
        const unlocked = (res.data.levelsUnlocked || []).map((l) => l.level);
        const fresh = res.data.nextLevel ? [res.data.nextLevel] : [];
        // any unlocked level not yet in baseline → celebrate the newest
        const newLevels = unlocked.filter((l) => !seen.has(l));
        if (newLevels.length > 0) {
          const best = Math.max(...newLevels);
          const lvl = unlocked.indexOf(best);
          const meta = res.data.levelsUnlocked[lvl];
          show({ level: best, badge: meta?.badge_name || res.data.maxLevel.name, tier: meta?.badge_name, rating: res.data.currentRating, next: res.data.nextLevel, levelsUnlocked: unlocked });
          seen.clear();
          unlocked.forEach((l) => seen.add(l));
          localStorage.setItem(baselineKey, JSON.stringify([...seen]));
        }
      })
      .catch(() => { });

    const onEvent = (e) => {
      if (e.detail) show(e.detail);
    };
    window.addEventListener('knightpath:levelup', onEvent);
    return () => {
      cancelled = true;
      window.removeEventListener('knightpath:levelup', onEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStudent]);

  if (!celebrate) return null;

  return (
    <div className="levelup-overlay" role="dialog" aria-modal="true">
      <div className="levelup-card">
        <span className="levelup-rings" aria-hidden="true" />
        <div className="levelup-badge">
          <span className="levelup-icon">{celebrate.tier ? clueIcon(celebrate.level, celebrate.tier) : '♛'}</span>
        </div>
        <p className="levelup-eyebrow">Level up! 🎉</p>
        <h2 className="levelup-title">
          You've reached <span className="chess-gradient-text">Level {celebrate.level} — {celebrate.badge}</span>!
        </h2>
        {celebrate.rating != null && (
          <p className="levelup-sub">
            Current rating <strong>{celebrate.rating}</strong>
            {celebrate.next ? ` · ${celebrate.next.min - celebrate.rating} pts to ${celebrate.next.name}` : ' · highest tier reached 🏆'}
          </p>
        )}
        <Button variant="primary" size="md" onClick={() => setCelebrate(null)}>Keep going ♟</Button>
      </div>
    </div>
  );
}

function clueIcon(level, tier) {
  const map = { Pawn: '♙', Knight: '♘', Bishop: '♗', Rook: '♖', Queen: '♕', King: '♔', Grandmaster: '♚' };
  return map[tier] || map[level] || '♛';
}