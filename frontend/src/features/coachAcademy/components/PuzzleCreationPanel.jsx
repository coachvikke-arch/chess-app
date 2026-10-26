/**
 * AI Coach Training Academy — Puzzle Creation (step 13).
 *
 * The coach authors an exercise, not just solves one. That is a real skill and
 * it is the one most often skipped in training, so it is scored explicitly.
 *
 * The three authoring requirements below are the curriculum's own (see the
 * Puzzle Authoring topic in Level 10): one specific idea, a unique solution, and
 * a designed difficulty. Each is checked mechanically where it can be — a
 * concrete idea and a real hint are verifiable; "unique solution" cannot be
 * verified without an engine, so the panel says so instead of pretending.
 */

import { useMemo, useState } from 'react';
import AICoach from '../services/aiCoach';
import { ActionButton, AnswerBox, StepHeading } from './AcademyUI';

/** Words that indicate a *specific* idea rather than a generic instruction. */
const GENERIC = /^(create|make|write|give)\s+(a|an)\s+(puzzle|exercise|position|problem)\b/i;

export default function PuzzleCreationPanel({ n = 13, topic, onScore }) {
  const [idea, setIdea] = useState('');
  const [fen, setFen] = useState(topic?.practice?.[0]?.fen ?? '');
  const [solution, setSolution] = useState('');
  const [hint, setHint] = useState('');
  const [checked, setChecked] = useState(false);

  const review = useMemo(() => {
    if (!checked) return null;
    const checks = [];

    /* 1. A specific idea. */
    const specific = idea.trim().length >= 20 && !GENERIC.test(idea.trim());
    checks.push({
      ok: specific,
      label: 'Specific idea',
      note: specific
        ? 'You have named what the puzzle tests, not just that it exists.'
        : 'Name what the puzzle tests in a sentence, e.g. "the defender ignores the pinned piece".',
    });

    /* 2. A loadable position. */
    const pos = AICoach.describePosition(fen);
    checks.push({
      ok: Boolean(pos),
      label: 'Valid position',
      note: pos
        ? `${pos.turn === 'w' ? 'White' : 'Black'} to move, ${pos.legalMoves} legal moves, ${pos.captures} capture(s).`
        : 'That is not a loadable position. Check the FEN.',
    });

    /* 3. A written solution. */
    checks.push({
      ok: solution.trim().length >= 15,
      label: 'Written solution',
      note: solution.trim().length >= 15 ? 'There is a solution to mark against.' : 'Write the intended solution line.',
    });

    /* 4. A hint that does not give the answer away. */
    const solutionTokens = new Set(
      String(solution).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
    );
    const hintTokens = String(hint).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const leaks = hintTokens.filter((w) => solutionTokens.has(w));
    checks.push({
      ok: Boolean(hint.trim()) && leaks.length === 0,
      label: 'Hint that does not spoil',
      note: !hint.trim()
        ? 'No hint written. A hint is part of the exercise.'
        : leaks.length
          ? `The hint repeats the answer: ${[...new Set(leaks)].slice(0, 3).join(', ')}.`
          : 'The hint points without naming the move.',
    });

    const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
    return { checks, score, pos };
  }, [checked, idea, fen, solution, hint]);

  function submit() {
    setChecked(true);
    /* The engine scores the authored statement about the puzzle, which is the
       thing the coach can actually be wrong about. */
    const r = AICoach.evaluateTeachBack(idea || solution, topic);
    onScore?.({
      percent: review?.score ?? r.percent,
      demonstration: review?.score ?? r.percent,
      'teaching ability': r.percent,
    });
  }

  return (
    <div>
      <StepHeading n={n} title="Puzzle Creation" />

      <div className="rounded-xl border border-gold-500/30 bg-gold-500/[0.06] p-3 mb-4">
        <p className="text-sm text-ivory-300">{topic?.puzzlePrompt}</p>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ivory-500">1 · The idea it tests</span>
          <AnswerBox value={idea} onChange={setIdea} rows={2} placeholder="This puzzle tests…" />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ivory-500">2 · Position (FEN)</span>
          <input
            value={fen}
            onChange={(e) => setFen(e.target.value)}
            className="w-full rounded-xl bg-black/[0.06] border border-ivory-700/50 px-3 py-2 text-sm font-mono text-ivory-100 focus:outline-none focus:border-gold-500/70"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ivory-500">3 · Intended solution</span>
          <AnswerBox value={solution} onChange={setSolution} rows={2} placeholder="The move or plan is…" />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ivory-500">4 · Hint</span>
          <AnswerBox value={hint} onChange={setHint} rows={2} placeholder="Ask yourself: which piece can actually move?" />
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <ActionButton onClick={submit}>Review puzzle</ActionButton>
        {review && (
          <span className="self-center text-sm font-semibold text-ivory-100">Authoring score {review.score}%</span>
        )}
      </div>

      {review && (
        <ul className="mt-4 space-y-2">
          {review.checks.map((c) => (
            <li
              key={c.label}
              className={`rounded-xl border p-3 ${
                c.ok ? 'border-green-500/30 bg-green-500/[0.08]' : 'border-amber-500/30 bg-amber-500/[0.08]'
              }`}
            >
              <p className={`text-sm font-semibold ${c.ok ? 'text-green-200' : 'text-amber-200'}`}>
                {c.ok ? '✓' : '✕'} {c.label}
              </p>
              <p className="text-sm text-ivory-300 mt-0.5">{c.note}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ivory-700 mt-3">
        Uniqueness of the solution cannot be verified without an engine, so verify it manually before
        publishing to students.
      </p>
    </div>
  );
}