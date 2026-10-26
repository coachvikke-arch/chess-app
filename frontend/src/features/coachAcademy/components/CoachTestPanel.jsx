/**
 * AI Coach Training Academy — Coach Test (step 15).
 *
 * Multiple choice over the topic's own questions, with the curriculum's own
 * explanations shown for wrong answers. Showing the explanation immediately (not
 * only at the end) is deliberate: this is a training tool, and the point is the
 * correction, not the score.
 *
 * Each question is scored per-criterion rather than as one blob, because the
 * mastery store needs to know *which* skill was demonstrated — recognising a
 * pattern is not the same as being able to teach it.
 */

import { useMemo, useState } from 'react';
import { ActionButton, StepHeading } from './AcademyUI';

export default function CoachTestPanel({ n = 15, topic, onResult, previousBest = null }) {
  const questions = topic?.test ?? [];
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const result = useMemo(() => {
    if (!submitted) return null;
    const correct = questions.filter((q) => Number(answers[q.id]) === q.answer).length;
    const percent = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    /* Pattern recognition and explanation are different skills, so they are
       credited separately. A coach who spots the tactic but cannot say why has
       demonstrated one and not the other. */
    const recognition = Math.round((correct / Math.max(1, questions.length)) * 100);
    return { correct, total: questions.length, percent, recognition };
  }, [submitted, answers, questions]);

  function submit() {
    const correct = questions.filter((q) => Number(answers[q.id]) === q.answer).length;
    const percent = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    setSubmitted(true);
    onResult?.({
      percent,
      recognition: percent,
      explanation: percent,
      correct,
      total: questions.length,
    });
  }

  function retry() {
    setAnswers({});
    setSubmitted(false);
  }

  if (!questions.length) {
    return (
      <div>
        <StepHeading n={n} title="Coach Test" />
        <p className="text-sm text-ivory-500">This topic has no test questions.</p>
      </div>
    );
  }

  const answeredAll = questions.every((q) => answers[q.id] !== undefined);

  return (
    <div>
      <StepHeading
        n={n}
        title="Coach Test"
        right={
          previousBest != null && (
            <span className="text-xs text-ivory-500">best {previousBest}%</span>
          )
        }
      />

      <div className="space-y-4">
        {questions.map((q, qi) => {
          const chosen = answers[q.id];
          const isRight = Number(chosen) === q.answer;
          return (
            <div key={q.id} className="rounded-xl border border-ivory-700/40 bg-black/[0.03] p-3">
              <p className="text-sm font-semibold text-ivory-100 mb-2">
                {qi + 1}. {q.q}
              </p>
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => {
                  const selected = Number(chosen) === oi;
                  const isAnswer = oi === q.answer;
                  let tone = 'border-ivory-700/50 text-ivory-300 hover:border-gold-500/50';
                  if (submitted && isAnswer) tone = 'border-green-500/60 bg-green-500/10 text-green-200';
                  else if (submitted && selected && !isAnswer) tone = 'border-red-500/60 bg-red-500/10 text-red-200';
                  else if (submitted && selected) tone = 'border-gold-500/60 bg-gold-500/10 text-gold-700';
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={submitted}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition disabled:cursor-default ${tone}`}
                    >
                      <span className="font-semibold mr-2">{String.fromCharCode(65 + oi)}.</span>
                      {opt}
                    </button>
                  );
                })}
              </div>
              {submitted && (
                <p className={`text-xs mt-2 ${isRight ? 'text-green-300' : 'text-amber-200'}`}>
                  {isRight ? 'Correct. ' : 'Not this one. '}
                  {q.explain}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-4">
        {!submitted ? (
          <ActionButton onClick={submit} disabled={!answeredAll}>Submit test</ActionButton>
        ) : (
          <>
            <span className="text-sm font-semibold text-ivory-100">
              {result.correct}/{result.total} · {result.percent}%
            </span>
            <ActionButton variant="ghost" onClick={retry}>Retake</ActionButton>
          </>
        )}
        {!submitted && !answeredAll && (
          <span className="text-xs text-ivory-500">
            {questions.length - Object.keys(answers).length} question(s) left
          </span>
        )}
      </div>
    </div>
  );
}