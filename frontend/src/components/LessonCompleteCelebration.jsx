import { useMemo } from 'react';
import Button from './Button';

const CONFETTI_COLORS = ['#93c5fd', '#bfdbfe', '#fff6e0', '#60a5fa', '#1d4ed8', '#2563eb', '#ffffff', '#60a5fa'];
const CONFETTI_GLYPHS = ['♙', '♘', '♗', '♖', '✦', '★', '♦'];

/**
 * Full-screen "Lesson Complete!" celebration.
 *
 * Golden confetti, gently bouncing chess pieces, a glowing crown, the XP /
 * streak reward summary and a prominent Continue button.
 *
 * Props:
 *  - xp: number                  total XP earned this session
 *  - streak: number              current streak (0 hides the flame)
 *  - badges: array               newly unlocked badges: [{icon, name, xpValue}]
 *  - sub: string                 optional subtitle line
 *  - onContinue: () => void      primary action
 *  - onBack: () => void          secondary "Back to level" action
 */
export default function LessonCompleteCelebration({
  xp = 0,
  streak = 0,
  badges = [],
  sub = '',
  onContinue,
  onBack,
}) {
  /* Confetti pieces — generated once per mount so the burst is stable. */
  const confetti = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => ({
        i,
        left: Math.random() * 100,
        delay: Math.random() * 1.1,
        dur: 2.4 + Math.random() * 2.2,
        size: 7 + Math.random() * 9,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        glyph: CONFETTI_GLYPHS[i % CONFETTI_GLYPHS.length],
        glyphChance: i % 4 === 0,
      })),
    [],
  );

  return (
    <div className="lcc-overlay" role="dialog" aria-modal="true" aria-label="Lesson complete">
      {/* falling golden confetti + chess pieces */}
      <div className="lcc-confetti" aria-hidden="true">
        {confetti.map((c) =>
          c.glyphChance ? (
            <span
              key={c.i}
              className="lcc-piece"
              style={{
                left: `${c.left}%`,
                fontSize: c.size + 4,
                color: c.color,
                animationDuration: `${c.dur}s`,
                animationDelay: `${c.delay}s`,
              }}
            >
              {c.glyph}
            </span>
          ) : (
            <span
              key={c.i}
              className="lcc-bar"
              style={{
                left: `${c.left}%`,
                width: c.size * 0.8,
                height: c.size * 1.4,
                background: c.color,
                animationDuration: `${c.dur}s`,
                animationDelay: `${c.delay}s`,
              }}
            />
          ),
        )}
      </div>

      <div className="lcc-card">
        <div className="lcc-crown-row" aria-hidden="true">
          <span className="lcc-bounce" style={{ animationDelay: '0s' }}>♘</span>
          <span className="lcc-crown">♔</span>
          <span className="lcc-bounce" style={{ animationDelay: '0.18s' }}>♗</span>
        </div>

        <p className="lcc-eyebrow">Level cleared</p>
        <h2 className="lcc-title">
          Lesson <span>Complete</span>!
        </h2>
        {sub && <p className="lcc-sub">{sub}</p>}

        <div className="lcc-stats">
          <div className="lcc-stat">
            <span className="lcc-stat-icon">⚡</span>
            <span className="lcc-stat-num">+{xp} XP</span>
            <span className="lcc-stat-label">Earned this session</span>
          </div>
          {streak > 0 && (
            <div className="lcc-stat">
              <span className="lcc-stat-icon cc-flame">🔥</span>
              <span className="lcc-stat-num">{streak} day streak</span>
              <span className="lcc-stat-label">Keep it burning</span>
            </div>
          )}
        </div>

        {badges.length > 0 && (
          <div className="lcc-badges">
            {badges.map((b) => (
              <span key={b.code || b.icon + b.name} className="lcc-badge">
                <span className="lcc-badge-icon">{b.icon}</span>
                {b.name} <b>+{b.xpValue} XP</b>
              </span>
            ))}
          </div>
        )}

        <div className="lcc-actions">
          {onBack && (
            <Button variant="secondary" size="md" onClick={onBack}>
              ← Back to level
            </Button>
          )}
          {onContinue && (
            <Button variant="primary" size="md" className="lcc-continue" onClick={onContinue} autoFocus>
              Continue →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}