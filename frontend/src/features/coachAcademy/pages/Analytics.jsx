/**
 * AI Coach Training Academy — analytics.
 *
 * Every figure comes from recorded scores and history, never from "pages
 * opened". The activity chart is the useful part: it is the only place a coach
 * can see whether their practice is actually moving mastery or just being busy.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Card, Stat, Bar, Chip } from '../../../components/ui';
import useAcademyProgress from '../hooks/useAcademyProgress';
import { MASTERY_CRITERIA } from '../data/levels';
import { formatDuration, formatRelative, formatDate } from '../utils/format';
import { ProgressRow, MasteryChip, Empty } from '../components/AcademyUI';
import Button from '../../../components/Button';

/** Last `days` days as YYYY-MM-DD, oldest first. */
function dayKeys(days) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

export default function CoachAcademyAnalytics() {
  const p = useAcademyProgress();

  /* Mastery per criterion, across every topic that has any score recorded. */
  const criteria = useMemo(() => {
    const buckets = Object.fromEntries(MASTERY_CRITERIA.map((c) => [c, []]));
    for (const [topicId, rec] of Object.entries(p.state.topics || {})) {
      for (const c of MASTERY_CRITERIA) {
        const v = rec?.scores?.[c];
        if (typeof v === 'number') buckets[c].push(v);
      }
    }
    return Object.entries(buckets).map(([k, list]) => ({
      key: k,
      percent: list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0,
      samples: list.length,
    }));
  }, [p.state.topics]);

  /* Practice volume per day, from the capped history log. */
  const activity = useMemo(() => {
    const days = 14;
    const counts = new Map(dayKeys(days).map((d) => [d, 0]));
    for (const h of p.state.history || []) {
      const d = new Date(h.at).toISOString().slice(0, 10);
      if (counts.has(d)) counts.set(d, counts.get(d) + 1);
    }
    const series = [...counts.entries()].map(([day, n]) => ({ day, n }));
    const peak = Math.max(1, ...series.map((s) => s.n));
    return { series, peak, total: series.reduce((a, s) => a + s.n, 0) };
  }, [p.state.history]);

  const attempts = p.assessments.length;

  return (
    <Page title="Academy analytics" piece="◐" sub="What your recorded practice actually produced." wide>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Overall mastery" value={`${p.overall}%`} icon="♛" />
        <Stat label="Exams taken" value={attempts} icon="✍" />
        <Stat label="Training time" value={formatDuration(p.trainingMs)} icon="⏱" />
        <Stat label="Current streak" value={`${p.streak}d`} icon="🔥" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <Card title="Mastery by criterion" piece="♜">
          <p className="text-sm text-ivory-500 mb-4">
            Each criterion is only counted where you have actually demonstrated it, so an empty bar means
            "not yet trained", not "failed".
          </p>
          <ul className="space-y-3">
            {criteria.map((c) => (
              <li key={c.key}>
                <ProgressRow
                  percent={c.percent}
                  label={c.key}
                  hint={c.samples ? `${c.percent}% (${c.samples})` : 'not started'}
                />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Activity — last 14 days" piece="⏱">
          {activity.total === 0 ? (
            <Empty>No recorded practice yet.</Empty>
          ) : (
            <>
              <div className="flex items-end gap-1 h-28 mb-2">
                {activity.series.map((s) => (
                  <div
                    key={s.day}
                    className="flex-1 rounded-t bg-gold-500/60 hover:bg-gold-400 transition"
                    style={{ height: `${Math.max(4, (s.n / activity.peak) * 100)}%` }}
                    title={`${s.day}: ${s.n} record${s.n === 1 ? '' : 's'}`}
                  />
                ))}
              </div>
              <p className="text-xs text-ivory-700">
                {activity.total} recorded score{activity.total === 1 ? '' : 's'} over 14 days.
              </p>
            </>
          )}
        </Card>

        <Card title="Competencies" piece="♛">
          {Object.keys(p.skills).length === 0 ? (
            <Empty hint="Complete a topic to start building this profile.">No competency data yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {Object.entries(p.skills).map(([k, v]) => (
                <li key={k}>
                  <ProgressRow percent={v} label={k} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Exam history" piece="✍">
          {p.assessments.length === 0 ? (
            <Empty hint="Pass a level exam to unlock the next level.">No exams taken yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {p.assessments.map((a) => (
                <li key={a.level} className="flex items-center gap-3 text-sm">
                  <Link
                    to={`/coach/ai-coach-training/level/${a.level}`}
                    className="text-ivory-300 hover:text-gold-600 transition w-24"
                  >
                    Level {a.level}
                  </Link>
                  <div className="flex-1">
                    <Bar pct={a.best} />
                  </div>
                  {a.passed ? <Chip tone="green">{a.best}%</Chip> : <Chip tone="amber">{a.best}%</Chip>}
                  <span className="text-xs text-ivory-700">{formatDate(a.takenAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity" piece="⟳">
          {p.recent.length === 0 ? (
            <Empty>Nothing opened yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {p.recent.map((r) => (
                <li key={r.topicId} className="flex items-center gap-3 text-sm">
                  <Link
                    to={`/coach/ai-coach-training/topic/${r.topicId}`}
                    className="flex-1 text-ivory-300 hover:text-gold-600 transition truncate"
                  >
                    {r.name}
                  </Link>
                  <span className="text-xs text-ivory-500">{r.percent}%</span>
                  <span className="text-xs text-ivory-700 w-20 text-right">{formatRelative(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Data & reset" piece="⚙">
          <p className="text-sm text-ivory-500 mb-3">
            Progress is stored on this device, scoped to your account. Resetting removes all academy history
            for you — it does not affect other coaches on this machine.
          </p>
          <ResetControl onReset={p.reset} />
        </Card>
      </div>
    </Page>
  );
}

function ResetControl({ onReset }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button
        type="button"
        variant="danger"
        size="md"
        onClick={() => setArmed(true)}
      >
        Reset academy progress
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-sm text-red-300">This cannot be undone.</span>
      <Button
        type="button"
        variant="danger"
        size="md"
        onClick={() => {
          onReset();
          setArmed(false);
        }}
      >
        Yes, erase everything
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="md"
        onClick={() => setArmed(false)}
      >
        Cancel
      </Button>
    </div>
  );
}