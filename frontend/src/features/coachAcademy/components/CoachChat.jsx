/**
 * AI Coach Training Academy — AI Coach chat (steps 11 and the general panel).
 *
 * The engine is deterministic and curriculum-grounded, so the UI is explicit
 * about both: every reply shows which topic it came from and that it was
 * produced locally. Presenting this as a general-purpose model would be a lie,
 * and a coach would then trust invented content.
 */

import { useEffect, useRef, useState } from 'react';
import AICoach from '../services/aiCoach';
import { ActionButton, StepHeading } from './AcademyUI';

const STARTERS = [
  'Explain this in one paragraph',
  'How do I teach it?',
  'What mistakes do students make?',
  'Show me on the board',
  'Give me the teach-back brief',
];

export default function CoachChat({
  n,
  title = 'AI Feedback',
  topic = null,
  topics = [],
  level = null,
  messages = [],
  onSend,
  onReset,
  stepMode = false,
  readOnly = false,
}) {
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  function send(text) {
    const body = String(text ?? draft).trim();
    if (!body || readOnly) return;
    setDraft('');
    onSend?.(body, { role: 'user' });

    /* The engine answers synchronously and deterministically, so the reply is
       produced immediately rather than faked with a typing delay. */
    const reply = AICoach.respond(body, { topic, topics, level });
    onSend?.(reply.text, { role: 'coach', groundedIn: reply.groundedIn, intent: reply.intent });
  }

  return (
    <div>
      {stepMode && <StepHeading n={n} title={title} />}

      <div className="rounded-2xl border border-ivory-700/40 bg-black/[0.04] flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-ivory-700/30 flex items-center justify-between gap-2">
          <p className="text-sm font-display font-bold text-ivory-100">AI Coach</p>
          <span className="text-[0.6rem] uppercase tracking-wider text-ivory-500">
            local engine · curriculum-grounded
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[180px] max-h-[420px]">
          {messages.length === 0 && (
            <div className="text-center py-6">
              <p className="text-sm text-ivory-500">
                Ask about this topic. Answers come from the training material itself, so nothing is invented.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-gold-500 text-ink-900 rounded-br-sm'
                    : 'bg-white/[0.06] text-ivory-100 rounded-bl-sm border border-ivory-700/30'
                }`}
              >
                {m.text}
              </div>
              {m.groundedIn?.length > 0 && (
                <p className="text-[0.6rem] text-ivory-700 mt-1 text-right">
                  from {m.groundedIn.map((g) => g.name).join(', ')}
                </p>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {messages.length === 0 && !readOnly && (
          <div className="px-3 pb-2 flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="text-xs px-2.5 py-1 rounded-full border border-ivory-700/50 text-ivory-500 hover:text-ivory-100 hover:border-gold-500/50 transition"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {!readOnly && (
          <div className="px-3 py-2.5 border-t border-ivory-700/30 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask the AI Coach…"
              className="flex-1 rounded-xl bg-black/[0.06] border border-ivory-700/50 px-3 py-2 text-sm text-ivory-100 placeholder:text-ivory-700 focus:outline-none focus:border-gold-500/70"
            />
            <ActionButton onClick={() => send()} disabled={!draft.trim()}>Ask</ActionButton>
            {onReset && messages.length > 0 && (
              <ActionButton variant="ghost" onClick={onReset}>Clear</ActionButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}