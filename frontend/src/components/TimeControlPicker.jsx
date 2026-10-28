import {
  HOUR_OPTIONS,
  INCREMENT_OPTIONS,
  MINUTE_OPTIONS,
  TIME_CONTROL_PRESETS,
  describeTimeControl,
  formatTimeControl,
  timeControlFamily,
} from '../utils/timeControl';

/**
 * Time control for the Play Arena: preset chips plus three dropdowns.
 *
 * The dropdowns use the same `.chess-input` selects and option lists as the
 * Computer Play panel, so both screens pick the same clocks the same way.
 * `value` stays the shared `{ hours, base, inc }` shape, and every choice is a
 * plain number — nothing is ever parsed back out of a combined label.
 */
export default function TimeControlPicker({ value, onChange, disabled = false }) {
  const { hours = 0, base = 0, inc = 0 } = value || {};
  const set = (patch) => onChange?.({ hours, base, inc, ...patch });
  const isPreset = (p) => p.hours === hours && p.base === base && p.inc === inc;

  return (
    <div className="tc-picker">
      <div className="tc-readout" role="status" aria-live="polite">
        <span className="tc-readout-family">{timeControlFamily({ hours, base, inc })}</span>
        <span className="tc-readout-value">{formatTimeControl({ hours, base, inc })}</span>
        <span className="tc-readout-meta">{describeTimeControl({ hours, base, inc })}</span>
      </div>

      <div className="tc-presets" role="group" aria-label="Time control presets">
        {TIME_CONTROL_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={disabled}
            className={`chess-chip tc-opt${isPreset(p) ? ' chess-chip-gold' : ''}`}
            aria-pressed={isPreset(p)}
            onClick={() => set({ hours: p.hours, base: p.base, inc: p.inc })}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="tc-fields">
        <label className="tc-field">
          <span className="tc-field-label">Hours</span>
          <select
            className="chess-input !text-xs !py-1.5"
            value={hours}
            disabled={disabled}
            onChange={(e) => set({ hours: Number(e.target.value) })}
            aria-label="Time control hours"
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>{h}h</option>
            ))}
          </select>
        </label>

        <label className="tc-field">
          <span className="tc-field-label">Minutes</span>
          <select
            className="chess-input !text-xs !py-1.5"
            value={base}
            disabled={disabled}
            onChange={(e) => set({ base: Number(e.target.value) })}
            aria-label="Time control minutes"
          >
            {MINUTE_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}m</option>
            ))}
          </select>
        </label>

        <label className="tc-field">
          <span className="tc-field-label">Increment</span>
          <select
            className="chess-input !text-xs !py-1.5"
            value={inc}
            disabled={disabled}
            onChange={(e) => set({ inc: Number(e.target.value) })}
            aria-label="Time control increment in seconds"
          >
            {INCREMENT_OPTIONS.map((s) => (
              <option key={s} value={s}>+{s}s</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
