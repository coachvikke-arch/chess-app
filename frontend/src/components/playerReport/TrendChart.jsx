import React from 'react';

const SOURCES = [
  ['chesscom', 'Chess.com', 'pr-trend-chesscom'],
  ['lichess', 'Lichess', 'pr-trend-lichess'],
  ['matezone', 'Mate Zone', 'pr-trend-matezone'],
];

/* Multi-series weekly accuracy chart, coloured by source. Plain SVG like the
 * other profile charts; no canvas and no chart dependency. */
export default function TrendChart({ weeks = [] }) {
  const width = 620;
  const height = 220;
  const left = 34;
  const right = 12;
  const top = 16;
  const bottom = 34;
  const innerW = width - left - right;
  const innerH = height - top - bottom;

  if (!weeks.length) {
    return <div className="pr-chart-empty">No weekly games in the last 90 days.</div>;
  }

  const x = (i) => left + (weeks.length === 1 ? innerW / 2 : (i * innerW) / (weeks.length - 1));
  const y = (v) => top + innerH - ((Math.max(0, Math.min(100, Number(v) || 0)) / 100) * innerH);

  return (
    <svg className="pr-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weekly accuracy by source">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line className="pr-grid-line" x1={left} x2={width - right} y1={y(v)} y2={y(v)} />
          <text className="pr-axis-label" x={left - 7} y={y(v) + 4} textAnchor="end">{v}</text>
        </g>
      ))}
      {SOURCES.map(([key, , cls]) => {
        const points = weeks
          .map((w, i) => (w[key] == null ? null : `${x(i)},${y(w[key])}`))
          .filter(Boolean)
          .join(' ');
        if (!points) return null;
        return <polyline key={key} className={`pr-trend-line ${cls}`} points={points} />;
      })}
      {weeks.map((w, i) => (
        (i % Math.max(1, Math.ceil(weeks.length / 6)) === 0 || i === weeks.length - 1) && (
          <text key={w.week} className="pr-axis-label" x={x(i)} y={height - 10} textAnchor="middle">
            {w.week}
          </text>
        )
      ))}
      <g transform={`translate(${left + 6},${top + 2})`}>
        {SOURCES.map(([key, label, cls], i) => (
          <g key={key} transform={`translate(0,${i * 16})`}>
            <line className={`pr-trend-line ${cls}`} x1="0" x2="18" y1="5" y2="5" />
            <text className="pr-legend-label" x="24" y="9">{label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
