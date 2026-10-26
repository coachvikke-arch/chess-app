/**
 * AI Coach Training Academy — level final exam.
 *
 * This is the only thing in the product that unlocks anything, so it is built to
 * be defensible rather than pleasant:
 *
 *  - The paper is assembled from the level's own topics (`buildFinalExam`), so a
 *    coach cannot pass a level they never studied, and the exam changes if the
 *    curriculum does.
 *
 *  - Position questions are graded on whether the coach named the *plan* — the
 *    curriculum stores solutions as prose, so grading one "correct move" would
 *    reward a guess and punish a better explanation.
 *
 *  - Results are shown section by section. A single total hides whether a coach
 *    failed on chess or on teaching, and those need different work.
 */

import { useMemo, useState } from 'react';
import AICoach from '../services/aiCoach';
import { ASSESSMENT_SECTIONS } from '../data/levels';
import { ActionButton, AnswerBox, StepHeading } from './AcademyUI';

const SECTION_LABEL = Object.fromEntries(ASSESSMENT_SECTIONS.map((s) => [s.key, s.label]));

export default function ExamRunner({ level, topics, exam, onFinish }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);

  const sectionGroups = useMemo(() => {
    const groups = new Map();
    for (const item of exam.items) {
      if (!groups.has(item.section)) groups.set(item.section, []);
      groups.get(item.section).push(item);
    }
    return [...groups.entries()].map(([key, items]) => ({ key, items }));
  }, [exam]);

  const answeredAll = exam.items.every((i) => {
    const a = answers[i.id];
    return i.kind === 'question' ? a !== undefined : String(a ?? '').trim().length > 0;
  });

  function submit() {
    const graded = AICoach.gradeExam(exam, answers);
    setResult(graded);
    setSubmitted(true);
    onFinish?.(graded);
  }

  function retake() {
    setAnswers({});
    setSubmitted(false);
    setResult(null);
  }

  if (submitted && result) {
    return (
      <div>
        <StepHeading n={16} title={`${exam.title} — result`} />
        <div className="text-center py-4">
          <div className={`text-5xl font-display font-bold ${result.passed ? 'text-green-400' : 'text-amber-300'}`}>
            {result.overall}%
          </div>
          <p className="text-sm mt-2 text-ivory-300">
            {result.passed
              ? `Passed — Level ${level?.n} complete and Level ${(level?.n ?? 0) + 1} unlocked.`
              : `Below the ${result.passMark}% pass mark. The sections below show where to revise.`}
          </p>
        </div>

        <div className="space-y-2 mb-5">
          {result.sections.map((s) => (
            <div key={s.section} className="flex items-center gap-3">
              <span className="text-sm text-ivory-300 w-40 shrink-0">{SECTION_LABEL[s.section] ?? s.section}</span>
              <div className="flex-1">
                <div className="chess-bar">
                  <div
                    className="chess-bar-fill"
                    style={{ width: `${s.percent}%`, background: s.percent >= result.passMark ? undefined : 'var(--amber-500, #f59e0b)' }}
                  />
                </div>
              </div>
              <span className="text-xs text-ivory-500 w-10 text-right">{s.percent}%</span>
            </div>
          ))}
        </div>

        {/* Show the curriculum's own explanation for anything missed. */}
        <div className="space-y-3">
          {result.scored
            .filter((s) => s.percent < 100)
            .slice(0, 12)
            .map(({ item, detail }) => (
              <div key={item.id} className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-200 mb-1">
                  {SECTION_LABEL[item.section] ?? item.section} · {item.topicName}
                </p>
                {item.kind === 'question' ? (
                  <>
                    <p className="text-sm text-ivory-100 mb-1">{item.q}</p>
                    <p className="text-sm text-green-300">Correct: {item.options[item.answer]}</p>
                    <p className="text-xs text-ivory-500 mt-1">{item.explain}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-ivory-100 mb-1">{item.prompt}</p>
                    <p className="text-sm text-ivory-300">{item.solution}</p>
                    {detail?.missing?.length > 0 && (
                      <p className="text-xs text-ivory-500 mt-1">
                        Key ideas not named: {detail.missing.slice(0, 8).join(', ')}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
        </div>

        <div className="flex gap-2 mt-5">
          <ActionButton onClick={retake}>Retake exam</ActionButton>
          <ActionButton
            variant="ghost"
            onClick={() => onFinish?.(null, { close: true })}
          >
            Close
          </ActionButton>
        </div>
      </div>
    );
  }

  let cursor = 0;
  return (
    <div>
      <StepHeading
        n={16}
        title={exam.title}
        right={<span className="text-xs text-ivory-500">pass mark {exam.passMark}%</span>}
      />

      <div className="space-y-6">
        {sectionGroups.map(({ key, items }) => (
          <section key={key}>
            <h4 className="text-sm font-display font-bold text-gold-600 mb-2">
              {SECTION_LABEL[key] ?? key}
              <span className="text-xs font-normal text-ivory-500 ml-2">{items.length} question(s)</span>
            </h4>
            <div className="space-y-3">
              {items.map((item) => {
                cursor += 1;
                const idx = cursor;
                return item.kind === 'question' ? (
                  <div key={item.id} className="rounded-xl border border-ivory-700/40 bg-black/[0.03] p-3">
                    <p className="text-sm font-semibold text-ivory-100 mb-2">
                      {idx}. {item.q}
                    </p>
                    <div className="space-y-1.5">
                      {item.options.map((opt, oi) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setAnswers((a) => ({ ...a, [item.id]: oi }))}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition ${
                            Number(answers[item.id]) === oi
                              ? 'border-gold-500/60 bg-gold-500/10 text-gold-700'
                              : 'border-ivory-700/50 text-ivory-300 hover:border-gold-500/40'
                          }`}
                        >
                          <span className="font-semibold mr-2">{String.fromCharCode(65 + oi)}.</span>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div key={item.id} className="rounded-xl border border-ivory-700/40 bg-black/[0.03] p-3">
                    <p className="text-xs text-ivory-500 mb-1">{item.topicName}</p>
                    <p className="text-sm font-semibold text-ivory-100 mb-2">{item.prompt}</p>
                    <AnswerBox
                      value={answers[item.id] ?? ''}
                      onChange={(v) => setAnswers((a) => ({ ...a, [item.id]: v }))}
                      rows={3}
                      placeholder="Give the plan and the reason — not just a move."
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <ActionButton onClick={submit} disabled={!answeredAll}>Submit exam</ActionButton>
        <span className="text-xs text-ivory-500">
          {exam.items.length - Object.keys(answers).length} unanswered
        </span>
      </div>
    </div>
  );
}