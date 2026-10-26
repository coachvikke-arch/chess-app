import { useState } from 'react';
import Button from '../Button';
import ChessBoard from '../ChessBoard';
import api from '../../services/api';
import {
  DEFAULT_QUIZ_SETTINGS,
  getQuizSettings,
  setQuizSettings,
  settingsToFields,
  fieldsToSettings,
} from '../../config/quizSettings';

/* "Ask quiz" setup modal: position preview + drill config, then a single
   small POST to start. Split into its own chunk so opening it never pays
   for the drill area's code — the shell renders first, this streams in. */
export default function QuizPuzzleModal({ puzzle, classId, onClose, onStarted }) {
  const title = puzzle?.title || 'Puzzle';
  const fen = puzzle?.fen;
  const solution = puzzle?.solution || [];
  /* Pre-fill from the last quiz this instructor started (blank fields stay
     blank — see config/quizSettings). First ever use has no saved settings, so
     every field starts empty. */
  const [fields, setFields] = useState(() => settingsToFields(getQuizSettings()));
  const [busy, setBusy] = useState(false);

  const canStart = !!fen && solution.length > 0 && !busy;

  const start = async () => {
    if (!canStart) return;
    setBusy(true);
    try {
      const res = await api.post(`/classes/${classId}/puzzle-drill/start`, {
        title: title || null,
        fen,
        solution,
        timeLimitSeconds: fields.timeLimitSeconds === '' ? null : Number(fields.timeLimitSeconds),
        points: Number(fields.points) || 0,
        maxAttempts: fields.maxAttempts === '' ? null : Number(fields.maxAttempts) || 1,
        negativePoints: Number(fields.negativePoints) || 0,
      });
      /* Remember these values for the NEXT quiz — only ever saved on a
         successful Start (never on open or cancel). */
      setQuizSettings(fieldsToSettings(fields));
      if (onStarted) onStarted(res.data.drill);
      onClose();
    } catch (err) {
      window.alert(err?.response?.data?.message || 'Could not start the drill.');
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  /* Clear the fields locally. The cleared values are not persisted, so
     Reset-then-cancel changes nothing; Reset-then-Start saves the blanks. */
  const resetFields = () => setFields(settingsToFields(DEFAULT_QUIZ_SETTINGS));

  return (
    <div className="live-drill-modal-backdrop" onClick={onClose}>
      <div className="live-drill-modal" onClick={(e) => e.stopPropagation()}>
        <div className="live-drill-modal-head">
          <span className="live-drill-modal-title">🎯 Ask quiz</span>
          <button type="button" className="live-drill-modal-x" onClick={onClose}>✕</button>
        </div>

        <div className="live-drill-breadcrumb live-drill-modal-crumb">
          <span className="live-drill-breadcrumb-all">All</span>
          <span className="live-drill-breadcrumb-sep">›</span>
          <span className="live-drill-breadcrumb-name">{title}</span>
        </div>

        <div className="live-drill-preview">
          {fen ? (
            <ChessBoard key={fen} fen={fen} interactive={false} showLegalMoves={false} boardWidth={200} />
          ) : (
            <div className="live-drill-none">No position.</div>
          )}
          <div className="live-drill-preview-meta">
            <span className="live-course-chip">{solution.length ? `${solution.length} move${solution.length === 1 ? '' : 's'}` : 'Position only'}</span>
            {solution.length === 0 && <p className="live-drill-none">This file has no solution moves — ask a puzzle with moves.</p>}
          </div>
        </div>

        <div className="live-drill-config">
          <label className="live-drill-field">
            <span>Time limit (sec, blank = none)</span>
            <input type="number" min="0" value={fields.timeLimitSeconds} onChange={set('timeLimitSeconds')} />
          </label>
          <label className="live-drill-field">
            <span>Points on solve</span>
            <input type="number" min="0" value={fields.points} onChange={set('points')} />
          </label>
          <label className="live-drill-field">
            <span>Attempts allowed (blank = none)</span>
            <input type="number" min="0" value={fields.maxAttempts} onChange={set('maxAttempts')} />
          </label>
          <label className="live-drill-field">
            <span>Points deducted per fail</span>
            <input type="number" min="0" value={fields.negativePoints} onChange={set('negativePoints')} />
          </label>
        </div>

        <div className="live-drill-config-foot">
          <Button type="button" variant="ghost" size="sm" onClick={resetFields}>
            Reset to defaults
          </Button>
        </div>

        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canStart}
          onClick={start}
        >
          {busy ? 'Starting…' : canStart ? `Start “${title}”` : 'Select a puzzle with moves to start'}
        </Button>
      </div>
    </div>
  );
}
