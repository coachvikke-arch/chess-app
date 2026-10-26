/**
 * AI Coach Training Academy — level detail.
 *
 * One level's modules and topics with per-topic mastery. Every level is open:
 * this is a training catalogue, not a prize ladder, so there is no lock, no
 * pass mark and no exam card here. Progress is expressed only as mastery.
 *
 * The level's final task is still shown — as the outcome the level works
 * towards, not as a gate that has to be sat.
 */

import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Page, Card, Spinner } from '../../../components/ui';
import useAcademyProgress from '../hooks/useAcademyProgress';
import { getLevelRecord } from '../services/academyStore';
import { ProgressRow, MasteryChip } from '../components/AcademyUI';

export default function CoachAcademyLevel() {
  const { levelN } = useParams();
  const navigate = useNavigate();
  const p = useAcademyProgress();

  const level = useMemo(() => getLevelRecord(levelN), [levelN]);
  const info = useMemo(() => p.forLevel(levelN), [p, levelN]);

  if (!level) return <Page title="Level" piece="♞"><Spinner text="That level does not exist." /></Page>;

  return (
    <Page
      title={`Level ${level.n} — ${level.title}`}
      piece="♞"
      sub={level.description}
      wide
    >
      <div className="grid gap-5 lg:grid-cols-[1fr,300px] items-start">
        <div className="space-y-5">
          {level.modules.map((mod) => (
            <Card key={mod.id} title={mod.title} piece="♟">
              <p className="text-sm text-ivory-500 mb-4">{mod.description}</p>
              <ul className="space-y-2">
                {mod.topics.map((t) => {
                  const tp = p.forTopic(t.id);
                  return (
                    <li key={t.id}>
                      <Link
                        to={`/coach/ai-coach-training/topic/${t.id}`}
                        className="flex items-center gap-3 rounded-xl border border-ivory-700/40 bg-black/[0.02] p-3 hover:border-gold-500/50 transition"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-ivory-100 truncate">{t.name}</p>
                          <p className="text-xs text-ivory-500 truncate">{t.summary}</p>
                        </div>
                        <MasteryChip state={tp.record.state} />
                        <span className="text-xs text-ivory-500 w-10 text-right">{tp.percent}%</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>

        <div className="space-y-5">
          <Card title="Progress" piece="◐">
            <ProgressRow
              percent={info.progress.percent}
              label={`${info.progress.mastered}/${info.progress.total} mastered`}
            />
            <div className="mt-3">
              <ProgressRow percent={info.progress.practicePercent} label="Practiced" />
            </div>
          </Card>

          <Card title="What this level builds" piece="✦">
            <p className="text-sm text-ivory-300 leading-relaxed">{level.finalTask}</p>
          </Card>

          <Card title="Competencies" piece="♜">
            <ul className="space-y-1.5">
              {level.competency.map((c) => (
                <li key={c} className="text-sm text-ivory-300">
                  • {c}
                </li>
              ))}
            </ul>
          </Card>

          <button
            type="button"
            onClick={() => navigate(`/coach/ai-coach-training/level/${Math.min(10, level.n + 1)}`)}
            className="w-full text-sm text-ivory-500 hover:text-ivory-100 transition text-left"
          >
            Next level →
          </button>
        </div>
      </div>
    </Page>
  );
}