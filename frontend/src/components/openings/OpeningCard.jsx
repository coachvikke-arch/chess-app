import { Link } from 'react-router-dom';
import { lineToString, lineCount } from '../../lib/openings';
import { STATUS, countPracticedLines } from '../../lib/openingsProgress';
import MiniBoard from './MiniBoard';

/* Difficulty + status colour language, kept in one place so the library, the
   detail view and the practice view all read identically. */
export const DIFFICULTY_TONE = {
  Beginner: 'green',
  Intermediate: 'gold',
  Advanced: 'red',
};

export const STATUS_META = {
  [STATUS.LEARNED]: { label: 'Learned', tone: 'green', icon: '✓' },
  [STATUS.IN_PROGRESS]: { label: 'In Progress', tone: 'gold', icon: '◐' },
  [STATUS.NOT_STARTED]: { label: 'Not Started', tone: '', icon: '○' },
};

const SIDE_LABEL = { white: 'White', black: 'Black' };

/**
 * One opening in the library grid.
 *
 * Deliberately a <Link> wrapping the whole card so the entire surface is
 * clickable, with the mini board as a non-interactive preview.
 */
export default function OpeningCard({ opening, progress, fen, index = 0, userId = null }) {
  const status = progress?.status || STATUS.NOT_STARTED;
  const meta = STATUS_META[status] || STATUS_META[STATUS.NOT_STARTED];
  const difficultyTone = DIFFICULTY_TONE[opening.difficulty] || 'gold';
  const line = lineToString(opening);
  /* How many lines this opening can be studied as (main line + variations), so
     the grid shows at a glance which openings are worth opening. */
  const lines = lineCount(opening);
  const practicedLines = countPracticedLines(opening.slug, userId);
  const learnedPct = progress?.totalMoves > 0
    ? Math.round((progress.onTheory / progress.totalMoves) * 100)
    : null;

  return (
    <Link
      to={`/openings/${opening.slug}`}
      className="group block h-full no-underline"
      style={{ '--d': `${Math.min(index, 11) * 0.03}s` }}
    >
      <article className="chess-card chess-card-hover op-card h-full">
        <div className="op-card-top">
          <MiniBoard fen={fen} size={92} orientation={opening.side} />
          <div className="op-card-head">
            <div className="op-card-eco">{opening.eco}</div>
            <h3 className="op-card-name">{opening.name}</h3>
            <p className="op-card-family">{opening.family}</p>
          </div>
        </div>

        <p className="op-card-desc">{opening.description}</p>

        <p className="op-card-line" title={line}>
          {line}
        </p>

        {lines > 1 && (
          <p className="op-card-lines" title={`${lines} lines: the main line plus ${lines - 1} variations`}>
            ♗ {lines} lines · main + {lines - 1} variation{lines - 1 === 1 ? '' : 's'}
          </p>
        )}

        <div className="op-card-chips">
          <span className={`chess-chip chess-chip-${difficultyTone}`}>{opening.difficulty}</span>
          <span className="chess-chip">
            {opening.side === 'white' ? '♔' : '♚'} {SIDE_LABEL[opening.side]}
          </span>
          {(opening.style || []).slice(0, 2).map((s) => (
            <span key={s} className="chess-chip">{s}</span>
          ))}
          {opening.gambit && (
            <span className="chess-chip chess-chip-red">{opening.gambit.classification}</span>
          )}
        </div>

        <div className="op-card-foot">
          <span className={`op-card-status op-card-status--${status}`}>
            <span aria-hidden="true">{meta.icon}</span> {meta.label}
          </span>
          {learnedPct !== null && status !== STATUS.LEARNED && (
            <span className="op-card-acc">{learnedPct}% theory</span>
          )}
          {lines > 1 && (
            <span className="op-card-practiced" title={`${practicedLines} of ${lines} lines practiced`}>
              ✓ {practicedLines}/{lines}
            </span>
          )}
          <span className="op-card-pop" title="Popularity among masters">
            {opening.popularity}% pop.
          </span>
        </div>
      </article>
    </Link>
  );
}
