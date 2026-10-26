/**
 * AI Coach Training Academy — dashboard.
 *
 * Answers four questions in one screen: where am I, what should I do next, what
 * is weak, and what have I already earned. Everything on it is derived from
 * recorded scores, so nothing here can be inflated by browsing.
 */

import { Link } from 'react-router-dom';
import { Page, Card, Stat, Spinner, Chip } from '../../../components/ui';
import Button from '../../../components/Button';
import useAcademyProgress from '../hooks/useAcademyProgress';
import { CURRICULUM } from '../services/academyStore';
import { MiniStat, ProgressRow, MasteryChip } from '../components/AcademyUI';
import { formatDuration } from '../utils/format';

export default function CoachAcademyDashboard() {
  const p = useAcademyProgress();

  if (!p.user) return <Spinner text="Loading your academy progress…" />;

  const level = p.levelRecord;
  const rec = p.recommended;

  return (
    <Page
      title="AI Coach Training Academy"
      piece="♛"
      sub="Ten levels. Every topic trained through the same 16 steps, from concept to teach-back to coach test."
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Overall mastery" value={`${p.overall}%`} icon="♛" />
        <Stat label="Current level" value={`Level ${p.level}`} icon="♞" />
        <Stat label="Topics mastered" value={`${p.dashboard.masteredTopics}/${p.dashboard.totalTopics}`} icon="♟" />
        <Stat label="Needs revision" value={p.revisionCount} icon="⟳" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr,340px] items-start">
        <div className="space-y-5">
          {/* The single next action. */}
          <Card title="Recommended next" piece="➜">
            {rec ? (
              <>
                <p className="text-xs uppercase tracking-wider text-gold-400 mb-1">{rec.reason}</p>
                <p className="font-display text-lg font-bold text-ivory-100 mb-3">{rec.name}</p>
                <Button
                  to={`/coach/ai-coach-training/topic/${rec.topicId}`}
                  variant="primary"
                  size="md"
                >
                  Continue training
                </Button>
              </>
            ) : (
              <p className="text-sm text-ivory-500">
                Every topic is mastered. Retake any level exam to refresh a record.
              </p>
            )}
          </Card>

          {/* The ladder. Every level is open and reachable from here — this is a
              training catalogue, not a prize ladder, and a coach revising a
              concept should never be told they cannot open the page that holds
              it. Progress is shown as mastery, not as an exam verdict. */}
          <Card title="All levels" piece="♜">
            <ul className="space-y-2">
              {CURRICULUM.map((l) => {
                const info = p.forLevel(l.n);
                const isCurrent = l.n === p.level;
                return (
                  <li key={l.n}>
                    <Link
                      to={`/coach/ai-coach-training/level/${l.n}`}
                      className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                        isCurrent
                          ? 'border-gold-500/60 bg-gold-500/[0.08] hover:border-gold-500'
                          : 'border-ivory-700/40 hover:border-gold-500/50 bg-black/[0.02]'
                      }`}
                    >
                      <span className="chess-stat-icon">{l.n}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-ivory-100 truncate">
                          {l.n}. {l.title}
                        </p>
                        <p className="text-xs text-ivory-500 truncate">{l.tagline}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {isCurrent ? (
                          <Chip tone="gold">Current</Chip>
                        ) : info.progress.percent > 0 ? (
                          <span className="text-xs text-ivory-300">
                            {info.progress.mastered}/{info.progress.total}
                          </span>
                        ) : (
                          <span className="text-xs text-ivory-700">not started</span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          {level && (
            <Card title={`Level ${level.n} progress`} piece="◐">
              <ProgressRow
                percent={p.levelProgress.percent}
                label={`${p.levelProgress.mastered} of ${p.levelProgress.total} topics mastered`}
              />
              <div className="mt-3">
                <ProgressRow
                  percent={p.levelProgress.practicePercent}
                  label="Practiced"
                  hint={`${p.levelProgress.practicePercent}%`}
                />
              </div>
            </Card>
          )}

          <Card title="Revision queue" piece="⟳">
            {p.revision.length === 0 ? (
              <p className="text-sm text-ivory-500">Nothing weak on record yet.</p>
            ) : (
              <ul className="space-y-2">
                {p.revision.slice(0, 6).map((t) => (
                  <li key={t.topicId}>
                    <Link
                      to={`/coach/ai-coach-training/topic/${t.topicId}`}
                      className="flex items-center gap-2 text-sm hover:text-ivory-100 transition"
                    >
                      <span className="flex-1 text-ivory-300 truncate">{t.name}</span>
                      <MasteryChip state={t.state} />
                      <span className="text-xs text-ivory-500">{t.percent}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Skill profile" piece="♜">
            {Object.keys(p.skills).length === 0 ? (
              <p className="text-sm text-ivory-500">Complete some training to build a profile.</p>
            ) : (
              <ul className="space-y-2.5">
                {Object.entries(p.skills).map(([k, v]) => (
                  <li key={k}>
                    <ProgressRow percent={v} label={k} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Session" piece="⏱">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Streak (days)" value={p.streak} />
              <MiniStat label="Training time" value={formatDuration(p.trainingMs)} />
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}