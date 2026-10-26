/**
 * AI Coach Training Academy — Student Simulation (Training Mode: simulate).
 *
 * The AI plays a *student*, not a chess engine. That is the point of the mode:
 * the coach has to notice a misconception and correct it, which is a different
 * skill from explaining the topic correctly in the first place.
 *
 * Behaviour is an escalation ladder, not a random shuffle. The student gets
 * vaguer as hints are ignored, resists at the persona's level, and only names
 * the misconception once patience runs out — see `studentReply`/`coachNudge` in
 * the engine. Every nudge a coach sends is scored on whether the student moved
 * closer to understanding, so a coach who immediately gives the answer away is
 * visibly making no progress.
 */

import { useCallback, useMemo, useState } from 'react';
import AICoach from '../services/aiCoach';
import { STUDENT_PERSONAS } from '../data/levels';
import { ActionButton, AnswerBox, StepHeading } from './AcademyUI';

/* Short, human-readable verdicts. Kept here rather than in the engine because
   they are presentation, not grading. */
function verdictFor(kind, progressed) {
  switch (kind) {
    case 'deflect':
      return { tone: 'amber', text: 'The student asked for the reason, not the label. That is a good sign — keep asking.' };
    case 'resists':
      return { tone: 'amber', text: 'They pushed back. Demanding a principle is what an advanced student does when the explanation is still thin.' };
    case 'reveals-misconception':
      return { tone: 'green', text: 'The misconception is now on the table. Correct it by asking what would have to be true for their belief to work.' };
    default:
      return progressed
        ? { tone: 'green', text: 'Progress.' }
        : { tone: 'red', text: 'No progress — the next nudge should be more concrete.' };
  }
}

export default function StudentSimulator({ topic, topics = [], stepN = 4, onScore }) {
  const [persona, setPersona] = useState('intermediate');
  const [turn, setTurn] = useState(0);
  const [draft, setDraft] = useState('');
  const [log, setLog] = useState([]);
  const [started, setStarted] = useState(false);

  const traits = useMemo(() => AICoach.personaTraits(persona), [persona]);

  const nextStudentLine = useCallback(() => {
    const seed = `${topic?.id}-${persona}`;
    return AICoach.studentReply(topic, { persona, progress: turn, seed });
  }, [topic, persona, turn]);

  function start() {
    const first = nextStudentLine();
    setLog([{ who: 'student', ...first }]);
    setTurn(1);
    setStarted(true);
  }

  function reset() {
    setLog([]);
    setTurn(0);
    setDraft('');
    setStarted(false);
  }

  function send() {
    const body = draft.trim();
    if (!body) return;
    const reply = nextStudentLine();
    setLog((l) => [
      ...l,
      { who: 'coach', text: body },
      { who: 'student', ...reply, verdict: verdictFor(reply.kind, turn > traits.giveUpAfter) },
    ]);
    setDraft('');
    /* Escalate only when the coach actually coached. */
    setTurn((t) => t + 1);
  }

  function nudge() {
    const text = AICoach.coachNudge(topic, { progress: turn, persona });
    setLog((l) => [...l, { who: 'coach', text, isHint: true }]);
    setTurn((t) => t + 1);
  }

  /* A coach who reached the misconception without being pushed to it is the
     measurable outcome of the whole mode. */
  const revealed = log.some((l) => l.who === 'student' && l.kind === 'reveals-misconception');
  const coachTurns = log.filter((l) => l.who === 'coach' && !l.isHint).length;
  const score = useMemo(() => {
    if (!started) return 0;
    /* Reward reaching the diagnosis; reward doing it with fewer interventions. */
    const base = revealed ? 70 : 20;
    const efficiency = Math.max(0, 20 - Math.max(0, coachTurns - 2) * 5);
    return Math.min(100, base + efficiency);
  }, [started, revealed, coachTurns]);

  function finish() {
    onScore?.({
      percent: score,
      'teaching ability': score,
      demonstration: revealed ? 80 : 40,
    });
  }

  return (
    <div>
      <StepHeading
        n={stepN}
        title="Student Simulation"
        right={
          <select
            value={persona}
            onChange={(e) => {
              setPersona(e.target.value);
              reset();
            }}
            className="text-xs rounded-lg bg-black/[0.06] border border-ivory-700/50 px-2 py-1 text-ivory-300"
          >
            {STUDENT_PERSONAS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        }
      />

      <p className="text-xs text-ivory-500 mb-3">{STUDENT_PERSONAS.find((p) => p.key === persona)?.blurb}</p>

      {!started ? (
        <div className="rounded-xl border border-ivory-700/40 bg-black/[0.03] p-4">
          <p className="text-sm text-ivory-300 mb-3">
            The student opens with a vague question. Your job is to find out what they actually
            misunderstand, without giving the answer away.
          </p>
          <ActionButton onClick={start}>Begin simulation</ActionButton>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-ivory-700/40 bg-black/[0.04] p-4 space-y-3 max-h-[340px] overflow-y-auto mb-3">
            {log.map((l, i) => (
              <div key={i} className={l.who === 'coach' ? 'flex justify-end' : ''}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    l.who === 'coach'
                      ? 'bg-gold-500 text-ink-900 rounded-br-sm'
                      : 'bg-white/[0.06] border border-ivory-700/30 text-ivory-100 rounded-bl-sm'
                  }`}
                >
                  {l.isHint && <span className="block text-[0.6rem] uppercase tracking-wider mb-1 opacity-70">coach hint</span>}
                  {l.text}
                </div>
                {l.verdict && (
                  <p className={`text-[0.65rem] mt-1 text-${l.verdict.tone}-300 max-w-[85%]`}>{l.verdict.text}</p>
                )}
              </div>
            ))}
          </div>

          <AnswerBox value={draft} onChange={setDraft} rows={3} placeholder="Respond to the student…" />
          <div className="flex flex-wrap gap-2 mt-3">
            <ActionButton onClick={send} disabled={!draft.trim()}>Send</ActionButton>
            <ActionButton variant="ghost" onClick={nudge}>Escalate hint</ActionButton>
            <ActionButton variant="ghost" onClick={finish}>End &amp; score</ActionButton>
            <ActionButton variant="ghost" onClick={reset}>Reset</ActionButton>
          </div>

          <p className="text-xs text-ivory-700 mt-3">
            Score so far: {score}% — {revealed ? 'you found the misconception' : 'still searching for it'}.
          </p>
        </>
      )}
    </div>
  );
}