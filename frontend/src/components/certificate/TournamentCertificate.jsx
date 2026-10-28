/*
 * Tournament certificate artwork (1999 x 1414, A4 landscape at 150 DPI).
 *
 * Everything is plain HTML/CSS/SVG: no text is baked into an image, so the
 * student name, the placing and the score are real text at export time. That is
 * what keeps the PNG/PDF identical to the preview and lets a long name shrink
 * instead of overflowing.
 *
 * The inner .tcert is a fixed 1999x1414 stage; the frame around it is the
 * scaled box the page sees, so the caller only has to decide how wide it may
 * be. `transform: scale()` (not a responsive layout) is deliberate: every
 * ornament, rule and type size is measured in template pixels, exactly like the
 * artwork it mirrors.
 */

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { buildTournamentDescription, plainSegments, TCERT_H, TCERT_W } from '../../utils/tournamentCertificate';
import './tournamentCertificate.css';

const NAME_BASE = 168;
/* The brief's floor: never below 60% of the nominal size. */
const NAME_MIN = Math.round(NAME_BASE * 0.6);
/* The name is squeezed horizontally so that 1180 * 0.84 keeps the visible line
   just inside the 1010px rule beneath it. */
const NAME_MAX_W = 1180;
const NAME_SQUEEZE = 0.84;
/* Never squash past this, even for an absurdly long name. */
const NAME_MIN_SQUEEZE = 0.62;
/* Description type and the width at which it has to give way to the artwork. */
const DESC_BASE = 34;
const DESC_MIN = 26;
const DESC_MAX_W = 1120;

function Segments({ runs }) {
  return runs.map((run, i) => (
    run.bold
      ? <strong key={i} className="tcert-em">{run.text}</strong>
      : <span key={i}>{run.text}</span>
  ));
}

/** Background geometry: diagonal bands, checkerboard and piece watermarks. */
function Backdrop({ uid }) {
  const id = (n) => `${uid}-${n}`;
  const pieces = [
    { g: '♟', x: 470, y: 170, s: 120, r: -6 },
    { g: '♜', x: 1570, y: 190, s: 130, r: 4 },
    { g: '♚', x: 1900, y: 210, s: 140, r: -2 },
    { g: '♝', x: 1930, y: 540, s: 150, r: 6 },
    { g: '♞', x: 1480, y: 700, s: 130, r: -4 },
    { g: '♚', x: 250, y: 900, s: 140, r: 3 },
    { g: '♛', x: 1010, y: 1000, s: 150, r: -3 },
    { g: '♞', x: 720, y: 1280, s: 140, r: 5 },
    { g: '♛', x: 300, y: 1310, s: 130, r: -2 },
  ];

  return (
    <>
      <div className="tcert-bg" />
      <div className="tcert-checker" />
      <svg className="tcert-shapes" viewBox={`0 0 ${TCERT_W} ${TCERT_H}`} aria-hidden="true">
        <defs>
          <linearGradient id={id('left')} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor="#0A2A9C" />
            <stop offset="0.6" stopColor="#0C33A8" />
            <stop offset="1" stopColor="#1550B8" />
          </linearGradient>
          <linearGradient id={id('fanPale')} x1="1999" y1="400" x2="1330" y2="1414" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#D9E6F8" />
            <stop offset="1" stopColor="#93B9EC" />
          </linearGradient>
          <linearGradient id={id('fanCyan')} x1="1999" y1="470" x2="1440" y2="1414" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7AC8E8" />
            <stop offset="1" stopColor="#2EC8F0" />
          </linearGradient>
          <linearGradient id={id('fanMid')} x1="1999" y1="540" x2="1540" y2="1414" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0A6BC8" />
            <stop offset="1" stopColor="#189FE4" />
          </linearGradient>
          <linearGradient id={id('fanNavy')} x1="1620" y1="1414" x2="1999" y2="610" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#12379F" />
            <stop offset="1" stopColor="#002C93" />
          </linearGradient>
          <linearGradient id={id('line')} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0B2A9E" />
            <stop offset="0.6" stopColor="#2E62E8" />
            <stop offset="1" stopColor="#4E7BFF" />
          </linearGradient>
          <clipPath id={id('leftBand')}>
            <polygon points="0,0 372,0 0,990" />
          </clipPath>
          <clipPath id={id('fanNavyClip')}>
            <polygon points="1999,610 1999,1414 1620,1414" />
          </clipPath>
        </defs>

        {/* Left edge: one navy wedge that is widest at the top and tapers out
            before the bottom-left corner. The trims are stroked lines parallel
            to the wedge edge and clipped to it, so nothing spills outside. */}
        <polygon points="0,0 372,0 0,990" fill={`url(#${id('left')})`} />
        <g clipPath={`url(#${id('leftBand')})`}>
          <line x1="168" y1="-20" x2="-212" y2="1060" stroke="#0E86D4" strokeWidth="100" />
          <line x1="115" y1="-20" x2="-265" y2="1060" stroke="#7FF0FF" strokeWidth="11" opacity="0.95" />
          <line x1="330" y1="150" x2="-90" y2="990" stroke="#A9C7F5" strokeWidth="48" opacity="0.4" />
        </g>
        <polyline points="68,912 18,1012" stroke="#2EC8F0" strokeWidth="5" fill="none" opacity="0.55" />
        <polyline points="40,952 5,1040" stroke="#2EC8F0" strokeWidth="4" fill="none" opacity="0.35" />

        {/* Right edge: four nested wedges fanning out of the bottom-right corner,
            each entering the right edge a little higher than the one in front. */}
        <polygon points="1999,400 1999,1414 1330,1414" fill={`url(#${id('fanPale')})`} opacity="0.5" />
        <polygon points="1999,470 1999,1414 1440,1414" fill={`url(#${id('fanCyan')})`} />
        <polygon points="1999,540 1999,1414 1540,1414" fill={`url(#${id('fanMid')})`} />
        <polygon points="1999,610 1999,1414 1620,1414" fill={`url(#${id('fanNavy')})`} />
        <g clipPath={`url(#${id('fanNavyClip')})`}>
          <line x1="1999" y1="742" x2="1652" y2="1470" stroke="#17D2FB" strokeWidth="10" opacity="0.85" />
        </g>
        <polyline points="1512,1414 1700,905" stroke="#2EC8F0" strokeWidth="6" fill="none" opacity="0.5" />
        <polyline points="1590,1414 1760,985" stroke="#2EC8F0" strokeWidth="5" fill="none" opacity="0.35" />

        {/* Corner rules: top-right and bottom-left, as in the artwork */}
        <polyline
          points="560,42 1865,42 1865,205"
          fill="none"
          stroke={`url(#${id('line')})`}
          strokeWidth="5"
          strokeLinecap="round"
        />
        <polyline
          points="105,1165 105,1326 1310,1326"
          fill="none"
          stroke={`url(#${id('line')})`}
          strokeWidth="5"
          strokeLinecap="round"
        />

        <g
          fill="none"
          stroke="#9EC9E9"
          strokeWidth="2.4"
          fontFamily="'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols 2', 'DejaVu Sans', sans-serif"
          fontSize="1"
          opacity="0.45"
        >
          {pieces.map((p, i) => (
            <text
              key={i}
              x={p.x}
              y={p.y}
              fontSize={p.s}
              transform={`rotate(${p.r} ${p.x} ${p.y})`}
            >
              {p.g}
            </text>
          ))}
        </g>
      </svg>
    </>
  );
}

/** The gold rosette and its ribbon tails, centred under the description. */
function Medal({ uid }) {
  const id = (n) => `${uid}-${n}`;
  const cx = 999;
  const cy = 1138;
  /* A scalloped rosette: 28 lobes rather than a smooth ring, as in the artwork. */
  const scallops = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    return { x: cx + Math.cos(a) * 98, y: cy + Math.sin(a) * 98 };
  });
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return { x2: cx + Math.cos(a) * 78, y2: cy + Math.sin(a) * 78 };
  });

  return (
    <svg className="tcert-medal" viewBox="720 960 560 400" aria-hidden="true">
      <defs>
        <linearGradient id={id('gold')} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#F8E7A8" />
          <stop offset="0.45" stopColor="#E3C25C" />
          <stop offset="0.75" stopColor="#C79A2B" />
          <stop offset="1" stopColor="#A87C1C" />
        </linearGradient>
        <radialGradient id={id('coin')} cx="0.36" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#FFF8D6" />
          <stop offset="0.38" stopColor="#F3DA8A" />
          <stop offset="0.72" stopColor="#CFA53C" />
          <stop offset="1" stopColor="#8E6612" />
        </radialGradient>
        <linearGradient id={id('ribbon')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EBCB6C" />
          <stop offset="0.6" stopColor="#D2A93F" />
          <stop offset="1" stopColor="#A97F1C" />
        </linearGradient>
      </defs>

      <polygon points="930,1180 1006,1180 998,1312 966,1278 934,1312" fill={`url(#${id('ribbon')})`} />
      <polygon points="992,1180 1068,1180 1064,1312 1032,1278 1000,1312" fill={`url(#${id('ribbon')})`} opacity="0.9" />

      <circle cx={cx} cy={cy} r="118" fill="#F3D071" opacity="0.12" />
      {scallops.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r="15" fill={`url(#${id('gold')})`} />
      ))}
      <circle cx={cx} cy={cy} r="94" fill={`url(#${id('coin')})`} stroke="#A87C1C" strokeWidth="3" />
      <circle cx={cx} cy={cy} r="82" fill="none" stroke="#FFF3C4" strokeWidth="2" opacity="0.7" />
      {rays.map((r, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={r.x2}
          y2={r.y2}
          stroke="#FFF6D2"
          strokeWidth={i % 2 ? 2 : 5}
          opacity={i % 2 ? 0.16 : 0.28}
        />
      ))}
      <ellipse cx={cx - 28} cy={cy - 36} rx="30" ry="18" fill="#FFFDF0" opacity="0.22" transform={`rotate(-32 ${cx - 28} ${cy - 36})`} />
    </svg>
  );
}

/**
 * @param {object} props
 * @param {object} props.data      output of tournamentCertificateData()
 * @param {number} [props.scale]   rendered size = 1999*scale x 1414*scale
 * @param {React.Ref} [props.innerRef]  the 1999x1414 stage, for export
 */
export default function TournamentCertificate({ data, scale = 1, innerRef, className = '' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const studentName = data?.studentName || '';
  const description = buildTournamentDescription(data || {});
  const descriptionText = plainSegments(description.line1) + plainSegments(description.line2);

  const nameRef = useRef(null);
  const descRefs = [useRef(null), useRef(null)];
  const [nameSize, setNameSize] = useState(NAME_BASE);
  const [nameSqueeze, setNameSqueeze] = useState(NAME_SQUEEZE);
  const [descSize, setDescSize] = useState(DESC_BASE);

  /* Shrink-to-fit, never wrap: a long name must stay on the one line above the
     rule, and a long tournament name must keep both description lines clear of
     the corner artwork. A name that is still too wide at the 60% floor is
     squeezed horizontally rather than allowed to run off the canvas.
     `document.fonts.ready` re-runs it once the serif has actually loaded,
     because measuring against the fallback face would settle on the wrong size. */
  useLayoutEffect(() => {
    let cancelled = false;
    const fits = (el, max, base, min, step) => {
      if (!el) return base;
      let size = base;
      el.style.fontSize = `${size}px`;
      while (size > min && el.scrollWidth > max) {
        size -= step;
        el.style.fontSize = `${size}px`;
      }
      return size;
    };
    const fit = () => {
      const el = nameRef.current;
      const name = fits(el, NAME_MAX_W, NAME_BASE, NAME_MIN, 4);
      const squeeze = el && el.scrollWidth > NAME_MAX_W
        ? Math.max(NAME_MIN_SQUEEZE, NAME_MAX_W / el.scrollWidth)
        : 1;
      descRefs.forEach((ref) => { if (ref.current) ref.current.style.fontSize = `${DESC_BASE}px`; });
      let desc = DESC_BASE;
      while (desc > DESC_MIN && descRefs.some((ref) => ref.current && ref.current.scrollWidth > DESC_MAX_W)) {
        desc -= 1;
        descRefs.forEach((ref) => { if (ref.current) ref.current.style.fontSize = `${desc}px`; });
      }
      if (!cancelled) { setNameSize(name); setNameSqueeze(squeeze); setDescSize(desc); }
    };
    fit();
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => { if (!cancelled) fit(); });
    }
    return () => { cancelled = true; };
  }, [studentName, descriptionText]);

  return (
    <div
      className={`tcert-frame ${className}`}
      style={{ width: TCERT_W * scale, height: TCERT_H * scale }}
    >
      <div
        className="tcert"
        ref={innerRef}
        style={{ width: TCERT_W, height: TCERT_H, transform: `scale(${scale})` }}
      >
        <Backdrop uid={uid} />

        <div className="tcert-brand tcert-grad">MATE ZONE</div>

        <div className="tcert-sub">
          <span className="tcert-rule" />
          <span className="tcert-sub-text">CHESS ACADEMY</span>
          <span className="tcert-rule" />
        </div>

        <div className="tcert-title tcert-grad">CERTIFICATE</div>

        <div className="tcert-achievement">
          <span className="tcert-rule tcert-rule-long" />
          <span className="tcert-diamond" />
          <span className="tcert-achievement-text">OF ACHIEVEMENT</span>
          <span className="tcert-diamond" />
          <span className="tcert-rule tcert-rule-long" />
        </div>

        <div className="tcert-presented">This Certificate Is Presented To</div>

        <div
          className="tcert-name tcert-grad"
          ref={nameRef}
          style={{ fontSize: nameSize, transform: `translateX(-50%) scaleX(${(NAME_SQUEEZE * nameSqueeze).toFixed(3)})` }}
        >
          {studentName}
        </div>

        <div className="tcert-underline" />

        <div className="tcert-desc tcert-desc-1" style={{ fontSize: descSize }}>
          <span className="tcert-desc-inner" ref={descRefs[0]}>
            <Segments runs={description.line1} />
          </span>
        </div>
        <div className="tcert-desc tcert-desc-2" style={{ fontSize: descSize }}>
          <span className="tcert-desc-inner" ref={descRefs[1]}>
            <Segments runs={description.line2} />
          </span>
        </div>

        <div className="tcert-sig tcert-sig-left">
          <span className="tcert-sig-rule" />
          <span className="tcert-sig-value">{data?.dateText}</span>
          <span className="tcert-sig-label">Date</span>
        </div>

        <Medal uid={uid} />

        <div className="tcert-sig tcert-sig-right">
          <span className="tcert-sig-rule" />
          <span className="tcert-sig-value">{data?.coachName}</span>
          <span className="tcert-sig-label">{data?.coachTitle}</span>
        </div>
      </div>
    </div>
  );
}
