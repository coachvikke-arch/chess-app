/**
 * AI Coach Training Academy — Teach-Back step (step 10).
 *
 * This is the step that makes the academy a *coach* academy rather than a chess
 * course: the trainer does not read the lesson, they teach it. The engine grades
 * the attempt against the topic's own brief (see `evaluateTeachBack`), and the
 * feedback quotes that brief back — including the concepts that were missed.
 *
 * Grading is deliberately generous about phrasing and strict about substance:
 * re-wording a concept counts, but copying the brief's wording is penalised,
 * because reciting a brief is not the skill being trained.
 */

import { useMemo, useState } from 'react';
import AICoach from '../services/aiCoach';
import { ActionButton, AnswerBox, StepHeading } from './AcademyUI';

const MIN_WORDS = 25;

export default function TeachBackPanel({ n = 10, topic, onScore, previousPercent = null }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);

  const wordCount = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);
  const brief = topic?.teachBack ?? {};

  function submit() {
    const evaluated = AICoach.evaluateTeachBack(text, topic);
    setResult(evaluated);
    /* Only the best attempt counts, matching the store's best-of behaviour. */
    if (!previousPercent || evaluated.percent > previousPercent) {
      onScore?.(evaluated);
    }
  }

  function reset() {
    setText('');
    setResult(null);
  }

  return (
    <div>
      <StepHeading
        n={n}
        title="Teach-Back"
        right={
          <span className="text-xs text-ivory-500">
            {wordCount} word{wordCount === 1 ? '' : 's'}
            {wordCount < MIN_WORDS && ` · ${MIN_WORDS - wordCount} more`}
          </span>
        }
      />

      <div className="rounded-xl border border-gold-500/30 bg-gold-500/[0.06] p-3 mb-4">
        <p className="text-sm font-semibold text-gold-700 mb-1">Your brief</p>
        <p className="text-sm text-ivory-300">{brief.brief}</p>
        {brief.required?.length > 0 && (
          <>
            <p className="text-xs font-semibold text-ivory-500 uppercase tracking-wider mt-3 mb-1">Must cover</p>
            <ul className="text-sm text-ivory-300 list-disc pl-5 space-y-0.5">
              {brief.required.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <AnswerBox
        value={text}
        onChange={setText}
        rows={7}
        placeholder="Teach it as if a student asked you. Cover what it is, why it works, an example, and what they will get wrong."
      />

      <div className="flex flex-wrap gap-2 mt-3">
        <ActionButton onClick={submit} disabled={!text.trim()}>Submit teach-back</ActionButton>
        {(text || result) && (
          <ActionButton variant="ghost" onClick={reset}>
            Clear
          </ActionButton>
        )}
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-ivory-500">Teach-back score</span>
                <span className="font-semibold text-ivory-100">{result.percent}%</span>
              </div>
              <div className="chess-bar">
                <div className="chess-bar-fill" style={{ width: `${result.percent}%` }} />
              </div>
            </div>
          </div>

          {result.strengths.length > 0 && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/[0.08] p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-green-200 mb-1">What worked</p>
              <ul className="text-sm text-ivory-300 list-disc pl-5 space-y-1">
                {result.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {result.improvements.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-200 mb-1">What to fix</p>
              <ul className="text-sm text-ivory-300 list-disc pl-5 space-y-1">
                {result.improvements.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-concept coverage: the concrete reason for the score. */}
          {result.coverage?.length > 0 && (
            <div className="rounded-xl border border-ivory-700/40 bg-black/[0.03] p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ivory-500 mb-2">Brief coverage</p>
              <ul className="space-y-1.5">
                {result.coverage.map((c) => (
                  <li key={c.concept} className="flex items-center gap-2 text-sm">
                    <span className={c.hit ? 'text-green-300' : 'text-red-300'} aria-hidden="true">
                      {c.hit ? '✓' : '✕'}
                    </span>
                    <span className="flex-1 text-ivory-300">{c.concept}</span>
                    <span className="text-xs text-ivory-500">{c.ratio}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-ivory-700">
            Graded locally against this topic's brief. The same attempt always scores the same.
          </p>
        </div>
      )}
    </div>
  );
}