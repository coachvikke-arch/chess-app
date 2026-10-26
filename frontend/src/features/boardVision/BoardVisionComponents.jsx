import { useState } from 'react';
import { Card, Chip, Bar } from '../../components/ui';
import Button from '../../components/Button';
import {
  DEFAULT_SETTINGS,
  DURATIONS,
  LEVELS,
  MODES,
  levelUnlockStatus,
  modeById,
  progressToNextLevel,
} from './boardVisionLogic';
import './boardVision.css';

/* ── TrainingModeCard ─────────────────────────────────────────────── */
export function TrainingModeCard({ mode, selected, bestAccuracy, onSelect }) {
  return (
    <button
      type="button"
      className={`bv-mode-card${selected ? ' bv-selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect?.(mode.id)}
    >
      <span className="bv-mode-top">
        <span className="bv-mode-icon" aria-hidden="true">{mode.icon}</span>
        <span className="bv-mode-name">{mode.name}</span>
        {selected && <span className="bv-check" aria-label="Selected">✓ Selected</span>}
      </span>
      <span className="bv-mode-desc">{mode.description}</span>
      <span className="bv-mode-top" style={{ marginTop: '0.4rem' }}>
        <DifficultyDots level={mode.difficulty} />
        {bestAccuracy != null && <span className="bv-mode-desc">Best: {bestAccuracy}%</span>}
      </span>
    </button>
  );
}

export function DifficultyDots({ level }) {
  return (
    <span className="bv-diff" role="img" aria-label={`Difficulty ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= level ? 'on' : ''} />)}
    </span>
  );
}

/* ── LevelSelector ────────────────────────────────────────────────── */
export function LevelSelector({ levelsProgress, selectedLevel, freePractice, onSelect }) {
  return (
    <div className="bv-levels" role="listbox" aria-label="Training levels">
      {LEVELS.map((lv, idx) => {
        const status = levelUnlockStatus(levelsProgress, idx, freePractice);
        const p = levelsProgress?.[lv.id];
        return (
          <button
            key={lv.id}
            type="button"
            role="option"
            aria-selected={selectedLevel === lv.id}
            disabled={status.locked}
            title={status.locked ? status.reason : lv.description}
            className={`bv-level${selectedLevel === lv.id ? ' bv-selected' : ''}${status.locked ? ' bv-locked' : ''}`}
            onClick={() => onSelect?.(lv.id)}
          >
            <div className="bv-level-icon" aria-hidden="true">{status.locked ? '🔒' : lv.icon}</div>
            <div className="bv-level-name">{idx + 1}. {lv.name}</div>
            <div className="bv-level-desc">{status.locked ? status.reason : lv.description}</div>
            <div className="bv-bar" aria-hidden="true"><div style={{ width: `${progressToNextLevel(p)}%` }} /></div>
            <div className="bv-level-meta">
              <span>Progress to next: {progressToNextLevel(p)}%</span>
              <span>Best accuracy: {p?.bestAccuracy ?? '—'}{p?.bestAccuracy != null ? '%' : ''}</span>
              <span>Challenges: {p?.completedChallenges ?? 0}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ── TrainingSettings (every control really works) ────────────────── */
export function TrainingSettings({ value, onChange, modeId, onStart, startDisabled, startNote }) {
  const v = { ...DEFAULT_SETTINGS, ...(value || {}) };
  const set = (patch) => onChange?.({ ...v, ...patch });
  const showPiecesCompatible = modeId !== 'square-color' && modeId !== 'coordinate-recognition' && modeId !== 'blindfold';
  return (
    <Card title="Training Settings" piece="⚙">
      <div className="bv-settings-grid">
        <div>
          <p className="bv-setting-label" id="bv-dur">Duration</p>
          <div className="bv-seg" role="group" aria-labelledby="bv-dur">
            {DURATIONS.map((d) => (
              <SegBtn key={d} pressed={v.duration === d} onClick={() => set({ duration: d })}>{d}s</SegBtn>
            ))}
            <CustomDuration value={v.duration} onPick={(duration) => set({ duration })} />
          </div>
        </div>
        <div>
          <p className="bv-setting-label" id="bv-ori">Board orientation</p>
          <div className="bv-seg" role="group" aria-labelledby="bv-ori">
            <SegBtn pressed={v.orientation === 'white'} onClick={() => set({ orientation: 'white' })}>White bottom</SegBtn>
            <SegBtn pressed={v.orientation === 'black'} onClick={() => set({ orientation: 'black' })}>Black bottom</SegBtn>
            <SegBtn pressed={v.orientation === 'random'} onClick={() => set({ orientation: 'random' })}>Random</SegBtn>
          </div>
        </div>
        <div>
          <p className="bv-setting-label" id="bv-target">Challenge target</p>
          <div className="bv-seg" role="group" aria-labelledby="bv-target">
            <SegBtn pressed={v.target?.kind === 'count' && v.target?.count === 5} onClick={() => set({ target: { kind: 'count', count: 5 } })}>5 correct</SegBtn>
            <SegBtn pressed={v.target?.kind === 'count' && v.target?.count === 10} onClick={() => set({ target: { kind: 'count', count: 10 } })}>10 correct</SegBtn>
            <SegBtn pressed={v.target?.kind === 'accuracy'} onClick={() => set({ target: { kind: 'accuracy', pct: 80 } })}>80% accuracy</SegBtn>
            <SegBtn pressed={v.target?.kind === 'personal-best'} onClick={() => set({ target: { kind: 'personal-best' } })}>Beat my best</SegBtn>
          </div>
        </div>
        <div>
          <p className="bv-setting-label">Display &amp; feedback</p>
          <Toggle label="Show coordinates" checked={v.showCoordinates} onToggle={() => set({ showCoordinates: !v.showCoordinates })} />
          <Toggle label={showPiecesCompatible ? 'Show pieces' : 'Show pieces (not used by this mode)'} checked={showPiecesCompatible ? v.showPieces : false} onToggle={() => showPiecesCompatible && set({ showPieces: !v.showPieces })} />
          <Toggle label="Sound" checked={v.sound} onToggle={() => set({ sound: !v.sound })} />
          <Toggle label="Haptics (supported devices)" checked={v.haptics} onToggle={() => set({ haptics: !v.haptics })} />
          <Toggle label="Highlight selected square" checked={v.highlightSelected} onToggle={() => set({ highlightSelected: !v.highlightSelected })} />
          <Toggle label="High-contrast board" checked={v.highContrast} onToggle={() => set({ highContrast: !v.highContrast })} />
        </div>
      </div>
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Button type="button" variant="primary" size="md" disabled={startDisabled} onClick={onStart}>
          Start Training — {modeById(modeId).name}
        </Button>
        {startNote && <span className="bv-head-sub" role="note">{startNote}</span>}
      </div>
    </Card>
  );
}

function SegBtn({ pressed, onClick, children }) {
  return (
    <button type="button" className="bv-seg-btn" aria-pressed={pressed} onClick={onClick}>{children}</button>
  );
}

function CustomDuration({ value, onPick }) {
  const isCustom = !DURATIONS.includes(value);
  const [open, setOpen] = useState(isCustom);
  if (!open && !isCustom) {
    return <button type="button" className="bv-seg-btn" onClick={() => setOpen(true)}>Custom…</button>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
      <label className="bv-head-sub" htmlFor="bv-custom-dur">Custom (s)</label>
      <input
        id="bv-custom-dur"
        type="number"
        min={5}
        max={300}
        value={value}
        onChange={(e) => {
          const n = Math.max(5, Math.min(300, Number(e.target.value) || 20));
          onPick(n);
        }}
        style={{ width: '4.5rem', borderRadius: '0.6rem', border: '2px solid var(--hairline)', padding: '0.3rem 0.5rem', background: 'var(--surface-strong)', color: 'var(--ivory-100)', fontWeight: 700 }}
      />
    </span>
  );
}

function Toggle({ label, checked, onToggle }) {
  return (
    <div className="bv-toggle-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="bv-switch" onClick={onToggle} />
    </div>
  );
}

/* ── TrainingStats (live) ─────────────────────────────────────────── */
export function TrainingStats({ timeLeftMs, correct, incorrect, accuracy, streak, bestStreak, avgMs }) {
  const s = Math.ceil(timeLeftMs / 1000);
  return (
    <div className="bv-live-stats" role="status" aria-label="Live session stats">
      <MiniStat label="Time left" value={`${s}s`} />
      <MiniStat label="Correct" value={correct} />
      <MiniStat label="Incorrect" value={incorrect} />
      <MiniStat label="Streak" value={streak} />
      <MiniStat label="Accuracy" value={`${accuracy}%`} />
      <MiniStat label="Avg reply" value={avgMs ? `${(avgMs / 1000).toFixed(1)}s` : '—'} />
      <span style={{ display: 'none' }}>Session best streak {bestStreak}</span>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="bv-stat">
      <div className="bv-stat-label">{label}</div>
      <div className="bv-stat-value">{value}</div>
    </div>
  );
}

/* ── TrainingTimer ────────────────────────────────────────────────── */
export function TrainingTimer({ timeLeftMs, totalMs, paused }) {
  const s = Math.ceil(timeLeftMs / 1000);
  const pct = totalMs ? Math.max(0, Math.min(100, (timeLeftMs / totalMs) * 100)) : 0;
  return (
    <div style={{ flex: 1, minWidth: '10rem' }}>
      <div className="bv-train-head">
        <span className={`bv-timer${s <= 5 ? ' bv-low' : ''}`} role="timer" aria-label={`${s} seconds left${paused ? ', paused' : ''}`}>
          {paused ? '⏸ ' : '⏱ '}{s}s
        </span>
      </div>
      <div className="bv-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Time remaining">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── StudentProgress (dashboard header) ───────────────────────────── */
export function StudentProgress({ progress, avgMs, currentLevelId }) {
  const total = (progress.totalCorrect || 0) + (progress.totalIncorrect || 0);
  const acc = total ? Math.round(((progress.totalCorrect || 0) / total) * 100) : 0;
  const lv = LEVELS.find((l) => l.id === currentLevelId) || LEVELS[0];
  const nextIdx = Math.min(lv.index + 1, LEVELS.length - 1);
  const nextProg = progress.levels?.[LEVELS[nextIdx].id];
  return (
    <Card title="Your Board Vision" piece="👁" sub="Train your eyes. Recognize every square. Visualize the board faster.">
      <div className="bv-stat-row">
        <div className="bv-stat"><div className="bv-stat-label">Current level</div><div className="bv-stat-value">{lv.icon} {lv.name}</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Sessions</div><div className="bv-stat-value">{progress.totalSessions || 0}</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Accuracy</div><div className="bv-stat-value">{acc}%</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Avg reply</div><div className="bv-stat-value">{avgMs ? `${(avgMs / 1000).toFixed(1)}s` : '—'}</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Best streak</div><div className="bv-stat-value">{progress.bestStreak || 0}</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Daily streak</div><div className="bv-stat-value">{progress.dailyStreak || 0} 🔥</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Next: {LEVELS[nextIdx].name}</div><div className="bv-stat-value">{nextProg ? `${Math.round(((nextProg.qualifyingSessions || 0) / 2) * 100)}%` : '0%'}</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Storage</div><div className="bv-stat-value" style={{ fontSize: '0.8rem' }}>Local (no server)</div></div>
      </div>
    </Card>
  );
}

/* ── SessionResults ───────────────────────────────────────────────── */
export function SessionResults({ result, settings, levelId, modeId, isPersonalBest, xp, nextUnlock, recommendation, onPlayAgain, onDifferentMode, onNextLevel, onDashboard }) {
  const lv = LEVELS.find((l) => l.id === levelId) || LEVELS[0];
  const next = LEVELS[Math.min(lv.index + 1, LEVELS.length - 1)];
  return (
    <Card title="Session Results" piece="🏁">
      <div className="bv-results-hero">
        <div className="bv-score">{result.correct} <span style={{ fontSize: '1rem' }}>correct</span></div>
        <p className="bv-head-sub">
          {modeById(modeId).name} · {lv.name} · {settings.duration}s · {result.accuracy}% accuracy ·
          avg {(result.avgMs / 1000).toFixed(1)}s · best streak {result.bestStreak} · +{xp} XP
        </p>
        <p className="bv-head-sub">
          {result.targetMet ? '✓ Challenge target reached.' : '○ Challenge target not reached — try again.'}
          {' '}{isPersonalBest ? '★ New personal best!' : ''}
        </p>
        {nextUnlock && <p className="bv-head-sub">{nextUnlock}</p>}
        {recommendation && <p className="bv-head-sub">Recommended next: <strong>{recommendation}</strong></p>}
      </div>
      <div className="bv-stat-row" style={{ margin: '1rem 0' }}>
        <div className="bv-stat"><div className="bv-stat-label">Correct</div><div className="bv-stat-value">{result.correct}</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Incorrect</div><div className="bv-stat-value">{result.incorrect}</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Accuracy</div><div className="bv-stat-value">{result.accuracy}%</div></div>
        <div className="bv-stat"><div className="bv-stat-label">Best streak</div><div className="bv-stat-value">{result.bestStreak}</div></div>
      </div>
      {result.history?.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Review mistakes ({result.history.filter((h) => !h.correct).length})</summary>
          <ul style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem' }}>
            {result.history.filter((h) => !h.correct).slice(0, 12).map((h, i) => (
              <li key={i}>“{h.prompt}” — you answered <strong>{h.given}</strong>, expected <strong>{h.expected}</strong>{h.category ? ` (${h.category})` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="bv-actions" style={{ marginTop: '1rem' }}>
        <Button type="button" variant="primary" size="md" onClick={onPlayAgain}>Play Again</Button>
        <Button type="button" variant="secondary" size="md" onClick={onDifferentMode}>Try a Different Mode</Button>
        {next && next.id !== lv.id && (
          <Button type="button" variant="secondary" size="md" onClick={() => onNextLevel?.(next.id)}>Continue to {next.name} →</Button>
        )}
        <Button type="button" variant="secondary" size="md" onClick={onDashboard}>Return to Dashboard</Button>
      </div>
    </Card>
  );
}


export function AnalyticsPanels({ progress }) {
  const modes = Object.entries(progress.modeStats || {});
  const missed = Object.entries(progress.missedSquares || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const sessions = (progress.sessions || []).slice(-14);
  return (
    <div className="bv-grid bv-grid-2">
      <Card title="Accuracy by mode" piece="🎯">
        {modes.length === 0 && <p className="bv-head-sub">No sessions yet.</p>}
        {modes.map(([m, s]) => {
          const acc = (s.correct + s.incorrect) ? Math.round((s.correct / (s.correct + s.incorrect)) * 100) : 0;
          return (
            <div key={m} style={{ marginBottom: '0.45rem' }}>
              <span className="bv-head-sub">{modeById(m).name} — {acc}% ({s.correct}/{s.correct + s.incorrect})</span>
              <div className="bv-bar"><div style={{ width: `${acc}%` }} /></div>
            </div>
          );
        })}
      </Card>
      <Card title="Most-missed squares" piece="🚩">
        {missed.length === 0 && <p className="bv-head-sub">No mistakes recorded yet.</p>}
        <div className="bv-seg">{missed.map(([sq, n]) => <Chip key={sq}>{sq} ×{n}</Chip>)}</div>
        {sessions.length > 0 && (
          <div style={{ marginTop: '0.8rem' }}>
            <p className="bv-setting-label">Recent accuracy (%)</p>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '3.2rem' }} role="img" aria-label="Recent session accuracy chart">
              {sessions.map((s, i) => (
                <div key={i} title={`${s.mode} ${s.accuracy}%`} style={{ flex: 1, height: `${Math.max(6, s.accuracy)}%`, background: 'linear-gradient(180deg,#93c5fd,#2563eb)', borderRadius: '3px' }} />
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export { Bar };
