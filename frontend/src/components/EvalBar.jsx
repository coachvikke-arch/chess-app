/* ──────────────────────────────────────────────────────────────────────────
 * EvalBar — the ONE evaluation bar used everywhere in the academy.
 *
 * Extracted from Game Review, which is the reference implementation: a 36px
 * rounded "pipe", White's share filled from the bottom (or the top when the
 * board is flipped), a cyan divider riding the split and a small chip carrying
 * the score on the leading side.
 *
 * Geometry and formatting come from `lib/evalDisplay.ts`, so this component,
 * the Game Review caption and the GM replay curve can never disagree about
 * where the split is or what the number reads.
 *
 * Usage:
 *   <EvalBar evaluation={evalCp} mate={evalMate} orientation="white" height={boardWidth} />
 *   <EvalBar evaluation={{ type: 'mate', value: 3 }} height={boardWidth} />
 *
 * `evaluation` accepts:
 *   - centipawns (White's point of view; negative = Black better)
 *   - `{ type: 'mate', value: n }` / `{ mate: n }` (signed mate distance)
 *   - `{ cp, mate }`
 * `mate` may also be passed separately (takes precedence over the object).
 * `null`/missing evaluation renders a level 50/50 bar.
 * ────────────────────────────────────────────────────────────────────────── */
import React from 'react';
import {
  evalBarPercent,
  evalLabelPlacement,
  formatEvalScore,
} from '../lib/evalDisplay';

/** Normalise the many accepted evaluation shapes into `{ cp, mate }`. */
function readEvaluation(evaluation, mate) {
  let cp = null;
  let mateScore = mate == null ? null : Number(mate);

  if (evaluation && typeof evaluation === 'object') {
    const type = evaluation.type;
    if (type === 'mate' || (type !== 'cp' && evaluation.mate != null)) {
      const value = evaluation.value ?? evaluation.mate ?? evaluation.distance;
      if (value != null) mateScore = Number(value);
      if (evaluation.cp != null) cp = Number(evaluation.cp);
    } else {
      const value = evaluation.cp ?? evaluation.score ?? evaluation.value;
      if (value != null) cp = Number(value);
      if (evaluation.mate != null) mateScore = Number(evaluation.mate);
    }
  } else if (evaluation != null && evaluation !== '') {
    const numeric = Number(evaluation);
    if (Number.isFinite(numeric)) cp = numeric;
  }

  return {
    cp: Number.isFinite(cp) ? cp : null,
    mate: Number.isFinite(mateScore) ? mateScore : null,
  };
}

/**
 * Vertical evaluation bar.
 *
 * @param {object} props
 * @param {number|object|null} [props.evaluation]  centipawns or a mate object
 * @param {number|null} [props.mate]               signed mate distance
 * @param {'white'|'black'} [props.orientation]    which colour is at the bottom
 * @param {number|string} [props.height]           bar height in px, any CSS length,
 *                                                  or 'auto' to stretch to its flex row
 * @param {boolean} [props.showLabel]              show the score chip on the split
 * @param {number|string} [props.width]            optional override for the 36px track
 * @param {string} [props.className]
 */
export default function EvalBar({
  evaluation = null,
  mate = null,
  orientation = 'white',
  height = 320,
  showLabel = true,
  width,
  className = '',
}) {
  const { cp, mate: mateScore } = readEvaluation(evaluation, mate);

  const whitePct = evalBarPercent(cp, mateScore);
  /* Which way the bar is filled. `barPct` is the distance from the BOTTOM to
     the White/Black split, so it is also where the divider parks. */
  const barPct = orientation === 'black' ? 100 - whitePct : whitePct;

  const numericHeight = typeof height === 'number' ? height : parseFloat(height);
  const label = evalLabelPlacement({
    cp,
    mate: mateScore,
    orientation,
    barHeightPx: Number.isFinite(numericHeight) ? numericHeight : 360,
  });

  const heightValue = typeof height === 'number' ? `${height}px` : (height || '100%');
  const stackStyle = { height: heightValue };
  if (width != null) stackStyle['--eval-bar-w'] = typeof width === 'number' ? `${width}px` : width;

  const scoreText = formatEvalScore(cp, mateScore);
  const accessible = cp == null && mateScore == null
    ? 'Evaluation not available'
    : `Evaluation ${scoreText} for White`;

  return (
    <div
      className={`eval-bar-stack${className ? ` ${className}` : ''}`}
      style={stackStyle}
    >
      <div
        className="eval-bar-wrap"
        role="img"
        aria-label={accessible}
        title={accessible}
      >
        {orientation === 'white' ? (
          <>
            <div className="eval-black-fill" style={{ height: `${100 - barPct}%` }} />
            <div className="eval-white-fill" style={{ height: `${barPct}%` }} />
          </>
        ) : (
          <>
            <div className="eval-black-fill eval-fill-bottom" style={{ height: `${barPct}%` }} />
            <div className="eval-white-fill eval-fill-top" style={{ height: `${100 - barPct}%` }} />
          </>
        )}
        <div className="eval-marker" style={{ bottom: `calc(${barPct}% - 1px)` }} />
      </div>

      {showLabel && (
        <div
          className={`eval-label ${label.onWhite ? 'is-dark' : 'is-light'}`}
          style={{
            bottom: `calc(${label.splitPct}% - 2px)`,
            transform: label.above
              ? 'translateX(-50%)'
              : 'translateX(-50%) translateY(-100%)',
          }}
        >
          {label.text}
        </div>
      )}
    </div>
  );
}
