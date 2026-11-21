import React, { useId } from 'react';

const AXES = [
  ['opening', 'Opening'],
  ['tactics', 'Tactics'],
  ['positional', 'Positional'],
  ['endgame', 'Endgame'],
  ['timeManagement', 'Time'],
  ['consistency', 'Consistency'],
];

/*
 * Hand-rolled SVG radar. The profile page has no chart library, and its
 * charts are plain SVG so cards stay light and printable.
 */
export default function SkillRadar({ skills = {} }) {
  const uid = useId().replace(/:/g, '');
  const cx = 150;
  const cy = 140;
  const radius = 100;
  const count = AXES.length;

  const pointAt = (index, value) => {
    const angle = (-Math.PI / 2) + (index * 2 * Math.PI / count);
    const r = (radius * Math.max(0, Math.min(100, Number(value) || 0))) / 100;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  const axisEnd = (index) => pointAt(index, 100);

  const ringPoints = (pct) => AXES.map((_, i) => pointAt(i, pct).join(',')).join(' ');
  const valuePoints = AXES.map(([key], i) => pointAt(i, skills[key]).join(',')).join(' ');

  return (
    <svg className="pr-radar" viewBox="0 0 300 285" role="img" aria-label="Skill radar">
      <defs>
        <linearGradient id={`pr-radar-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--pr-skill-fill-top, #93c5fd)" stopOpacity="0.65" />
          <stop offset="100%" stopColor="var(--pr-skill-fill-bottom, #2563eb)" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      {[25, 50, 75, 100].map((pct) => (
        <polygon key={pct} className="pr-radar-ring" points={ringPoints(pct)} />
      ))}
      {AXES.map(([key], i) => {
        const [x, y] = axisEnd(i);
        return <line key={key} className="pr-radar-axis" x1={cx} y1={cy} x2={x} y2={y} />;
      })}
      <polygon
        className="pr-radar-value"
        points={valuePoints}
        fill={`url(#pr-radar-fill-${uid})`}
      />
      {AXES.map(([key], i) => {
        const [x, y] = pointAt(i, skills[key]);
        return <circle key={key} className="pr-radar-dot" cx={x} cy={y} r="3.5" />;
      })}
      {AXES.map(([key, label], i) => {
        const [x, y] = pointAt(i, 128);
        return (
          <text key={key} className="pr-radar-label" x={x} y={y} textAnchor="middle" dominantBaseline="middle">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
