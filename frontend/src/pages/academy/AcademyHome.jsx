import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../../services/api';
import { Page, Card, Bar, Spinner } from '../../components/ui';
import academyBase from '../../utils/academyBase';

function LevelCard({ level, idx, base }) {
  const locked = !level.unlocked;
  return (
    <Link
      to={locked ? '#consultant' : `${base}/level/${level.slug}`}
      className="block group"
      onClick={(e) => {
        if (locked) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div
          className={`relative rounded-3xl border p-6 h-full flex flex-col overflow-hidden transition-all duration-300 ${
            locked
              ? 'border-ivory-700/40 bg-white opacity-70'
              : 'border-ivory-700/40 bg-white hover:shadow-[0_20px_60px_rgba(0,0,0,0.4)] hover:-translate-y-1'
          }`}
        style={{ borderTop: `3px solid ${locked ? '#666' : level.accent}` }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-4xl" style={{ filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.4))' }}>
            {level.icon}
          </span>
          <span className="text-[0.65rem] uppercase tracking-[0.18em] text-ivory-500 font-semibold">
            Level {idx + 1} · {level.totalLessons} lessons
          </span>
        </div>

        <h3 className="font-display text-xl font-bold text-ivory-100 mt-3">{level.name}</h3>
        <p className="text-sm text-ivory-500 mt-1 leading-relaxed">{level.tagline}</p>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-ivory-500">
              {locked ? (
                <span className="flex items-center gap-1.5 text-gold-400">
                  🔒 Unlocks at {level.neededPct}%
                </span>
              ) : (
                `${level.completedLessons}/${level.totalLessons} lessons`
              )}
            </span>
            <span className="text-ivory-500 font-semibold">{level.pct}%</span>
          </div>
          <Bar pct={locked ? 0 : level.pct} />
          {locked && level.lockedBy && (
            <p className="text-xs text-ivory-500 mt-2">Complete the {level.lockedBy} level to unlock.</p>
          )}
        </div>

        {idx === 0 && !locked && (
          <span className="absolute top-4 right-4 text-[0.65rem] font-bold uppercase tracking-wider text-ink-900 bg-gold-400 py-1 px-2.5 rounded-full">
            Start here
          </span>
        )}
      </div>
    </Link>
  );
}

function RewardSection({ reward }) {
  const unlocked = !!reward?.unlocked;
  return (
    <section className={`academy-reward-card mixed-glow ${unlocked ? 'unlocked' : 'locked'}`}>
      <div className="academy-reward-icon">{unlocked ? '♛' : '🔒'}</div>
      <div className="academy-reward-copy">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] font-bold">{unlocked ? 'Permanent reward unlocked' : 'Intermediate reward'}</p>
        <h3>{unlocked ? 'Tactical Training Vault' : 'Reach 50% of Intermediate'}</h3>
        <p>{unlocked ? 'Your Intermediate Tactical Training Vault is permanently available, even if later progress is recalculated.' : 'Complete half of the Intermediate level to permanently unlock the Tactical Training Vault.'}</p>
      </div>
      <span className="academy-reward-status">{unlocked ? (reward.unlockedByRole ? 'Coach access' : 'Unlocked forever') : '50% required'}</span>
    </section>
  );
}

function BadgeGrid({ badges }) {
  const locked = badges.filter((b) => !b.unlocked);
  const earned = badges.filter((b) => b.unlocked);
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {earned.map((b) => (
          <div
            key={b.code}
            className="rounded-2xl border border-gold-500/25 bg-gradient-to-br from-gold-500/10 to-transparent p-3.5 flex items-center gap-3"
            title={b.description}
          >
            <span className="text-2xl">{b.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ivory-300 truncate">{b.name}</p>
              <p className="text-[0.65rem] text-gold-400 uppercase tracking-wider">+{b.xpValue} XP</p>
            </div>
          </div>
        ))}
        {locked.map((b) => (
          <div
            key={b.code}
            className="rounded-2xl border border-ivory-700/40 bg-black/[0.02] p-3.5 flex items-center gap-3 opacity-60"
            title={b.description}
          >
            <span className="text-2xl grayscale">{b.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ivory-500 truncate">{b.name}</p>
              <p className="text-[0.65rem] text-ivory-500 uppercase tracking-wider">
                {b.unlocked ? `${b.xpValue} XP` : 'Locked'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AcademyHome() {
  const location = useLocation();
  const base = academyBase(location.pathname);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/academy/overview', { cache: false })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load academy'));
  }, []);

  if (error) {
    return (
      <Page title="Academy" piece="♘">
        <Card title="Something went wrong"><p className="text-ivory-500">{error}</p></Card>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Academy" piece="♘">
        <Spinner text="Loading your academy…" />
      </Page>
    );
  }

  const body = (
    <>
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total XP', value: data.stats.xp, icon: '⚡' },
          { label: 'Day streak', value: data.stats.streak, icon: '🔥' },
          { label: 'Sessions', value: data.stats.sessionsCompleted, icon: '🎯' },
          { label: 'Accuracy', value: data.stats.exercisesAttempted ? `${Math.round((data.stats.exercisesCorrect / data.stats.exercisesAttempted) * 100)}%` : '0%', icon: '🎯' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-ivory-700/40 bg-white p-4 text-center shadow-sm">
            <span className="text-xl">{s.icon}</span>
            <p className="font-display text-2xl font-bold text-gold-400 mt-1">{s.value}</p>
            <p className="text-[0.65rem] uppercase tracking-wider text-ivory-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Permanent intermediate milestone reward */}
      <RewardSection reward={data.reward} />

      {/* Levels */}
      <div className="grid md:grid-cols-3 gap-5">
        {data.levels.map((l, idx) => (
          <LevelCard key={l.slug} level={l} idx={idx} base={base} />
        ))}
      </div>

      {/* Badges */}
      <Card title="Badges & Achievements" piece="🏆" className="mt-8">
        <BadgeGrid badges={data.badges} />
      </Card>

      <div className="mt-6 rounded-2xl border border-gold-500/15 bg-gold-500/[0.04] p-4 flex items-start gap-3">
        <span className="text-xl">💡</span>
        <p className="text-sm text-ivory-500 leading-relaxed">
          Finish <b className="text-ivory-500">all lessons in a level 100%</b> to unlock the next one. Every correct answer earns XP, and streaks keep you motivated — complete activities on consecutive days to grow your flame.
        </p>
      </div>
    </>
  );

  return (
    <Page title="Academy" piece="♘" sub="A structured path from your first move to Opening Master.">
      {body}
    </Page>
  );
}