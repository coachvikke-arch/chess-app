/**
 * AI Coach Training Academy — revision mode.
 *
 * Revision Mode is one of the seven training modes, and this page is where it
 * actually runs. It is deliberately not a copy of the topic list: it is the
 * weakest-first queue the store computes, with the specific reason each topic
 * is weak, so the coach works from evidence instead of re-reading everything.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Card, Chip, Bar } from '../../../components/ui';
import Button from '../../../components/Button';
import useAcademyProgress from '../hooks/useAcademyProgress';
import { getTopic, getLevelRecord } from '../services/academyStore';
import { Empty, MasteryChip, ActionButton } from '../components/AcademyUI';
import { MASTERY_THRESHOLD } from '../data/levels';

export default function CoachAcademyRevision() {
  const p = useAcademyProgress();
  const [showAll, setShowAll] = useState(false);

  const queue = useMemo(() => {
    const all = p.revision || [];
    return showAll ? all : all.slice(0, 6);
  }, [p.revision, showAll]);

  const total = p.revisionCount;

  /* Weakest criterion across the queue — the single most useful coaching hint
     this page can give, because a gap is specific and "study more" is not. */
  const weakest = useMemo(() => {
    const counts = {};
    for (const t of p.revision) {
      const rec = p.state.topics?.[t.topicId];
      for (const [k, v] of Object.entries(rec?.scores || {})) {
        if (v < MASTERY_THRESHOLD) counts[k] = (counts[k] || 0) + 1;
      }
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return entries[0] ? { criterion: entries[0][0], count: entries[0][1] } : null;
  }, [p.revision, p.state.topics]);

  return (
    <Page
      title="Revision"
      piece="⟳"
      sub="Your weakest topics first, ordered by how far each one is from mastery."
    >
      {total === 0 ? (
        <Card title="Nothing to revise" piece="✓">
          <Empty hint="Mastery is 85% on every criterion you have trained.">
            No weak topics on record. Either you are in good shape, or you have not trained much yet — the
            ladder will tell you which.
          </Empty>
          <div className="text-center">
            <Button
              to={`/coach/ai-coach-training/level/${p.level}`}
              variant="primary"
              size="md"
            >
              Continue Level {p.level}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {weakest && (
            <Card title="Most common gap" piece="⚠">
              <p className="text-sm text-ivory-300">
                <span className="font-semibold text-amber-200">{weakest.criterion}</span> is below mastery in{' '}
                {weakest.count} of your {total} weak topic{total === 1 ? '' : 's'}. That is one specific thing to
                work on, not "chess is hard".
              </p>
            </Card>
          )}

          <Card title={`${total} topic${total === 1 ? '' : 's'} to revisit`} piece="⟳">
            {queue.length === 0 ? (
              <Empty>Nothing flagged.</Empty>
            ) : (
              <ul className="space-y-2">
                {queue.map((t) => {
                  const level = getLevelRecord(t.level);
                  return (
                    <li key={t.topicId}>
                      <Link
                        to={`/coach/ai-coach-training/topic/${t.topicId}`}
                        className="block rounded-xl border border-ivory-700/40 bg-black/[0.02] p-3 hover:border-gold-500/50 transition"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-semibold text-ivory-100 flex-1 truncate">{t.name}</span>
                          {level && (
                            <Chip>
                              L{t.level}
                            </Chip>
                          )}
                          <MasteryChip state={t.state} />
                          <span className="text-xs text-ivory-500 w-10 text-right">{t.percent}%</span>
                        </div>
                        <Bar pct={t.percent} />
                        {t.mistakes?.length > 0 && (
                          <p className="text-xs text-ivory-700 mt-1.5">
                    Flagged: {t.mistakes.join(', ')}
                          </p>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {p.revisionCount > 6 && (
              <div className="mt-4">
                <ActionButton variant="ghost" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? 'Show fewer' : `Show all ${p.revisionCount}`}
                </ActionButton>
              </div>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}