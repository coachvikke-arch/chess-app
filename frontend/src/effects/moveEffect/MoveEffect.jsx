/* ── MoveEffect — the "sigma move" overlay ──────────────────────────────────
 *
 * A single master timeline (t in ms from dim start) drives every visual, and
 * the whole thing is written to refs inside one requestAnimationFrame loop, so
 * nothing re-renders per frame and only transforms/opacity/mask are touched.
 *
 * Layers, bottom → top (all inside the board's own square area):
 *   highlights · dim (masked grayscale + tint) · square flashes ·
 *   ghost pieces · flying piece · ripple lens · seal badge · pill · sword
 *
 * The board hides its own pieces while this is mounted (ChessBoard passes
 * `hidePieces` to AnimatedBoard) and this component draws them, which is what
 * makes per-piece wobble possible without touching AnimatedBoard's animation
 * machinery.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CBURNETT_SVGS } from '../../components/cburnettPieces';
import {
  T, RIPPLE, G, WOBBLE, SOUND, CHECKMATE_POPUP_AT_MS, effectConfig,
} from './config.js';
import {
  clamp, invLerp, flightAt, morphScale, badgeScale,
  pillWidthFactor, pillLabelOpacity, pillGlow, swordScale, swordArrowScale,
  pathSquares, squarePoint, sideOf, squareDistance, rippleRadiusSq,
  ripplePassSeconds, rippleOpacity, wobbleAt,
  clampCentered, pillAnchor,
} from './timeline.js';
import { playMoveEffectSound } from '../../utils/sound.js';
import { playMoveEffectHaptics } from './haptics.js';
import { triggerImpact } from '../impactShake.js';
import { isQuietMoveEvent } from '../../utils/moveFeedback.js';
import './moveEffect.css';

const SEAL_POINTS = 24;

/* A scalloped seal: `points` lobes, alternating outer/inner radius. */
function sealPath(size, points = SEAL_POINTS) {
  const c = size / 2;
  const outer = size / 2;
  const inner = outer * 0.86;
  const step = Math.PI / points;
  let d = '';
  for (let i = 0; i < points * 2; i += 1) {
    const angle = -Math.PI / 2 + i * step;
    const radius = i % 2 === 0 ? outer : inner;
    const x = c + Math.cos(angle) * radius;
    const y = c + Math.sin(angle) * radius;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

function rgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  if (Number.isNaN(n)) return `rgba(44,195,165,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export default function MoveEffect({
  effect,
  boardWidth = 420,
  orientation = 'white',
  inset = 0,
  radius = 14,
  pieces = null,
  reduced = false,
  rate = 1,
  seekMs = null,
  audio = true,
  onTime = null,
  onPhase = null,
  onDone = null,
}) {
  useEffect(() => { try { triggerImpact(effect?.type); } catch {} }, [effect?.type]);
  const sq = boardWidth / 8;
  const cfg = effectConfig(effect?.type);

  /* ── static geometry ── */
  const geo = useMemo(() => {
    const fromPt = squarePoint(effect?.from, orientation) || { x: 0, y: 0 };
    const toPt = squarePoint(effect?.to, orientation) || { x: 0, y: 0 };
    const originSquare = cfg.rippleOrigin === 'king'
      ? (effect?.kingSquare || effect?.to)
      : effect?.to;
    const originPt = squarePoint(originSquare, orientation) || toPt;
    const side = toPt.x >= fromPt.x ? 1 : -1;
    const path = pathSquares(effect?.from, effect?.to, effect?.piece, effect?.kingSquare);
    return {
      fromPt, toPt, originPt, originSquare, side, path,
      badgePx: G.badgeSq * sq,
      pillW: G.pillWidthSq * sq,
      pillH: G.pillHeightSq * sq,
      swordPx: G.swordSq * sq,
      arrowPx: G.arrowSq * sq,
    };
  }, [effect?.from, effect?.to, effect?.piece, effect?.kingSquare, cfg.rippleOrigin, orientation, sq]);

  /* ── wobble/flash targets ── */
  const items = useMemo(() => {
    const out = [];
    const origin = geo.originSquare;
    const passMs = (square) => {
      const d = squareDistance(square, origin);
      const s = ripplePassSeconds(d);
      return Number.isFinite(s) ? s * 1000 : Infinity;
    };
    const captured = effect?.captured;
    if (captured && captured.square) {
      out.push({
        key: `cap-${captured.square}`,
        square: captured.square,
        code: captured.code,
        kind: 'captured',
        passMs: passMs(captured.square),
        side: sideOf(captured.square, origin, orientation),
        strong: false,
        state: -1,
      });
    }
    for (const p of effect?.pieces || []) {
      if (!p || !p.square || !p.code) continue;
      if (p.square === effect.to) continue;          // the mover is drawn flying
      out.push({
        key: `g-${p.square}`,
        square: p.square,
        code: p.code,
        kind: 'ghost',
        passMs: passMs(p.square),
        side: sideOf(p.square, origin, orientation),
        strong: Boolean(cfg.strongKingWobble && effect.kingSquare === p.square),
        state: -1,
      });
    }
    return out; // refs are attached by square key below
  }, [effect?.pieces, effect?.captured, effect?.to, effect?.kingSquare, cfg.strongKingWobble, geo.originSquare, orientation]);

  const moverPassMs = useMemo(() => {
    const d = squareDistance(effect?.to, geo.originSquare);
    const s = ripplePassSeconds(d);
    return Number.isFinite(s) ? s * 1000 : Infinity;
  }, [effect?.to, geo.originSquare]);

  const badgeText = effect?.type === 'promotion'
    ? `=${String(effect?.promotionPiece || 'q').toUpperCase()}`
    : cfg.badge;

  /* Badges and text bubbles are suppressed for the quiet events (brilliant,
     checkmate, promotion). The ANIMATION is untouched: the seal, the pill, the
     sacrifice sword and the checkmate bubble are decoration, while the dim, the
     flying piece, the ghost wobble, the ripple, the flashes and the highlights
     are the effect itself. One flag decides it for every surface.

     The "Checkmate" bubble is the ONE exception: a mate is the end of the game,
     so it must say so on the board. Its seal/pill stay off - the bubble already
     carries the word, and the seal would land on the same corner as the board's
     own badge. */
  const quiet = isQuietMoveEvent(effect?.type);

  /* ── element refs ── */
  const rootRef = useRef(null);
  const dimRef = useRef(null);
  const flyRef = useRef(null);
  const flyOldRef = useRef(null);
  const flyNewRef = useRef(null);
  const rippleRef = useRef(null);
  const hlToRef = useRef(null);
  const hlFromRef = useRef(null);
  const sealRef = useRef(null);
  const pillRef = useRef(null);
  const pillLabelRef = useRef(null);
  const swordRef = useRef(null);
  const arrowRef = useRef(null);
  const ghostRefs = useRef(new Map());
  const flashRefs = useRef(new Map());

  /* Checkmate popup: appears once the effect reaches its badge phase and is
     removed with the rest of the overlay by EffectController.cleanup() (a
     move, or the controller's own hold timer). Using a timer (rather than the
     rAF loop) means it still appears with reduced motion, where the timeline
     is not animated. */
  const [showCheckmatePopup, setShowCheckmatePopup] = useState(false);
  useEffect(() => {
    if (effect?.type !== 'checkmate') return undefined;
    const id = setTimeout(() => setShowCheckmatePopup(true), CHECKMATE_POPUP_AT_MS);
    return () => clearTimeout(id);
  }, [effect?.type, effect?.id]);

  /* ── mask prefix (static layers: full cover + path squares) ── */
  const maskStatic = useMemo(() => {
    const image = ['linear-gradient(#000,#000)'];
    const size = ['100% 100%'];
    const position = ['0px 0px'];
    const composite = ['add'];
    const webkitComposite = ['source-over'];
    for (const square of geo.path) {
      const pt = squarePoint(square, orientation);
      if (!pt) continue;
      image.push('linear-gradient(#000,#000)');
      size.push(`${sq}px ${sq}px`);
      position.push(`${(pt.x - 0.5) * sq}px ${(pt.y - 0.5) * sq}px`);
      composite.push('subtract');
      webkitComposite.push('destination-out');
    }
    return { image, size, position, composite, webkitComposite };
  }, [geo.path, orientation, sq]);

  const lastMaskRef = useRef('');
  const phaseRef = useRef(-1);
  const doneRef = useRef(false);
  const settledRef = useRef(false);
  const onPhaseRef = useRef(onPhase);
  const onTimeRef = useRef(onTime);
  const onDoneRef = useRef(onDone);
  onPhaseRef.current = onPhase;
  onTimeRef.current = onTime;
  onDoneRef.current = onDone;

  const renderPiece = (code, square) => {
    const fn = pieces && pieces[code];
    if (typeof fn === 'function') return fn({ squareWidth: sq, square, isDragging: false });
    const svg = CBURNETT_SVGS[code];
    if (!svg) return null;
    return (
      <svg
        viewBox="1 1 43 43"
        width="100%"
        height="100%"
        style={{ display: 'block' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  };

  /* ── the frame writer ── */
  const apply = (rawT) => {
    const t = Math.max(0, rawT);
    const sage = (el, prop, value) => {
      if (el && el.style[prop] !== value) el.style[prop] = value;
    };

    const landed = t >= T.landing;
    const rSq = landed ? rippleRadiusSq((t - T.landing) / 1000) : 0;

    /* phase notifications (also fire when scrubbing backwards) */
    const phase = t >= T.end ? 3 : t >= T.settle ? 2 : landed ? 1 : 0;
    if (phase !== phaseRef.current) {
      phaseRef.current = phase;
      onPhaseRef.current?.(phase);
    }
    if (!doneRef.current && t >= T.end) {
      doneRef.current = true;
      /* The controller unmounts the overlay a beat later; fade it out first so
         the highlights and the badge do not vanish in one frame (the board
         under it has been back since `settle`). */
      rootRef.current?.classList.add('me-exit');
      onDoneRef.current?.();
    }

    if (reduced) {
      /* reduced motion: badge + the two highlights only */
      sage(dimRef.current, 'opacity', '0');
      sage(flyRef.current, 'visibility', 'hidden');
      sage(rippleRef.current, 'opacity', '0');
      sage(pillRef.current, 'opacity', '0');
      sage(swordRef.current, 'opacity', '0');
      sage(arrowRef.current, 'opacity', '0');
      sage(sealRef.current, 'transform', 'translate(-50%,-50%) scale(1)');
      sage(sealRef.current, 'opacity', '1');
      sage(hlToRef.current, 'opacity', '1');
      sage(hlFromRef.current, 'opacity', '1');
      for (const it of items) {
        /* Every moving layer is off; the board keeps its own pieces visible
           (ChessBoard skips `hidePieces` under reduced motion). */
        sage(ghostRefs.current.get(it.key), 'visibility', 'hidden');
      }
      return;
    }

    /* ── dim + masked holes ── */
    const dimIn = invLerp(T.dimStart, T.dimEnd, t);
    const dimAlpha = dimIn * (landed ? rippleOpacity(rSq) : 1);
    sage(dimRef.current, 'opacity', dimAlpha.toFixed(3));

    const dim = dimRef.current;
    if (dim) {
      const feather = 0.42 * sq;
      const holeR = Math.max(0.5, rSq * sq + feather);
      const innerR = Math.max(0, rSq * sq);
      const image = `${maskStatic.image.join(', ')}, radial-gradient(circle at center, transparent 0px, transparent ${innerR.toFixed(1)}px, #000 ${holeR.toFixed(1)}px)`;
      if (image !== lastMaskRef.current) {
        lastMaskRef.current = image;
        const size = `${maskStatic.size.join(', ')}, ${(holeR * 2).toFixed(1)}px ${(holeR * 2).toFixed(1)}px`;
        const position = `${maskStatic.position.join(', ')}, ${(geo.originPt.x * sq - holeR).toFixed(1)}px ${(geo.originPt.y * sq - holeR).toFixed(1)}px`;
        const composite = `${maskStatic.composite.join(', ')}, subtract`;
        const webkitComposite = `${maskStatic.webkitComposite.join(', ')}, destination-out`;
        dim.style.webkitMaskImage = image;
        dim.style.maskImage = image;
        dim.style.webkitMaskSize = size;
        dim.style.maskSize = size;
        dim.style.webkitMaskPosition = position;
        dim.style.maskPosition = position;
        dim.style.webkitMaskRepeat = 'no-repeat';
        dim.style.maskRepeat = 'no-repeat';
        dim.style.webkitMaskComposite = webkitComposite;
        dim.style.maskComposite = composite;
      }
    }

    /* ── flying piece ── */
    const fly = flightAt(t, geo.fromPt, geo.toPt, geo.side);
    let flyTransform = `translate3d(${(fly.x * sq - sq / 2).toFixed(2)}px, ${(fly.y * sq - sq / 2).toFixed(2)}px, 0) scale(${fly.scale.toFixed(4)})`;

    let wob = { rotate: 0, scale: 1 };
    if (landed) {
      const tau = (t - T.landing - moverPassMs) / 1000;
      if (tau >= 0) wob = wobbleAt(tau, sideOf(effect?.to, geo.originSquare, orientation), { strong: false });
    }
    const morph = cfg.morph && landed ? morphScale(t) : 1;
    if (wob.rotate || wob.scale !== 1) {
      flyTransform += ` rotate(${wob.rotate.toFixed(3)}deg) scale(${(wob.scale * morph).toFixed(4)})`;
    } else if (morph !== 1) {
      flyTransform += ` scale(${morph.toFixed(4)})`;
    }
    sage(flyRef.current, 'transform', flyTransform);
    sage(flyRef.current, 'visibility', 'visible');
    sage(flyRef.current, 'filter', landed ? 'none' : 'grayscale(1) brightness(0.62)');

    /* promotion morph: pawn until landing, then the chosen piece */
    if (cfg.morph) {
      const showNew = landed;
      if (flyOldRef.current) sage(flyOldRef.current, 'display', showNew ? 'none' : 'block');
      if (flyNewRef.current) sage(flyNewRef.current, 'display', showNew ? 'block' : 'none');
    }

    /* ── ghost pieces: dimmed until the front arrives ── */
    const settled = t >= T.settle;
    if (settled !== settledRef.current) {
      settledRef.current = settled;
      sage(flyRef.current, 'visibility', settled ? 'hidden' : 'visible');
      for (const it of items) {
        const el = ghostRefs.current.get(it.key);
        if (el) sage(el, 'visibility', settled ? 'hidden' : 'visible');
      }
    }
    for (const it of items) {
      const el = ghostRefs.current.get(it.key);
      const flash = flashRefs.current.get(it.key);
      if (!el) continue;
      if (it.kind === 'captured') {
        const gone = t >= T.captureGone;
        sage(el, 'visibility', gone ? 'hidden' : 'visible');
        if (gone) { if (flash) sage(flash, 'opacity', '0'); continue; }
      }
      const passed = landed && t >= T.landing + it.passMs;
      if (!passed) {
        if (it.state !== 0) {
          it.state = 0;
          sage(el, 'filter', 'grayscale(1) brightness(0.62)');
          sage(el, 'transform', 'none');
          if (flash) sage(flash, 'opacity', '0');
        }
        continue;
      }
      const tau = (t - T.landing - it.passMs) / 1000;
      const w = wobbleAt(tau, it.side, { strong: it.strong });
      sage(el, 'filter', 'none');
      sage(el, 'transform', `rotate(${w.rotate.toFixed(3)}deg) scale(${w.scale.toFixed(4)})`);
      if (flash) {
        const p = clamp((t - T.landing - it.passMs) / RIPPLE.flashMs, 0, 1);
        sage(flash, 'opacity', (0.74 * (1 - p * p)).toFixed(3));
      }
      it.state = 1;
    }

    /* ── ripple lens ── */
    if (rippleRef.current) {
      const op = landed ? rippleOpacity(rSq) : 0;
      sage(rippleRef.current, 'opacity', op.toFixed(3));
      if (op > 0) {
        const scale = rSq / RIPPLE.maxSq;
        sage(rippleRef.current, 'transform', `scale(${scale.toFixed(5)})`);
        const norm = (k) => clamp((rSq + k) / RIPPLE.maxSq, 0, 1) * 100;
        const f1 = norm(RIPPLE.lensStartSq);
        const f2 = norm(RIPPLE.lensPeakSq);
        const f3 = norm(RIPPLE.lensEndSq);
        const bg = `radial-gradient(circle, rgba(255,255,255,0) 0%, rgba(255,255,255,0) ${f1.toFixed(2)}%, rgba(255,255,255,${RIPPLE.lensEdgeAlpha}) ${f1.toFixed(2)}%, rgba(255,255,255,${RIPPLE.lensAlpha}) ${f2.toFixed(2)}%, rgba(255,255,255,0) ${f3.toFixed(2)}%)`;
        sage(rippleRef.current, 'backgroundImage', bg);
      }
    }

    /* ── highlights (removed with the overlay by cleanup) ── */
    const hlOpacity = clamp(invLerp(T.landing, T.landing + 120, t), 0, 1).toFixed(3);
    sage(hlToRef.current, 'opacity', hlOpacity);
    sage(hlFromRef.current, 'opacity', hlOpacity);

    /* ── seal badge ── */
    const seal = badgeScale(t);
    sage(sealRef.current, 'opacity', t < T.landing ? '0' : '1');
    sage(sealRef.current, 'transform', `translate(-50%,-50%) scale(${(reduced ? 1 : seal).toFixed(4)})`);

    /* ── pill ── */
    const pillF = pillWidthFactor(t);
    const label = pillLabelOpacity(t);
    const glow = pillGlow(t);
    sage(pillRef.current, 'opacity', pillF > 0.001 ? '1' : '0');
    sage(pillRef.current, 'transform', `translate(0,-50%) scaleX(${pillF.toFixed(4)})`);
    sage(pillLabelRef.current, 'opacity', label.toFixed(3));
    if (pillRef.current) {
      const g = (0.22 + glow * 0.55).toFixed(3);
      sage(pillRef.current, 'boxShadow', `0 0 ${(5 + glow * 16).toFixed(1)}px ${rgba(cfg.accent, Number(g))}, 0 2px 6px rgba(0,0,0,0.35)`);
    }

    /* ── sacrifice sword + arrow ── */
    if (cfg.sacrificeBadge && effect?.sacrifice) {
      sage(swordRef.current, 'opacity', '1');
      sage(swordRef.current, 'transform', `translate(-50%,-50%) scale(${swordScale(t).toFixed(4)})`);
      const arrow = swordArrowScale(t);
      sage(arrowRef.current, 'opacity', arrow > 0.001 ? '1' : '0');
      sage(arrowRef.current, 'transform', `translate(-50%,-50%) rotate(${G.arrowRotation}deg) scale(${arrow.toFixed(4)})`);
    } else {
      sage(swordRef.current, 'opacity', '0');
      sage(arrowRef.current, 'opacity', '0');
    }
  };

  const applyRef = useRef(apply);
  applyRef.current = apply;

  /* ── clock ── */
  useEffect(() => {
    phaseRef.current = -1;
    doneRef.current = false;
    settledRef.current = false;
    lastMaskRef.current = '';

    if (seekMs != null) {
      applyRef.current(seekMs);
      onTimeRef.current?.(seekMs);
      return undefined;
    }

    let raf = 0;
    let start = 0;
    let lastReport = -1;
    const tick = (now) => {
      if (!start) start = now;
      const t = (now - start) * rate;
      applyRef.current(t);
      if (t - lastReport > 50) {
        lastReport = t;
        onTimeRef.current?.(t);
      }
      if (t < T.end) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [effect?.id, rate, seekMs, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── sound + haptics (once per play; never while scrubbing) ── */
  useEffect(() => {
    if (reduced || seekMs != null || !audio) return undefined;
    const stopSound = playMoveEffectSound({ cue: SOUND, landingMs: T.landing, rate });
    const stopHaptics = playMoveEffectHaptics({ type: effect?.type, rate });
    return () => { stopSound(); stopHaptics(); };
  }, [effect?.id, effect?.type, rate, reduced, seekMs, audio]);

  if (!effect) return null;

  const badgePx = geo.badgePx;
  const cornerX = geo.toPt.x * sq + sq / 2;   // target square's top-right corner
  const cornerY = geo.toPt.y * sq - sq / 2;
  const swordX = geo.toPt.x * sq - sq / 2;    // target square's bottom-left corner
  const swordY = geo.toPt.y * sq + sq / 2;
  const originPx = { x: geo.originPt.x * sq, y: geo.originPt.y * sq };

  /* Every decoration is clamped to the board rect, so an edge square shifts it
     inward instead of letting the board clip eat half of it. */
  const sealPos = clampCentered(cornerX, cornerY, badgePx, badgePx, boardWidth);
  const swordPos = clampCentered(swordX, swordY, geo.swordPx, geo.swordPx, boardWidth);
  const arrowPos = clampCentered(swordX, swordY, geo.arrowPx, geo.arrowPx, boardWidth);
  const pillPos = pillAnchor(sealPos.x, sealPos.y, geo.pillW, geo.pillH, boardWidth);

  /* Checkmate popup is anchored to the MATED KING, not the move target. */
  const kingPt = squarePoint(effect?.kingSquare || effect?.to, orientation) || geo.toPt;
  const mateW = sq * 2.5;
  const mateH = sq * 0.78;
  const matePos = {
    left: clamp(kingPt.x * sq - mateW / 2, 4, boardWidth - mateW - 4),
    top: clamp(kingPt.y * sq - mateH - sq * 0.42, 4, boardWidth - mateH - 4),
  };

  return (
    <div
      ref={rootRef}
      className={`me-root${reduced ? ' me-reduced' : ''}`}
      style={{
        left: inset,
        top: inset,
        width: boardWidth,
        height: boardWidth,
        borderRadius: radius,
      }}
      aria-hidden="true"
    >
      {/* dim: tinted + grayscale, with holes for the path and the ripple front */}
      <div ref={dimRef} className="me-dim" style={{ left: 0, top: 0, width: boardWidth, height: boardWidth, background: G.dimColor }} />

      {/* from-square highlight (light teal) */}
      <div
        ref={hlFromRef}
        className="me-hl"
        style={{
          left: (geo.fromPt.x - 0.5) * sq,
          top: (geo.fromPt.y - 0.5) * sq,
          width: sq,
          height: sq,
          background: rgba(cfg.highlightFrom, 0.55),
          boxShadow: `inset 0 0 0 2px ${rgba(cfg.highlightFrom, 0.95)}`,
        }}
      />
      {/* target-square highlight (accent) */}
      <div
        ref={hlToRef}
        className="me-hl"
        style={{
          left: (geo.toPt.x - 0.5) * sq,
          top: (geo.toPt.y - 0.5) * sq,
          width: sq,
          height: sq,
          background: rgba(cfg.highlightTo, 0.62),
          boxShadow: `inset 0 0 0 3px ${rgba(cfg.highlightTo, 0.98)}, 0 0 ${(sq * 0.5).toFixed(1)}px ${rgba(cfg.highlightTo, 0.55)}`,
        }}
      />

      {/* square flashes — above the dim, below the pieces */}
      {items.map((it) => {
        const pt = squarePoint(it.square, orientation);
        if (!pt) return null;
        return (
          <div
            key={`flash-${it.key}`}
            ref={(el) => {
              if (el) flashRefs.current.set(it.key, el);
              else flashRefs.current.delete(it.key);
            }}
            className="me-flash"
            style={{ left: (pt.x - 0.5) * sq, top: (pt.y - 0.5) * sq, width: sq, height: sq }}
          />
        );
      })}

      {/* ghost pieces (every piece except the mover) */}
      {items.map((it) => {
        const pt = squarePoint(it.square, orientation);
        if (!pt) return null;
        return (
          <div
            key={`ghost-${it.key}`}
            ref={(el) => {
              if (el) ghostRefs.current.set(it.key, el);
              else ghostRefs.current.delete(it.key);
            }}
            className="me-piece"
            style={{ left: (pt.x - 0.5) * sq, top: (pt.y - 0.5) * sq, width: sq, height: sq }}
          >
            {renderPiece(it.code, it.square)}
          </div>
        );
      })}

      {/* the moving piece */}
      <div
        ref={flyRef}
        className="me-piece me-fly"
        style={{ width: sq, height: sq, transformOrigin: WOBBLE.pivot }}
      >
        {cfg.morph ? (
          <>
            <span ref={flyOldRef} className="me-fly-inner">{renderPiece(`${String(effect?.color || 'w')}${String(effect?.piece || 'p').toUpperCase()}`, effect?.from)}</span>
            <span ref={flyNewRef} className="me-fly-inner" style={{ display: 'none' }}>
              {renderPiece(`${String(effect?.color || 'w')}${String(effect.promotionPiece || 'q').toUpperCase()}`, effect?.to)}
            </span>
          </>
        ) : renderPiece(`${String(effect?.color || 'w')}${String(effect?.piece || 'p').toUpperCase()}`, effect?.from)}
      </div>

      {/* ripple lens (glass ring) */}
      <div
        ref={rippleRef}
        className="me-ripple"
        style={{
          left: originPx.x - RIPPLE.maxSq * sq,
          top: originPx.y - RIPPLE.maxSq * sq,
          width: RIPPLE.maxSq * sq * 2,
          height: RIPPLE.maxSq * sq * 2,
        }}
      />

      {/* seal badge on the target square's top-right corner (clamped inward) */}
      {!quiet && (
        <div
          ref={sealRef}
          className="me-seal"
          style={{ left: sealPos.x, top: sealPos.y, width: badgePx, height: badgePx }}
        >
          <svg viewBox={`0 0 ${badgePx} ${badgePx}`} className="me-seal-svg" aria-hidden="true">
            <path
              d={sealPath(badgePx)}
              fill={cfg.seal}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={G.badgeBorderSq * badgePx}
            />
            <circle
              cx={badgePx / 2}
              cy={badgePx / 2}
              r={badgePx * 0.32}
              fill="none"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth={badgePx * 0.055}
            />
          </svg>
          <span className="me-seal-glyph" style={{ fontSize: badgePx * (badgeText.length > 2 ? 0.3 : 0.34), color: '#fff' }}>
            {badgeText}
          </span>
        </div>
      )}

      {/* pill growing away from the badge; flips left near the right edge */}
      {!quiet && (
        <div
          ref={pillRef}
          className="me-pill"
          style={{
            left: pillPos.left,
            top: pillPos.top,
            width: geo.pillW,
            height: geo.pillH,
            transformOrigin: pillPos.origin,
            background: `linear-gradient(90deg, ${cfg.accent}, ${cfg.accentDeep})`,
            borderRadius: geo.pillH / 2,
          }}
        >
          <span
            ref={pillLabelRef}
            className="me-pill-label"
            style={{ fontSize: G.pillFontSq * sq }}
          >
            {cfg.label}
          </span>
        </div>
      )}

      {/* sacrifice sword badge + arrow (brilliant + sacrifice only) */}
      {!quiet && cfg.sacrificeBadge && effect?.sacrifice && (
        <>
          <div
            ref={swordRef}
            className="me-sword"
            style={{
              left: swordPos.x,
              top: swordPos.y,
              width: geo.swordPx,
              height: geo.swordPx,
              border: `${G.swordBorderPx}px solid #fff`,
              background: '#f07a1c',
            }}
          >
            <svg viewBox="0 0 24 24" width="72%" height="72%" aria-hidden="true">
              <path
                d="M4 20l4-1 10-10 1-4-4 1L5 16l-1 4zM13 5l6 6"
                fill="none"
                stroke="#fff"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            ref={arrowRef}
            className="me-sword-arrow"
            style={{ left: arrowPos.x, top: arrowPos.y, width: geo.arrowPx, height: geo.arrowPx }}
          >
            <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
              <path d="M12 21V4M12 4l-6 6M12 4l6 6" fill="none" stroke="#f07a1c" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </>
      )}

      {/* checkmate popup — king-anchored, removed with the overlay on cleanup.
          Deliberately outside the `quiet` gate: this bubble is how a mate is
          announced on the board. */}
      {showCheckmatePopup && effect?.type === 'checkmate' && (
        <div
          className="me-checkmate"
          style={{ left: matePos.left, top: matePos.top, width: mateW, height: mateH }}
        >
          <span className="me-checkmate-dot" aria-hidden="true" />
          Checkmate
        </div>
      )}
    </div>
  );
}
