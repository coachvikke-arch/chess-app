import { useEffect, useId, useRef, useState } from 'react';

/*
 * Responsive, dependency-free SVG charts for the tournament report.
 *
 * The project already ships a hand-rolled chart module (utils/charts) and no
 * third-party chart library is installed. These follow the same rule: plain
 * SVG, so the report's html2canvas export never sees a canvas or a
 * <foreignObject>. Width is measured (like Recharts' ResponsiveContainer) so
 * axis type stays at its real size on phones instead of being scaled down.
 */

function useWidth(initial = 560) {
  const ref = useRef(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceTicks(min, max, count = 4) {
  const span = max === min ? 1 : max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const rawStep = Math.max(1, Math.ceil(raw / mag) * mag);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) {
    if (v >= 0) ticks.push(Number(v.toFixed(6)));
  }
  if (ticks.length < 2) ticks.push(max);
  return ticks;
}

function Tooltip({ point, show }) {
  if (!show || !point) return null;
  return (
    <div className="tr-chart-tip" role="status" style={{ left: `${point.leftPct}%`, top: `${point.topPct}%` }}>
      {point.tooltip}
    </div>
  );
}

/**
 * Line chart with axes, grid, axis titles, point tooltips and a fixed height.
 * items: [{ label, value, tooltip }]
 */
export function TournamentLineChart({
  items = [],
  height = 300,
  color = '#0b7ea8',
  yLabel = 'Points',
  xLabel = 'Tournament',
  emptyText = 'No data yet.',
}) {
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  const fillId = `tr-line-${useId().replace(/:/g, '')}`;
  const values = items.map((i) => Number(i.value) || 0);

  if (!items.length) {
    return (
      <div ref={wrapRef} className="tr-chart-empty" style={{ height }}>
        {emptyText}
      </div>
    );
  }

  const PAD = { top: 18, right: 18, bottom: 54, left: 52 };
  const iw = Math.max(40, width - PAD.left - PAD.right);
  const ih = Math.max(40, height - PAD.top - PAD.bottom);
  /* Points never go negative, so anchoring at zero (like the bar chart)
     keeps a small series from being blown up into a misleading 5-7 range. */
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const pad = Math.max(1, (max - min) * 0.12);
  const ticks = niceTicks(min, max + pad, 4);
  const tickLo = Math.min(0, ...ticks);
  const tickHi = Math.max(...ticks, Math.ceil(max));
  const px = (i) => PAD.left + (items.length === 1 ? iw / 2 : (i / (items.length - 1)) * iw);
  const py = (v) => PAD.top + ih - ((v - tickLo) / (tickHi - tickLo)) * ih;
  const path = items
    .map((it, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(values[i]).toFixed(1)}`)
    .join(' ');
  const area = `${path} L${px(items.length - 1).toFixed(1)},${PAD.top + ih} L${px(0).toFixed(1)},${PAD.top + ih} Z`;
  const labelStep = Math.max(1, Math.ceil(items.length / 8));
  const showLabel = (i) => i % labelStep === 0 || i === items.length - 1;

  const setPoint = (i) => {
    const leftPct = Math.min(88, Math.max(12, (px(i) / width) * 100));
    const topPct = Math.min(86, Math.max(10, (py(values[i]) / height) * 100));
    setHover({ leftPct, topPct, tooltip: items[i].tooltip || `${items[i].label}: ${values[i]}` });
  };

  return (
    <div ref={wrapRef} className="tr-chart-wrap" style={{ height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${yLabel} by ${xLabel}`}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={py(t)}
              y2={py(t)}
              stroke="var(--hairline)"
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={py(t) + 4} textAnchor="end" className="tr-axis-tick">
              {t}
            </text>
          </g>
        ))}

        <text
          x={14}
          y={PAD.top + ih / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${PAD.top + ih / 2})`}
          className="tr-axis-title"
        >
          {yLabel}
        </text>
        <text x={PAD.left + iw / 2} y={height - 6} textAnchor="middle" className="tr-axis-title">
          {xLabel}
        </text>

        <path d={area} fill={`url(#${fillId})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />

        {items.map((it, i) => (
          <circle
            key={`${it.label}-${i}`}
            cx={px(i)}
            cy={py(values[i])}
            r={hover === null ? 3.4 : 3}
            fill="#ffffff"
            stroke={color}
            strokeWidth="2.2"
          />
        ))}

        {items.map((it, i) => (
          <g key={`hit-${it.label}-${i}`}>
            <rect
              x={px(i) - (items.length === 1 ? iw / 2 : iw / Math.max(1, items.length - 1) / 2)}
              y={PAD.top}
              width={items.length === 1 ? iw : iw / Math.max(1, items.length - 1)}
              height={ih}
              fill="transparent"
              tabIndex={0}
              onMouseEnter={() => setPoint(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setPoint(i)}
              onBlur={() => setHover(null)}
            >
              <title>{it.tooltip || `${it.label}: ${values[i]}`}</title>
            </rect>
            {showLabel(i) && (
              <text x={px(i)} y={PAD.top + ih + 18} textAnchor="middle" className="tr-axis-tick">
                {it.label}
              </text>
            )}
          </g>
        ))}

      </svg>
      <Tooltip point={hover} show={hover !== null} />
    </div>
  );
}

/**
 * Vertical bar chart with axes, grid, category labels, tooltips and values.
 * items: [{ label, value, tooltip }]
 */
export function TournamentBarChart({
  items = [],
  height = 300,
  color = '#0b7ea8',
  yLabel = 'Points',
  xLabel = 'Tournament',
  emptyText = 'No data yet.',
  valueSuffix = '',
}) {
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  const values = items.map((i) => Number(i.value) || 0);

  if (!items.length) {
    return (
      <div ref={wrapRef} className="tr-chart-empty" style={{ height }}>
        {emptyText}
      </div>
    );
  }

  const PAD = { top: 18, right: 16, bottom: 58, left: 52 };
  const iw = Math.max(40, width - PAD.left - PAD.right);
  const ih = Math.max(40, height - PAD.top - PAD.bottom);
  const max = Math.max(1, ...values);
  const ticks = niceTicks(0, max, 4);
  const top = Math.max(max, ...ticks);
  const py = (v) => PAD.top + ih - (v / top) * ih;
  const slot = iw / items.length;
  const bw = Math.max(5, Math.min(46, slot * 0.64));
  const labelStep = Math.max(1, Math.ceil(items.length / 8));
  const showLabel = (i) => i % labelStep === 0 || i === items.length - 1;

  const setPoint = (i) => {
    const x = PAD.left + slot * (i + 0.5);
    const leftPct = Math.min(88, Math.max(12, (x / width) * 100));
    const topPct = Math.min(84, Math.max(12, (py(values[i]) / height) * 100));
    setHover({
      leftPct,
      topPct,
      tooltip: items[i].tooltip || `${items[i].label}: ${values[i]}${valueSuffix}`,
    });
  };

  return (
    <div ref={wrapRef} className="tr-chart-wrap" style={{ height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${yLabel} by ${xLabel}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={py(t)}
              y2={py(t)}
              stroke="var(--hairline)"
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={py(t) + 4} textAnchor="end" className="tr-axis-tick">
              {t}
            </text>
          </g>
        ))}

        <text
          x={14}
          y={PAD.top + ih / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${PAD.top + ih / 2})`}
          className="tr-axis-title"
        >
          {yLabel}
        </text>
        <text x={PAD.left + iw / 2} y={height - 6} textAnchor="middle" className="tr-axis-title">
          {xLabel}
        </text>

        {items.map((it, i) => {
          const x = PAD.left + slot * (i + 0.5) - bw / 2;
          const y = py(values[i]);
          const h = Math.max(values[i] ? 2 : 1, PAD.top + ih - y);
          return (
            <g
              key={`${it.label}-${i}`}
              tabIndex={0}
              onMouseEnter={() => setPoint(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setPoint(i)}
              onBlur={() => setHover(null)}
            >
              <rect x={x} y={y} width={bw} height={h} rx="3" fill={color} opacity={values[i] ? 0.92 : 0.24}>
                <title>{it.tooltip || `${it.label}: ${values[i]}${valueSuffix}`}</title>
              </rect>
              {items.length <= 12 && values[i] > 0 && (
                <text x={x + bw / 2} y={y - 5} textAnchor="middle" className="tr-axis-caption">
                  {values[i]}
                </text>
              )}
              {showLabel(i) && (
                <text x={x + bw / 2} y={PAD.top + ih + 18} textAnchor="middle" className="tr-axis-tick">
                  {it.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip point={hover} show={hover !== null} />
    </div>
  );
}

/** Horizontal bars for the admin-only top-performer ranking. */
export function TopPerformersChart({ items = [], color = '#b45309' }) {
  if (!items.length) return null;
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return (
    <div className="tr-hbars">
      <div className="tr-hbar-axis">
        <span>Player</span>
        <span>Points</span>
      </div>
      {items.map((it, i) => {
        const value = Number(it.value) || 0;
        const pct = Math.max(3, (value / max) * 100);
        return (
          <div className="tr-hbar-row" key={it.id || it.name || i} title={`${it.name}: ${value} points`}>
            <span className="tr-hbar-rank">{i + 1}</span>
            <span className="tr-hbar-name">{it.name}</span>
            <span className="tr-hbar-track">
              <span className="tr-hbar-fill" style={{ width: `${pct}%`, background: color }} />
            </span>
            <span className="tr-hbar-value">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ChartLegend({ color, label }) {
  return (
    <span className="tr-legend">
      <span className="tr-legend-dot" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}
