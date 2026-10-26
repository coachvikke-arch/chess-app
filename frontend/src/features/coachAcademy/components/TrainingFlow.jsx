/**
 * AI Coach Training Academy — the 16-step training flow.
 *
 * Every topic in the academy is trained through the same 16 steps (see
 * `TRAINING_STEPS` in `data/levels.js`). This component is the one place that
 * knows how a step maps onto a topic's data, so a new topic never needs new UI.
 *
 * Two decisions worth stating:
 *
 *  - A step is never blocked. A coach may jump to any step, because being unable
 *    to reach the coach test because the chat has no answer would make the flow
 *    a gate rather than a structure. Completion is tracked, not enforced.
 *
 *  - Scoring is per-criterion and best-of. Each interactive step reports which
 *    of the six mastery criteria it demonstrated, and the store keeps the best
 *    score seen, so a later weak attempt cannot erase a good demonstration.
 */

import { useEffect, useMemo, useState } from 'react';
import { trainingStepsFor, MASTERY_THRESHOLD } from '../data/levels';
import AcademyBoard from './AcademyBoard';
import CoachChat from './CoachChat';
import CoachTestPanel from './CoachTestPanel';
import PuzzleCreationPanel from './PuzzleCreationPanel';
import StudentSimulator from './StudentSimulator';
import TeachBackPanel from './TeachBackPanel';
import { ActionButton, StepHeading } from './AcademyUI';

/** Text steps render a heading plus body text. Most of the flow is this. */
function TextStep({ n, title, children }) {
  if (!children) return null;
  return (
    <div>
      <StepHeading n={n} title={title} />
      <div className="text-sm text-ivory-300 leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function Bullets({ n, title, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <StepHeading n={n} title={title} />
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m} className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-sm text-ivory-300">
            <span className="text-amber-300 mr-2" aria-hidden="true">
              ▲
            </span>
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TrainingFlow({
  topic,
  topics = [],
  record,
  percent = 0,
  onScore,
  messages,
  onChatSend,
  onChatReset,
  mode = 'learn',
  persona,
}) {
  /* Steps are per level: the short flow is piloted on level 2 only. Derived from
     the topic rather than passed down, so a level's flow can never drift from
     the level that owns the topic. */
  const steps = useMemo(() => trainingStepsFor(topic?.level), [topic?.level]);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(() => new Set());

  /* A different topic restarts the flow. */
  useEffect(() => {
    setIndex(0);
    setDone(new Set());
  }, [topic?.id]);

  const content = topic?.content ?? {};
  const practice = topic?.practice ?? [];

  const practiceProgress = record?.practiceDone ?? 0;
  const testBest = record?.testBest ?? 0;
  const scores = record?.scores ?? {};

  const markDone = (key) => setDone((s) => new Set(s).add(key));

  /* Per-step completion is derived, not stored separately, except for the steps
     the coach explicitly completes by submitting something. */
  const stepComplete = useMemo(() => {
    const map = {};
    steps.forEach((s) => {
      switch (s.key) {
        case 'teachBack':
          map[s.key] = (scores.explanation ?? 0) >= MASTERY_THRESHOLD;
          break;
        case 'coachTest':
          map[s.key] = (scores.recognition ?? 0) >= MASTERY_THRESHOLD || testBest >= MASTERY_THRESHOLD;
          break;
        case 'practice':
          map[s.key] = practiceProgress > 0;
          break;
        case 'puzzleCreation':
          map[s.key] = (scores.demonstration ?? 0) > 0;
          break;
        default:
          map[s.key] = done.has(s.key);
      }
    });
    return map;
  }, [steps, scores, testBest, practiceProgress, done]);

  const completedCount = steps.filter((s) => stepComplete[s.key]).length;

  function score(criterion, value, extra = {}) {
    onScore?.(criterion, value, extra);
  }

  function renderStep() {
    const step = steps[index];
    const n = step.n;

    switch (step.key) {
      case 'concept':
        return <TextStep n={n} title="Concept">{content.definition}</TextStep>;
      case 'deep':
        return <TextStep n={n} title="Deep Explanation">{content.deep}</TextStep>;
      case 'board':
        return (
          <AcademyBoard
            n={n}
            title="Board Demonstration"
            board={topic?.board}
            mode="demo"
            onSolved={() => markDone('board')}
          />
        );
      case 'why':
        return <TextStep n={n} title="Why?">{content.why}</TextStep>;
      case 'when':
        return <TextStep n={n} title="When?">{content.when}</TextStep>;
      case 'whenNot':
        return <TextStep n={n} title="When NOT?">{content.whenNot}</TextStep>;
      case 'mistakes':
        return <Bullets n={n} title="Common Mistakes" items={topic?.mistakes} />;
      case 'coachMethod':
        return <TextStep n={n} title="Coaching Method">{content.coachMethod}</TextStep>;
      case 'coachingExample':
        return (
          <div>
            <StepHeading n={n} title="Coaching Example" />
            <div className="space-y-3">
              <div className="rounded-xl border border-ivory-700/40 bg-black/[0.03] p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-ivory-500 mb-1">Student</p>
                <p className="text-sm text-ivory-200 italic">"{content.example?.student}"</p>
              </div>
              <div className="rounded-xl border border-gold-500/30 bg-gold-500/[0.06] p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-400 mb-1">Coach</p>
                <p className="text-sm text-ivory-100">"{content.example?.coach}"</p>
              </div>
            </div>
          </div>
        );
      case 'teachBack':
        return (
          <TeachBackPanel
            topic={topic}
            previousPercent={scores.explanation}
            onScore={(r) => {
              score('explanation', r.scores.explanation);
              score('teaching ability', r.scores['teaching ability']);
              score('demonstration', r.scores.demonstration);
              markDone('teachBack');
            }}
          />
        );
      case 'aiFeedback':
        return (
          <CoachChat
            stepMode
            n={n}
            title="AI Feedback"
            topic={topic}
            topics={topics}
            level={topic?.level}
            messages={messages}
            onSend={onChatSend}
            onReset={onChatReset}
          />
        );
      case 'practice':
        return practice.length ? (
          <AcademyBoard
            key={practice[0].id}
            n={n}
            title="Practice"
            practice={practice[0]}
            mode="solve"
            onSolved={() => {
              markDone('practice');
              score('analysis', 85);
            }}
            onAttempt={() => markDone('practice')}
          />
        ) : (
          <TextStep n={n} title="Practice">No practice position for this topic.</TextStep>
        );
      case 'puzzleCreation':
        return (
          <PuzzleCreationPanel
            topic={topic}
            onScore={(r) => {
              score('demonstration', r.demonstration);
              score('teaching ability', r['teaching ability']);
              markDone('puzzleCreation');
            }}
          />
        );
      case 'realGame':
        return <TextStep n={n} title="Real Game Application">{content.realGame}</TextStep>;
      case 'coachTest':
        return (
          <CoachTestPanel
            topic={topic}
            previousBest={testBest}
            onResult={(r) => {
              score('recognition', r.recognition);
              score('understanding', r.percent);
              score('explanation', r.explanation);
              markDone('coachTest');
            }}
          />
        );
      case 'mastery':
        return <MasteryStep n={n} scores={scores} record={record} percent={percent} />;
      default:
        return null;
    }
  }

  /* Simulation is a mode, not a numbered step: it replaces the interactive
     middle of the flow when the coach picks "Student Simulation". */
  const showSimulator = mode === 'simulate' && ['teachBack', 'aiFeedback'].includes(steps[index].key);

  return (
    <div className="grid gap-5 lg:grid-cols-[210px,1fr] items-start">
      {/* Step rail */}
      <nav aria-label="Training steps" className="lg:sticky lg:top-4">
        <ol className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0">
          {steps.map((s, i) => {
            const complete = stepComplete[s.key];
            const active = i === index;
            return (
              <li key={s.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={active ? 'step' : undefined}
                  className={`flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition ${
                    active ? 'bg-gold-500/15 text-gold-700 border border-gold-500/40' : 'text-ivory-500 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span
                    className={`w-5 h-5 shrink-0 grid place-items-center rounded-full text-[0.6rem] font-bold ${
                      complete ? 'bg-green-500/20 text-green-300' : active ? 'bg-gold-500 text-ink-900' : 'bg-white/10 text-ivory-500'
                    }`}
                  >
                    {s.n}
                  </span>
                  <span className="hidden lg:inline">{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="hidden lg:block mt-3 text-[0.65rem] text-ivory-700">
          {completedCount}/{steps.length} steps demonstrated
        </p>
      </nav>

      {/* Active step */}
      <div>
        <div className="chess-card">
          {showSimulator ? (
            <StudentSimulator
              topic={topic}
              topics={topics}
              persona={persona}
              stepN={steps[index].n}
              onScore={(r) => {
                score('teaching ability', r['teaching ability']);
                score('demonstration', r.demonstration);
              }}
            />
          ) : (
            renderStep()
          )}
        </div>

        {/* Step navigation */}
        <div className="flex items-center justify-between gap-3 mt-4">
          <ActionButton variant="ghost" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            ← Previous
          </ActionButton>
          <span className="text-xs text-ivory-500">
            Step {index + 1} of {steps.length}
          </span>
          <ActionButton
            onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}
            disabled={index === steps.length - 1}
          >
            Next →
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

/** Step 16: what has actually been demonstrated, and what is still missing. */
function MasteryStep({ n, scores, record, percent }) {
  const CRITERIA = [
    ['understanding', 'Understanding the concept'],
    ['recognition', 'Recognising it in a position'],
    ['analysis', 'Analysing it'],
    ['explanation', 'Explaining it'],
    ['demonstration', 'Demonstrating on the board'],
    ['teaching ability', 'Teaching it to a student'],
  ];
  const overall = percent ?? 0;
  return (
    <div>
      <StepHeading n={n} title="Mastery" />
      <p className="text-sm text-ivory-500 mb-4">
        Mastery is earned from the steps above, not declared. {MASTERY_THRESHOLD}% unlocks the next level.
      </p>
      <div className="flex items-center gap-4 mb-5">
        <div className="text-4xl font-display font-bold text-gold-400">{overall}%</div>
        <div className="flex-1">
          <div className="chess-bar">
            <div className="chess-bar-fill" style={{ width: `${overall}%` }} />
          </div>
        </div>
      </div>
      <ul className="space-y-2">
        {CRITERIA.map(([key, label]) => {
          const v = scores?.[key];
          const has = typeof v === 'number';
          return (
            <li key={key} className="flex items-center gap-3 text-sm">
              <span className={has && v >= MASTERY_THRESHOLD ? 'text-green-300' : has ? 'text-amber-300' : 'text-ivory-700'} aria-hidden="true">
                {has && v >= MASTERY_THRESHOLD ? '✓' : has ? '◐' : '○'}
              </span>
              <span className="flex-1 text-ivory-300">{label}</span>
              <span className="text-xs text-ivory-500">{has ? `${v}%` : 'not demonstrated'}</span>
            </li>
          );
        })}
      </ul>
      {record?.state === 'needs-revision' && (
        <p className="mt-4 text-sm text-red-300">Flagged for revision. Re-run the teach-back to clear it.</p>
      )}
    </div>
  );
}