import { useEffect, useId, useMemo } from 'react';

export const CERT_W = 1308;
export const CERT_H = 924;

const FONT_ID = 'mz-cert-fonts';
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Great+Vibes&family=Lato:wght@400;700&display=swap';

const BASE_THEME = {
  gold: '#d4af37',
  goldLt: '#f1dc9a',
  ink: '#0a0d14',
  wine: '#7a1f2b',
  wineDk: '#4a1019',
};
const TEXT = '#f6f1e4';
const MUTED = '#c2bba8';

const PRINT_CSS = `
.mz-cert, .mz-cert * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
@media print {
  @page { size: ${CERT_W}px ${CERT_H}px; margin: 0; }
  body * { visibility: hidden !important; }
  .mz-cert-print, .mz-cert-print * { visibility: visible !important; }
  .mz-cert-print { position: fixed !important; left: 0 !important; top: 0 !important; width: ${CERT_W}px !important; height: ${CERT_H}px !important; z-index: 2147483647; }
  .mz-cert-print .mz-cert { transform: none !important; }
}`;

const TIERS = {
  1: { top: '#f1dc9a', bottom: '#d4af37', big: '1ST', small: 'PLACE', text: '1st' },
  2: { top: '#f2f4f8', bottom: '#98a1ae', big: '2ND', small: 'PLACE', text: '2nd' },
  3: { top: '#e8aa78', bottom: '#8a5226', big: '3RD', small: 'PLACE', text: '3rd' },
};

function getTier(position) {
  const n = Number(position);
  if (TIERS[n]) return TIERS[n];
  if (Number.isFinite(n) && n > 3) {
    return { top: '#f1dc9a', bottom: '#d4af37', big: `${n}TH`, small: 'PLACE', text: `${n}th` };
  }
  return { top: '#f1dc9a', bottom: '#d4af37', big: 'PLAYER', small: 'PARTICIPANT', text: 'Participant', participant: true };
}

function formatDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function starPoints(cx, cy, R = 5) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? R : R * 0.45;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const LEAVES = [105, 127, 149, 171, 193, 215, 237, 259].map((a) => {
  const r = (a * Math.PI) / 180;
  return { a, x: 56 * Math.cos(r), y: 56 * Math.sin(r) };
});
const SCALLOPS = Array.from({ length: 28 }, (_, i) => {
  const r = (i * 2 * Math.PI) / 28;
  return { x: 100 + 88 * Math.cos(r), y: 100 + 88 * Math.sin(r) };
});

export default function Certificate({
  playerName = 'Player Name',
  tournamentName = 'Tournament Name',
  position = 1,
  score = '',
  date = '',
  coachName = 'Nagavel Krishnamoorthi',
  coachTitle = 'Founder & Head Coach',
  scale = 1,
  theme,
  innerRef,
}) {
  const C = { ...BASE_THEME, ...(theme || {}) };
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (n) => `${uid}-${n}`;
  const url = (n) => `url(#${id(n)})`;
  const tier = getTier(position);
  const dateText = formatDate(date);

  useEffect(() => {
    if (!document.getElementById(FONT_ID)) {
      const l = document.createElement('link');
      l.id = FONT_ID;
      l.rel = 'stylesheet';
      l.href = FONT_HREF;
      document.head.appendChild(l);
    }
  }, []);

  const trophies = useMemo(() => {
    const out = [];
    for (let r = 0, y = 18; y < 900; r++, y += 128) {
      for (let c = 0, x = r % 2 === 0 ? 10 : 80; x < 1300; c++, x += 140) {
        out.push({ x, y, rot: (((r * 7 + c * 11) % 5) - 2) * 7 });
      }
    }
    return out;
  }, []);

  const nameLen = playerName.length;
  const nameSize = nameLen > 28 ? 46 : nameLen > 22 ? 60 : 78;
  const tLen = tournamentName.length;
  const ribbonSize = tLen > 40 ? 18 : tLen > 34 ? 22 : tLen > 26 ? 26 : 30;

  const row = { position: 'relative' };
  const label = { position: 'relative', fontSize: 21, color: MUTED };
  const rule = (w) => ({ width: w, height: 2, background: C.gold });
  const diamond = { width: 10, height: 10, background: C.gold, transform: 'rotate(45deg)' };

  return (
    <div className="mz-cert-print" style={{ width: CERT_W * scale, height: CERT_H * scale }}>
      <style>{PRINT_CSS}</style>
      <div
        ref={innerRef}
        className="mz-cert"
        style={{
          position: 'relative',
          width: CERT_W,
          height: CERT_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          overflow: 'hidden',
          background: `radial-gradient(ellipse at 50% 40%, #1a2133 0%, ${C.ink} 70%)`,
          fontFamily: "'Lato', sans-serif",
          color: TEXT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '52px 0 0',
        }}
      >
        {/* Background art */}
        <svg width={CERT_W} height={CERT_H} viewBox={`0 0 ${CERT_W} ${CERT_H}`} style={{ position: 'absolute', left: 0, top: 0 }} aria-hidden="true">
          <defs>
            <linearGradient id={id('pg')} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={C.goldLt} />
              <stop offset="0.5" stopColor={C.gold} />
              <stop offset="1" stopColor="#6e5714" />
            </linearGradient>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={C.goldLt} />
              <stop offset="1" stopColor={C.gold} />
            </linearGradient>
            <filter id={id('blur')} x="-5%" y="-5%" width="110%" height="110%">
              <feGaussianBlur stdDeviation="3.5" />
            </filter>
            <g id={id('trophy')}>
              <path d="M20 10 H120 C120 70 100 110 70 120 C40 110 20 70 20 10Z" />
              <path d="M22 26 H6 C6 62 20 76 40 80 M118 26 H134 C134 62 120 76 100 80" fill="none" stroke={url('pg')} strokeWidth="9" />
              <rect x="62" y="118" width="16" height="52" />
              <path d="M50 170 H90 L98 186 H42Z" />
              <rect x="28" y="186" width="84" height="18" rx="3" />
              <rect x="18" y="204" width="104" height="28" rx="4" />
              <rect x="40" y="211" width="60" height="14" rx="2" fill={C.ink} opacity="0.45" />
              <polygon points="70,34 76,50 93,50 79,60 85,76 70,66 55,76 61,60 47,50 64,50" fill={C.ink} opacity="0.4" />
              <path d="M34 16 C34 60 46 92 62 108" fill="none" stroke="#fff" strokeWidth="5" opacity="0.28" />
            </g>
            <g id={id('corner')}>
              <path d="M36 104 V36 H104" fill="none" stroke={url('bg')} strokeWidth="2.5" />
              <rect x="27" y="27" width="18" height="18" fill="none" stroke={url('bg')} strokeWidth="2" />
              <rect x="32" y="32" width="8" height="8" fill={C.gold} />
            </g>
          </defs>

          <g fill={url('pg')} opacity="0.16" filter={url('blur')}>
            {trophies.map((t, i) => (
              <use key={i} href={`#${id('trophy')}`} transform={`translate(${t.x} ${t.y}) rotate(${t.rot} 28 46) scale(0.4)`} />
            ))}
          </g>

          <polygon points="0,0 270,0 0,200" fill={url('bg')} opacity="0.85" />
          <polygon points="0,0 180,0 0,134" fill={C.wine} />
          <polygon points="0,0 110,0 0,82" fill={C.wineDk} />
          <polygon points="1308,924 1038,924 1308,724" fill={url('bg')} opacity="0.85" />
          <polygon points="1308,924 1128,924 1308,790" fill={C.wine} />
          <polygon points="1308,924 1198,924 1308,842" fill={C.wineDk} />
          <use href={`#${id('corner')}`} />
          <use href={`#${id('corner')}`} transform="translate(1308 0) scale(-1 1)" />
          <use href={`#${id('corner')}`} transform="translate(0 924) scale(1 -1)" />
          <use href={`#${id('corner')}`} transform="translate(1308 924) scale(-1 -1)" />
        </svg>

        {/* Tagline */}
        <div style={{ position: 'absolute', right: 70, top: 52, textAlign: 'right', fontSize: 13, letterSpacing: 4, lineHeight: '22px', color: C.goldLt }}>
          BETTER THINKERS<br />STRONGER MOVES<br />BRIGHTER FUTURES
          <div style={{ width: 90, height: 2, background: C.gold, margin: '12px 0 0 auto' }} />
        </div>

        {/* Header */}
        <div style={{ ...row, fontFamily: "'Cinzel', serif", fontWeight: 800, fontSize: 66, letterSpacing: 3, lineHeight: 1, color: C.goldLt }}>MATE ZONE</div>
        <div style={{ ...row, display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
          <div style={rule(70)} />
          <div style={{ fontSize: 17, letterSpacing: 8, color: TEXT, fontWeight: 700 }}>CHESS ACADEMY</div>
          <div style={rule(70)} />
        </div>
        <div style={{ ...row, fontFamily: "'Cinzel', serif", fontWeight: 800, fontSize: 92, letterSpacing: 2, lineHeight: 1, marginTop: 22, color: TEXT }}>CERTIFICATE</div>
        <div style={{ ...row, display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
          <div style={rule(150)} />
          <div style={diamond} />
          <div style={{ fontWeight: 700, fontSize: 28, letterSpacing: 6, color: C.gold }}>OF ACHIEVEMENT</div>
          <div style={diamond} />
          <div style={rule(150)} />
        </div>

        {/* Recipient */}
        <div style={{ ...label, marginTop: 24 }}>This certificate is proudly presented to</div>
        <div style={{ ...row, fontFamily: "'Great Vibes', cursive", fontSize: nameSize, lineHeight: 1.1, marginTop: 4, color: TEXT, maxWidth: 760, textAlign: 'center', whiteSpace: 'nowrap' }}>{playerName}</div>
        <div style={{ ...row, display: 'flex', alignItems: 'center', width: 620 }}>
          <div style={{ flex: 1, height: 2, background: C.gold, opacity: 0.7 }} />
          <div style={{ ...diamond, margin: '0 10px' }} />
          <div style={{ flex: 1, height: 2, background: C.gold, opacity: 0.7 }} />
        </div>
        <div style={{ ...label, marginTop: 14 }}>for outstanding performance in</div>

        {/* Ribbon */}
        <svg width="860" height="90" viewBox="0 0 860 90" style={{ position: 'relative', marginTop: 8 }} role="img" aria-label={tournamentName}>
          <defs>
            <linearGradient id={id('wg')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.wine} />
              <stop offset="1" stopColor={C.wineDk} />
            </linearGradient>
          </defs>
          <polygon points="6,22 28,48 6,74 100,74 100,22" fill={C.wineDk} stroke={C.gold} strokeWidth="1.5" />
          <polygon points="854,22 832,48 854,74 760,74 760,22" fill={C.wineDk} stroke={C.gold} strokeWidth="1.5" />
          <rect x="70" y="8" width="720" height="66" fill={url('wg')} stroke={C.gold} strokeWidth="2.5" />
          <rect x="78" y="15" width="704" height="52" fill="none" stroke={C.goldLt} strokeWidth="0.8" opacity="0.7" />
          <text x="430" y={42 + ribbonSize * 0.35} textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="600" fontSize={ribbonSize} letterSpacing="5" fill="#fff6dc">
            {tournamentName.toUpperCase()}
          </text>
        </svg>

        <div style={{ ...row, width: 760, textAlign: 'center', fontSize: 17, lineHeight: '27px', color: MUTED, marginTop: 10 }}>
          {tier.participant
            ? 'This certificate recognizes participation, sportsmanship and determination shown at '
            : 'This certificate recognizes outstanding play, sportsmanship and determination shown at '}
          <b style={{ color: C.goldLt }}>{tournamentName}</b>, organized by Mate Zone Chess Academy.
        </div>

        {/* Footer */}
        <div style={{ position: 'absolute', left: 290, right: 250, bottom: 96, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 16, color: MUTED }}>
            <div>Position : <b style={{ color: TEXT }}>{tier.text}</b></div>
            {score !== '' && score != null && <div>Score : <b style={{ color: TEXT }}>{score}</b></div>}
            {dateText && <div>Date : <b style={{ color: TEXT }}>{dateText}</b></div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 250, height: 1, background: C.gold }} />
            <div style={{ fontWeight: 700, fontSize: 16, color: TEXT }}>{coachName}</div>
            <div style={{ fontSize: 13, color: MUTED }}>{coachTitle}</div>
          </div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <div style={{ width: 150, height: 1, background: C.gold }} />
          <svg width="26" height="18" viewBox="0 0 46 30" aria-hidden="true"><path d="M3 26 L7 8 L16 17 L23 3 L30 17 L39 8 L43 26 Z" fill={C.goldLt} /></svg>
          <div style={{ width: 150, height: 1, background: C.gold }} />
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 20, textAlign: 'center', fontSize: 12, letterSpacing: 5, color: C.goldLt }}>PLAY • LEARN • GROW</div>

        {/* Badge */}
        <svg width="200" height="270" viewBox="0 0 200 270" style={{ position: 'absolute', right: 80, top: 176 }} role="img" aria-label={`${tier.text} badge`}>
          <defs>
            <linearGradient id={id('tg')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={tier.top} />
              <stop offset="1" stopColor={tier.bottom} />
            </linearGradient>
          </defs>
          <polygon points="58,150 96,150 96,262 77,246 58,262" fill={C.wine} />
          <polygon points="104,150 142,150 142,262 123,246 104,262" fill={C.wineDk} />
          {SCALLOPS.map((s, i) => (<circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r="6.5" fill={url('tg')} />))}
          <circle cx="100" cy="100" r="86" fill={url('tg')} />
          <circle cx="100" cy="100" r="73" fill={C.ink} />
          <circle cx="100" cy="100" r="67" fill="none" stroke={C.goldLt} strokeWidth="1" />
          <g transform="translate(100 100)">
            {LEAVES.map((l) => (<ellipse key={l.a} cx={l.x.toFixed(1)} cy={l.y.toFixed(1)} rx="4.5" ry="10" transform={`rotate(${l.a} ${l.x.toFixed(1)} ${l.y.toFixed(1)})`} fill={tier.top} />))}
          </g>
          <g transform="translate(100 100) scale(-1 1)">
            {LEAVES.map((l) => (<ellipse key={l.a} cx={l.x.toFixed(1)} cy={l.y.toFixed(1)} rx="4.5" ry="10" transform={`rotate(${l.a} ${l.x.toFixed(1)} ${l.y.toFixed(1)})`} fill={tier.top} />))}
          </g>
          <path d="M82 76 L86 60 L94 68 L100 56 L106 68 L114 60 L118 76 Z" fill={tier.top} />
          <text x="100" y="108" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="800" fontSize={tier.big.length > 4 ? 22 : 30} fill={TEXT}>{tier.big}</text>
          <text x="100" y="125" textAnchor="middle" fontFamily="Cinzel, serif" fontSize={tier.small.length > 5 ? 8 : 11} letterSpacing="3" fill={TEXT}>{tier.small}</text>
          <polygon points={starPoints(84, 141)} fill={tier.top} />
          <polygon points={starPoints(100, 141)} fill={tier.top} />
          <polygon points={starPoints(116, 141)} fill={tier.top} />
        </svg>
      </div>
    </div>
  );
}
