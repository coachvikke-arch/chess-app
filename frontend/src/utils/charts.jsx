/* Tiny hand-rolled SVG charts (no chart library installed). */
import { useId } from 'react';

function niceTicks(min, max, count = 4) {
  const span = max === min ? 1 : max - min;
  const step = Math.ceil(span / count);
  const ticks = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  if (ticks.length < 2) ticks.push(max);
  return ticks;
}

/**
 * Smooth polyline SVG line chart.
 * props: { points, labels, titles, height, stroke, fill, format, maxLabels }
 *  points: [{ x, value }] sorted ascending by x
 *  titles: optional per-point hover text (native SVG <title> tooltip)
 *  maxLabels: cap on drawn x-axis labels (first + last always kept) so dense
 *  histories don't collide. Defaults to Infinity — the on-screen chart is
 *  untouched; the print layout passes a small cap.
 */
export function LineChart({ points = [], labels = [], titles = [], height = 150, stroke = '#2563eb', fill = '#21281d', format = (v) => v, maxLabels = Infinity }) {
  const W = 560;
  const PAD = { top: 14, right: 10, bottom: 22, left: 40 };
  const iw = W - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  /* Gradient ids must be unique per instance — SVG <defs> are document-global,
     so a hardcoded id means the second chart on a page paints with the first
     chart's colour. */
  const fillId = `cp-line-fill-${useId().replace(/:/g, '')}`;

  if (points.length < 2) {
    return (
      <div className="cp-chart-empty" style={{ height }}>
        Not enough rating points yet — play more games and this chart fills in automatically.
      </div>
    );
  }

  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const lo = Math.max(0, min - 15);
  const hi = max + 15;
  const ticks = niceTicks(lo, hi);

  const px = (i) => PAD.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const py = (v) => PAD.top + ih - ((v - lo) / (hi - lo)) * ih;

  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${px(points.length - 1).toFixed(1)},${PAD.top + ih} L${px(0).toFixed(1)},${PAD.top + ih} Z`;
  const step = iw / Math.max(1, labels.length - 1);
  /* Thin crowded x labels to at most maxLabels, always keeping the endpoints
     so the range still reads. The line itself keeps every point. */
  const labelStep = Math.max(1, Math.ceil(labels.length / Math.max(1, maxLabels)));
  const showLabel = (i) => i % labelStep === 0 || i === labels.length - 1;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="cp-chart" role="img" aria-label="Rating history chart">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left} x2={W - PAD.right} y1={py(t)} y2={py(t)}
            stroke="rgba(0,0,0,0.10)" strokeWidth="1"
          />
          <text x={PAD.left - 6} y={py(t) + 3} textAnchor="end" className="cp-chart-tick">
            {format(t)}
          </text>
        </g>
      ))}
      <path d={area} fill={`url(#${fillId})`} />
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {labels.map((label, i) => (
        showLabel(i) && (
          <text
            key={label + i}
            x={i === 0 ? PAD.left : i === labels.length - 1 ? PAD.left + step * i : PAD.left + step * i}
            y={height - 6}
            textAnchor="middle"
            className="cp-chart-tick"
          >
            {label}
          </text>
        )
      ))}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(p.value)} r="3" fill="#0f130d" stroke={stroke} strokeWidth="2" />
          {/* Larger transparent target so the per-point tooltip is easy to hit
              without visually bloating the marker. */}
          <circle cx={px(i)} cy={py(p.value)} r="10" fill="transparent">
            {titles[i] ? <title>{titles[i]}</title> : null}
          </circle>
        </g>
      ))}
    </svg>
  );
}

/** Simple bar chart. props: { items: [{label, value}], height, color } */
export function BarChart({ items = [], height = 130, color = '#2563eb' }) {
  if (!items.length) {
    return <div className="cp-chart-empty" style={{ height }}>No data yet.</div>;
  }
  const max = Math.max(1, ...items.map((i) => i.value));
  const W = 560;
  const bw = Math.max(8, Math.min(46, (W - 40) / items.length - 8));

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="cp-chart" role="img" aria-label="Bar chart">
      {items.map((it, i) => {
        const h = (it.value / max) * (height - 46);
        const x = 20 + i * ((W - 40) / items.length) + ((W - 40) / items.length - bw) / 2;
        const y = height - 34 - h;
        return (
          <g key={it.label + i}>
            <rect x={x} y={y} width={bw} height={Math.max(h, it.value ? 2 : 1)} rx="3" fill={color} opacity={it.value ? 0.9 : 0.25} />
            {it.value > 0 && (
              <text x={x + bw / 2} y={y - 4} textAnchor="middle" className="cp-chart-bar-val">{it.value}</text>
            )}
            <text x={x + bw / 2} y={height - 14} textAnchor="middle" className="cp-chart-tick">{it.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal win-rate comparison bars (Bars vs Stats). */
export function PctBar({ label, value, max = 100, color = '#2563eb' }) {
  return (
    <div className="cp-pct">
      <div className="cp-pct-head">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="chess-bar">
        <div className="chess-bar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Modern report charts. Still hand-rolled SVG/DOM — no chart library is
   installed, and inline SVG + plain divs are what html2canvas can reliably
   rasterise, so everything here survives the report's "Download as PDF"
   capture. Deliberately avoids canvas, <foreignObject> and conic-gradient,
   none of which render correctly through html2canvas.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Draws and legend dots. The draw grey was #94a3b8, which sits at only ~2.3:1
   against the white report card; #64748b keeps draws legible without competing
   with the green/red, which already have enough contrast on their own. */
const RESULT_COLORS = { W: '#22c55e', D: '#64748b', L: '#ef4444' };

/**
 * Donut chart for a W/D/L split.
 * props: { segments: [{key,label,value,color}], size, thickness, centerValue, centerLabel }
 * Drawn as one SVG circle per segment using stroke-dasharray, so the ring is
 * plain vector geometry rather than a CSS gradient the PDF pass would drop.
 */
export function DonutChart({
  segments = [],
  size = 140,
  thickness = 20,
  centerValue = '',
  centerLabel = '',
}) {
  const total = segments.reduce((s, x) => s + (Number(x.value) || 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const active = segments.filter((s) => Number(s.value) > 0);
  const gap = total > 0 && active.length > 1 ? 2 : 0;

  let offset = 0;
  const arcs = active
    .map((s) => {
      const len = (Number(s.value) / total) * c;
      /* Trim a couple of pixels between arcs so adjacent segments read as
         separate wedges instead of one solid ring — but never take more than
         15% of an arc, or a 1% slice would be mostly gap. */
      const draw = len - Math.min(gap, len * 0.15);
      const el = (
        <circle
          key={s.key}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={thickness}
          strokeDasharray={`${draw} ${Math.max(0, c - draw)}`}
          strokeDashoffset={-offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      );
      offset += len;
      return el;
    });

  return (
    <div className="cp-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel || 'Distribution'}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="rgba(15,19,13,0.12)"
          strokeWidth={thickness}
        />
        {arcs}
        <text x={size / 2} y={size / 2 - 1} textAnchor="middle" className="cp-donut-value">{centerValue}</text>
        {centerLabel && (
          <text x={size / 2} y={size / 2 + 15} textAnchor="middle" className="cp-donut-label">{centerLabel}</text>
        )}
      </svg>
    </div>
  );
}

/** Legend rows that sit beside a DonutChart. */
export function DonutLegend({ segments = [] }) {
  const total = segments.reduce((s, x) => s + (Number(x.value) || 0), 0);
  return (
    <ul className="cp-donut-legend">
      {segments.map((s) => (
        <li key={s.key}>
          <span className="cp-dot" style={{ background: s.color }} aria-hidden />
          <span className="cp-donut-legend-label">{s.label}</span>
          <span className="cp-donut-legend-value">
            {Number(s.value) || 0}
            {total > 0 && (
              <em>{Math.round(((Number(s.value) || 0) / total) * 100)}%</em>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Build W / D / L segments from a summary-shaped object. */
export function resultSegments(summary) {
  return [
    { key: 'w', label: 'Wins', value: summary?.wins || 0, color: RESULT_COLORS.W },
    { key: 'd', label: 'Draws', value: summary?.draws || 0, color: RESULT_COLORS.D },
    { key: 'l', label: 'Losses', value: summary?.losses || 0, color: RESULT_COLORS.L },
  ];
}

/**
 * Derive a single W / D / L outcome for a history game.
 *
 * The API's `mineWon` flag is NOT enough on its own: the backend sets it to
 * `false` for draws and to `null` for unfinished/abandoned games, so counting
 * on it alone silently turns every draw into a loss. `resultLabel` ("Win",
 * "Win (Mate)", "Draw", "Abandoned", "Finished"…) is the canonical field, so
 * prefer it and only fall back to the booleans.
 */
export function gameOutcome(g) {
  const label = String(g?.resultLabel || '');
  if (/^win/i.test(label)) return 'W';
  if (/^loss/i.test(label)) return 'L';
  if (/^draw/i.test(label)) return 'D';
  if (g?.result === 'draw') return 'D';
  if (g?.mineWon === true) return 'W';
  if (g?.mineWon === false) return 'L';
  return null; // unfinished / abandoned — not a scored game
}

/** Oldest → newest. The API returns games newest-first, so charts that read
    left-to-right as progress must re-sort. */
function chronological(games = []) {
  return [...games].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

/**
 * Recent-results strip: one pill per game, oldest → newest. Reads as a form
 * guide at a glance ("WWDLWW") without needing any axes.
 * props: { games, limit }
 */
export function FormStrip({ games = [], limit = 14 }) {
  const rows = chronological(games)
    .map((g) => ({ g, r: gameOutcome(g) }))
    .filter((x) => x.r)
    .slice(-limit);
  if (!rows.length) return null;
  const tally = rows.reduce(
    (a, x) => ({ ...a, [x.r]: (a[x.r] || 0) + 1 }),
    { W: 0, D: 0, L: 0 }
  );
  return (
    <div>
      <div className="cp-form" role="img" aria-label={`Last ${rows.length} results`}>
        {rows.map((x, i) => (
          <span
            key={x.g.id || i}
            className="cp-form-pill"
            style={{ background: RESULT_COLORS[x.r] }}
            title={`${x.g.date ? new Date(x.g.date).toLocaleDateString() : ''} · ${x.r === 'W' ? 'Win' : x.r === 'D' ? 'Draw' : 'Loss'}`}
          >
            {x.r}
          </span>
        ))}
      </div>
      <p className="cp-form-legend">
        Oldest → newest · {tally.W}W {tally.D}D {tally.L}L
      </p>
    </div>
  );
}

/**
 * Rolling win-rate series for a LineChart: the win rate over each trailing
 * window of games. Draws count in the denominator but not as wins, and
 * unfinished games are skipped entirely rather than counted as losses.
 * props: { games, window }
 */
export function rollingWinRateSeries(games = [], window = 5) {
  const rows = chronological(games)
    .map((g) => ({ g, r: gameOutcome(g) }))
    .filter((x) => x.r);
  if (rows.length < 2) return { points: [], labels: [] };
  const points = [];
  const labels = [];
  for (let i = 0; i < rows.length; i++) {
    const slice = rows.slice(Math.max(0, i - window + 1), i + 1);
    const wins = slice.filter((x) => x.r === 'W').length;
    points.push({ value: Math.round((wins / slice.length) * 100) });
    const d = slice[slice.length - 1].g.date;
    labels.push(
      d
        ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        : `#${i + 1}`
    );
  }
  return { points, labels };
}

/** Games-per-month buckets, for a volume column chart. */
export function gamesPerMonth(games = [], months = 6) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      value: 0,
      key: `${d.getFullYear()}-${d.getMonth()}`,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const g of games || []) {
    if (!g.date) continue;
    const d = new Date(g.date);
    if (Number.isNaN(+d)) continue;
    const hit = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (hit) hit.value += 1;
  }
  return buckets;
}

/**
 * Cross-source comparison bars — one metric, several sources, ranked.
 * props: { rows: [{label, value, display, color}], suffix }
 */
export function CompareBars({ rows = [], suffix = '' }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0));
  return (
    <div className="cp-compare-bars">
      {rows.map((r) => {
        const pct = ((Number(r.value) || 0) / max) * 100;
        return (
          <div key={r.label} className="cp-compare-row">
            <span className="cp-compare-name">{r.label}</span>
            <div className="cp-compare-track">
              <div
                className="cp-compare-fill"
                style={{ width: `${Math.max(pct, r.value ? 3 : 0)}%`, background: r.color || '#60a5fa' }}
              />
            </div>
            <span className="cp-compare-val">{r.display ?? r.value}{suffix}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Rating bars per platform category (Bullet / Blitz / Rapid / Classical).
 * props: { ratings: [{category, rating}] }
 */
export function RatingBars({ ratings = [] }) {
  const rows = (ratings || [])
    .filter((r) => Number(r.rating) > 0)
    .map((r) => ({ label: cap(r.category), value: Number(r.rating) }))
    .sort((a, b) => b.value - a.value);
  if (!rows.length) return null;
  return <CompareBars rows={rows} suffix="" />;
}

function cap(s) {
  const t = String(s || '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
