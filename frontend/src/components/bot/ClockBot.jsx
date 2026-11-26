import { useEffect, useRef } from "react";
import "./ClockBot.css";

/** The clock-face bot. Pure SVG + CSS, no images.
 *  <ClockBot mood="happy" size={160} follow />
 *  mood: neutral | happy | sad | angry | scared | surprised | disgusted
 *  follow: pupils follow the pointer (idle / happy only) */
export default function ClockBot({ mood = "neutral", size = 160, follow = false, className = "", poked = false, act = "", label = "Chess bot" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!follow) return;
    const el = ref.current;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.33);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(d / 120, 1) * 4.5;
      el.style.setProperty("--px", (dx / d) * k);
      el.style.setProperty("--py", (dy / d) * k);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [follow]);

  return (
    <svg ref={ref} className={`cb ${poked ? "poked" : ""} ${className}`} data-mood={mood} data-act={act || undefined} viewBox="0 0 200 270"
         width={size} height={size * 1.35} role="img" aria-label={`${label}: ${mood}`}>
<defs>
<radialGradient id="cbFace" cx="38%" cy="28%" r="80%"><stop offset="0" stopColor="#eefaff"/><stop offset=".55" stopColor="#9edcff"/><stop offset="1" stopColor="#46aef0"/></radialGradient>
<radialGradient id="cbFaceRed" cx="38%" cy="28%" r="80%"><stop offset="0" stopColor="#fff1ee"/><stop offset=".55" stopColor="#ff9b8c"/><stop offset="1" stopColor="#e03a2f"/></radialGradient>
<filter id="cbGlow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#2fb0ff" floodOpacity=".85"/></filter>
<filter id="cbGlowRed" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#ff4a3a" floodOpacity=".85"/></filter>
</defs>
<g className="cb-body">
<ellipse className="cb-sh" cx="100" cy="259" rx="54" ry="8"/>
<path className="cb-leg lg-l" d="M86 142 L84 238"/><path className="cb-leg lg-r" d="M114 142 L116 238"/>
<g className="cb-shoe sh-l"><ellipse cx="76" cy="246" rx="24" ry="13"/><path d="M60 242 q10 -8 22 -4"/></g>
<g className="cb-shoe sh-r"><ellipse cx="124" cy="246" rx="24" ry="13"/><path d="M108 238 q12 -4 22 4"/></g>
<circle className="cb-face" cx="100" cy="88" r="64"/>
<circle cx="100" cy="88" r="57" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2"/>
<path className="cb-tick" d="M100 31 V41 M37 88 H47 M153 88 H163"/>
<g transform="translate(80 54)"><path className="brow bl" d="M-14 2 Q0 -5 14 2"/></g>
<g transform="translate(120 54)"><path className="brow br" d="M-14 2 Q0 -5 14 2"/></g>
<g transform="translate(80 80)"><g className="eyeS"><g className="eye"><ellipse className="sc" rx="15" ry="18"/><g className="pupil"><circle r="9.5" fill="#2a74dc"/><circle r="5.5" fill="#0b2a66"/><circle cx="-3" cy="-4" r="2.8" fill="#fff"/></g><path className="lash" d="M-14 -9 l-7 -3 M-15 -3 l-8 0"/></g><g className="dz"><path d="M0 0 a2.5 2.5 0 1 1 5 0 a5 5 0 1 1 -10 0 a8 8 0 1 1 16 0 a12 12 0 1 1 -22 0"/></g></g></g>
<g transform="translate(120 80)"><g className="eyeS"><g className="eye"><ellipse className="sc" rx="15" ry="18"/><g className="pupil"><circle r="9.5" fill="#2a74dc"/><circle r="5.5" fill="#0b2a66"/><circle cx="-3" cy="-4" r="2.8" fill="#fff"/></g><path className="lash" d="M14 -9 l7 -3 M15 -3 l8 0"/></g><g className="dz"><path d="M0 0 a2.5 2.5 0 1 1 5 0 a5 5 0 1 1 -10 0 a8 8 0 1 1 16 0 a12 12 0 1 1 -22 0"/></g></g></g>
<g className="sq"><path d="M64 68 L94 80 L64 92"/><path d="M136 68 L106 80 L136 92"/></g>
<g className="m m-neutral"><path className="ln" d="M88 116 Q100 126 112 116"/></g>
<g className="m m-happy"><path className="dk" d="M78 106 Q100 152 122 106 Z"/><path className="tg" d="M90 128 Q100 118 110 128 Q100 142 90 128Z"/></g>
<g className="m m-sad"><path className="ln" d="M86 128 Q100 112 114 128"/></g>
<g className="m m-angry"><path className="dk" d="M82 126 Q100 106 118 126 L112 134 Q100 127 88 134 Z"/></g>
<g className="m m-scared"><ellipse className="dk" cx="100" cy="128" rx="14" ry="16"/><ellipse className="tg" cx="100" cy="136" rx="8" ry="5"/></g>
<g className="m m-surprised"><ellipse className="dk" cx="100" cy="127" rx="6" ry="9"/></g>
<g className="m m-disgusted"><path className="dk" d="M80 124 Q100 112 120 124 Q112 132 100 130 Q88 132 80 124Z"/><path className="tg" d="M92 128 Q95 150 106 146 Q113 138 108 128 Z"/></g>
<g className="m m-think"><path className="ln" d="M90 121 Q100 126 110 121"/></g>
<g className="m m-sleep"><ellipse className="dk" cx="100" cy="124" rx="5" ry="3.5"/></g>
<g className="fx fx-sad"><path className="tear" d="M70 100 q-7 13 0 17 q7 -4 0 -17z"/><path className="tear t2" d="M130 100 q-7 13 0 17 q7 -4 0 -17z"/></g>
<g transform="translate(158 26)"><g className="fx fx-rad"><rect x="-3" y="-34" width="6" height="22" rx="2" transform="rotate(20)"/><rect x="-3" y="-34" width="6" height="22" rx="2" transform="rotate(50)"/><rect x="-3" y="-34" width="6" height="22" rx="2" transform="rotate(80)"/></g></g>
<g className="fx fx-angry"><polygon points="150,14 163,30 156,30 168,50 148,32 156,32"/><polygon points="172,10 180,22 175,22 182,34 170,24 175,24"/></g>
<g className="fx fx-scared"><path d="M20 112 q7 -7 0 -14 q-7 -7 0 -14 M20 152 q7 -7 0 -14 q-7 -7 0 -14"/><path d="M180 112 q-7 -7 0 -14 q7 -7 0 -14 M180 152 q-7 -7 0 -14 q7 -7 0 -14"/></g>
<g transform="translate(150 24)"><g className="fx fx-steam"><path d="M0 0 q-7 -8 0 -16 q7 -8 0 -16"/><path className="s2" d="M13 0 q-7 -8 0 -16 q7 -8 0 -16"/><path className="s3" d="M26 0 q-7 -8 0 -16 q7 -8 0 -16"/></g></g>
<g transform="translate(150 32)"><g className="fx fx-think"><circle cx="0" cy="0" r="4"/><circle cx="13" cy="-8" r="3"/><circle cx="24" cy="-14" r="2"/></g></g>
<g transform="translate(146 18)"><g className="fx fx-sleep"><path d="M0 0 h12 l-12 14 h12"/><path d="M16 -16 h9 l-9 10 h9"/><path d="M31 -30 h6 l-6 7 h6"/></g></g>
<g transform="translate(18 30)"><g className="fx fx-notes"><g className="note"><rect x="0" y="0" width="3.5" height="16" rx="1.6"/><circle cx="-5" cy="18" r="4.5"/></g><g className="note n2"><rect x="17" y="-12" width="3.5" height="16" rx="1.6"/><circle cx="12" cy="6" r="4.5"/></g></g></g>
<g className="fx fx-dizzy"><polygon className="star" points="0,-7 1.8,-2.2 6.8,-2.2 2.8,1 4.4,5.8 0,3 -4.4,5.8 -2.8,1 -6.8,-2.2 -1.8,-2.2" transform="translate(100 8)"/><polygon className="star" points="0,-7 1.8,-2.2 6.8,-2.2 2.8,1 4.4,5.8 0,3 -4.4,5.8 -2.8,1 -6.8,-2.2 -1.8,-2.2" transform="translate(64 20) scale(.8)"/><polygon className="star" points="0,-7 1.8,-2.2 6.8,-2.2 2.8,1 4.4,5.8 0,3 -4.4,5.8 -2.8,1 -6.8,-2.2 -1.8,-2.2" transform="translate(136 20) scale(.8)"/></g>
<g transform="translate(52 118)"><g className="arm al"><g className="pump"><path className="armp" d="M0 0 L0 36"/><g className="glove" transform="translate(0 46)"><g className="fin"><ellipse cx="-9" cy="11" rx="4.5" ry="8" transform="rotate(25 -9 11)"/><ellipse cx="0" cy="14" rx="4.5" ry="8"/><ellipse cx="9" cy="11" rx="4.5" ry="8" transform="rotate(-25 9 11)"/></g><circle r="11"/></g></g></g></g>
<g transform="translate(148 118)"><g className="arm ar"><g className="pump"><path className="armp" d="M0 0 L0 36"/><g className="glove" transform="translate(0 46)"><g className="fin"><ellipse cx="-9" cy="11" rx="4.5" ry="8" transform="rotate(25 -9 11)"/><ellipse cx="0" cy="14" rx="4.5" ry="8"/><ellipse cx="9" cy="11" rx="4.5" ry="8" transform="rotate(-25 9 11)"/></g><circle r="11"/></g></g></g></g>
</g>
    </svg>
  );
}
