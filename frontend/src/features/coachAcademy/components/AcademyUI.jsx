/**
 * AI Coach Training Academy — shared presentational atoms.
 *
 * Small, dumb components used by every academy page. They exist so the pages
 * stay about coaching logic instead of repeating class strings, and so the
 * visual language (which comes from the app's own `chess-*` CSS) stays
 * consistent across eight pages without a shared stylesheet.
 */

import { Link } from 'react-router-dom';
import { Bar, Chip } from '../../../components/ui';
import { MASTERY_STATES } from '../data/levels';

/** Mastery state -> chip tone. Unmastered states read as actionable, not failed. */
export const STATE_TONE = {
  'not-started': '',
  learning: 'amber',
  practicing: 'amber',
  tested: 'gold',
  mastered: 'green',
  'needs-revision': 'red',
};

export const STATE_LABEL = {
  'not-started': 'Not started',
  learning: 'Learning',
  practicing: 'Practicing',
  tested: 'Tested',
  mastered: 'Mastered',
  'needs-revision': 'Needs revision',
};

export function MasteryChip({ state }) {
  if (!MASTERY_STATES.includes(state)) return null;
  return <Chip tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Chip>;
}

/** Progress bar + label, used on level cards and the topic header. */
export function ProgressRow({ percent, label, hint }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-ivory-500">{label}</span>
        <span className="font-semibold text-ivory-100">{hint ?? `${pct}%`}</span>
      </div>
      <Bar pct={pct} />
    </div>
  );
}

/** A labelled number, used in headers where the full Stat card is too heavy. */
export function MiniStat({ label, value, tone = '' }) {
  return (
    <div className="text-center px-3 py-2 rounded-xl bg-black/[0.04] border border-ivory-700/30">
      <p className={`text-lg font-display font-bold ${tone || 'text-ivory-100'}`}>{value}</p>
      <p className="text-[0.6rem] uppercase tracking-wider text-ivory-500">{label}</p>
    </div>
  );
}

/** Locked-level explanation. Always says what to do, never just "locked". */
export function LockNotice({ reason, levelN }) {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
      <p className="font-display font-bold text-amber-200 mb-1">Level {levelN} is locked</p>
      <p className="text-sm text-ivory-500">{reason}</p>
      <Link
        to={`/coach/ai-coach-training/level/${Math.max(1, levelN - 1)}`}
        className="inline-block mt-3 text-sm font-semibold text-gold-400 hover:text-gold-600 transition"
      >
        Go to Level {Math.max(1, levelN - 1)} →
      </Link>
    </div>
  );
}

/** Empty state, so no panel ever renders as a blank box. */
export function Empty({ children, hint }) {
  return (
    <div className="text-center py-8 px-4">
      <p className="text-ivory-500 text-sm">{children}</p>
      {hint && <p className="text-ivory-700 text-xs mt-1">{hint}</p>}
    </div>
  );
}

/**
 * Section heading used inside a step. Mirrors `chess-card-title` but at a
 * smaller scale, because a step already sits inside a card.
 */
export function StepHeading({ n, title, right }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="chess-stat-icon !text-base" aria-hidden="true">
        {n}
      </span>
      <h3 className="text-base font-display font-bold text-ivory-100 flex-1">{title}</h3>
      {right}
    </div>
  );
}

import Button from '../../../components/Button';

/** Primary/secondary buttons matching the app's existing button idiom. */
export function ActionButton({ children, onClick, variant = 'primary', disabled, className = '', type = 'button', title }) {
  return (
    <Button
      type={type}
      title={title}
      onClick={onClick}
      variant={variant}
      size="md"
      disabled={disabled}
      className={className}
    >
      {children}
    </Button>
  );
}

/** Yes/no control used by the self-check and coach-test steps. */
export function Toggle({ value, onChange, yes = 'Yes', no = 'No' }) {
  const opts = [
    { v: true, label: yes },
    { v: false, label: no },
  ];
  return (
    <div className="inline-flex rounded-xl overflow-hidden border border-ivory-700/60">
      {opts.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`px-3 py-1.5 text-sm font-semibold transition ${
            value === o.v ? 'bg-gold-500 text-ink-900' : 'text-ivory-500 hover:bg-white/5'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Read-only text area used for coach-authored answers before scoring. */
export function AnswerBox({ value, onChange, placeholder, rows = 6, disabled }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className="w-full rounded-xl bg-black/[0.06] border border-ivory-700/50 px-3 py-2 text-sm text-ivory-100 placeholder:text-ivory-700 focus:outline-none focus:border-gold-500/70 disabled:opacity-60"
    />
  );
}