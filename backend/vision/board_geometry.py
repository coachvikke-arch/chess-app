#!/usr/bin/env python3
"""Chessboard geometry: where the 8x8 grid actually is, and how to read squares.

This module is the single source of truth for board geometry in the vision
pipeline. Nothing else may compute a square's pixel rectangle by hand: callers
use `detect_board_geometry()` to find the grid and `extract_square()` /
`extract_all_squares()` to cut the cells.

Why this exists
---------------
The previous grid search optimised a "checkerboard fit" score over integral
images. That score rewards *any* offset at which neighbouring cell means differ,
which happily locks onto a phase several pixels away from the physical board.
The stored grids were like ox=9 oy=7 s=46 on a crop whose true board sits at
ox~1 oy~1 s~46.8 - every square was cut from the wrong phase, so pieces were
sliced through the middle and bled into their neighbours.

How this finds the grid
-----------------------
Purely from board *structure*, never from the answer:

* **vertical / horizontal boundary strength** - a board is a set of ruled lines.
  For each pixel column the step across the boundary is measured over all rows;
  a ruled boundary spans the whole board so nearly every row steps at it, while
  a glyph edge spans only part of one square. A high percentile over the
  orthogonal axis keeps the rules and drops the artwork.
* **repeated square spacing** - the 9 boundaries of an 8x8 board are one
  arithmetic progression. Instead of trusting any single peak, the search
  maximises the *sum* of profile strength at `off + i*s` for i=0..8, so a
  candidate only wins when all of its lines land on real boundaries. The spacing
  `s` is shared by both axes, which is a strong extra constraint.
* **checkerboard alternation** - the 64 cell backgrounds must fall into exactly
  two tones on a strict (row+col) parity. The score is the separation of the two
  parity classes relative to their robust spread, i.e. a contrast measure, not
  a brightness measurement.
* **boundary consistency / periodicity** - all 7 interior rules per axis must be
  present and comparably strong, and the fitted progression must have low
  residual. A mis-phased grid puts some rules inside square interiors, which
  shows up immediately as weak or missing rules and collapsed parity separation.
* **completeness** - a cropped board is rejected, not fitted. See
  `validate_board_crop`.

Robust statistics are used throughout (median / percentile over the orthogonal
axis, trimmed means, medians of profile samples, and cell backgrounds sampled
from an annulus near the cell border, away from the glyph centre). Raw mean
brightness is never an objective.

Square mapping (mandatory, used everywhere)
-------------------------------------------
    image row 0 -> rank 8      image col 0 -> file a
    image row 7 -> rank 1      image col 7 -> file h

so  a8 -> [0,0]   h8 -> [0,7]   a1 -> [7,0]   h1 -> [7,7].
"""
import numpy as np
import cv2

# --- board / grid constants -------------------------------------------------
N = 8                                  # squares per side
RANKS = ('8', '7', '6', '5', '4', '3', '2', '1')
FILES = 'abcdefgh'
SQUARES = tuple(f + r for r in RANKS for f in FILES)



# ---------------------------------------------------------------------------
# coordinate naming - the only place squares become row/col indices
# ---------------------------------------------------------------------------

def square_index(square):
    """'e4' -> (row, col) with row 0 = rank 8 and col 0 = file a."""
    sq = square.strip().lower()
    if len(sq) != 2 or sq[0] not in FILES or sq[1] not in RANKS:
        raise ValueError('not a square name: %r' % (square,))
    return RANKS.index(sq[1]), FILES.index(sq[0])


def square_name(row, col):
    """(0, 0) -> 'a8', (7, 7) -> 'h1'."""
    if not (0 <= row < N and 0 <= col < N):
        raise ValueError('square index out of range: (%d, %d)' % (row, col))
    return FILES[col] + RANKS[row]


def squares_in_reading_order():
    """All 64 names, a8 first, h1 last - the canonical extraction order."""
    return list(SQUARES)


# ---------------------------------------------------------------------------
# robust board statistics
# ---------------------------------------------------------------------------

def to_gray(board):
    """Float32 grayscale of a BGR/gray crop, lightly denoised."""
    if board is None or board.size == 0:
        raise GeometryError('empty crop', {'reason': 'empty image'})
    gray = (cv2.cvtColor(board[:, :, :3], cv2.COLOR_BGR2GRAY)
            if board.ndim == 3 else board)
    gray = gray.astype(np.float32)
    if min(gray.shape) >= 5:
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
    return gray


def _robust_line_profiles(gray, max_lines=192):
    """Vertical and horizontal ruled-line strength profiles.

    For every pixel column take a high percentile over all rows of the
    horizontal step. A ruled boundary spans the whole board so nearly every row
    steps at it; a glyph edge spans only part of one square so only a few rows
    do. The percentile therefore keeps the rules and discards the artwork. Same
    transposed for horizontal rules.

    Returns (vprof, hprof); index `i` of vprof is the step between pixel
    columns i and i+1, i.e. a boundary at continuous x = i + EDGE_OFFSET.
    """
    h, w = gray.shape
    dx = np.abs(np.diff(gray, axis=1))          # (h, w-1)
    dy = np.abs(np.diff(gray, axis=0))          # (h-1, w)

    step = max(1, int(np.ceil(h / float(max_lines))))
    vprof = np.percentile(dx[::step], 55, axis=0).astype(np.float64)
    step = max(1, int(np.ceil(w / float(max_lines))))
    hprof = np.percentile(dy[:, ::step], 55, axis=1).astype(np.float64)
    return vprof, hprof


def _interp(prof, pos, edge='clip'):
    """Linear interpolation of a 1-D profile at float positions.

    `edge='clip'` (default) clamps to the nearest sample: a ruled boundary
    exactly at the crop edge has no outside neighbour, but its inside step
    is still real evidence. `edge='zero'` returns 0 outside: used only when
    scoring offset hypotheses so a grid running past the crop edge loses.
    """
    n = len(prof)
    pos = np.asarray(pos, dtype=np.float64)
    if edge == 'clip':
        pos = np.clip(pos, 0, n - 1)
        i = np.clip(np.floor(pos).astype(np.int64), 0, max(n - 2, 0))
        f = np.clip(pos - i, 0.0, 1.0)
        out = prof[i] * (1.0 - f) + prof[i + 1] * f
        return out
    out = np.zeros(pos.shape, dtype=np.float64)
    ok = (pos >= 0) & (pos <= n - 1)
    if not np.any(ok):
        return float(out) if out.ndim == 0 else out
    p = pos[ok]
    i = np.clip(np.floor(p).astype(np.int64), 0, max(n - 2, 0))
    f = p - i
    out[ok] = prof[i] * (1.0 - f) + prof[i + 1] * f
    return out


def _axis_scores(prof, offsets, s, idx):
    """Sum of profile strength at `offsets[:,None] + idx[None,:]*s`.

    `edge='clip'`: a rule exactly at the crop edge keeps its inside
    half-step (tight page crops clip the outer frame to the edge).
    Offsets that run any rule past the edge are still excluded by the
    caller (`_fit_offset` keeps only fully-inside hypotheses with the
    outer rules pulled in by EDGE_GUARD).
    """
    pos = offsets[:, None] + np.asarray(idx, dtype=np.float64)[None, :] * s
    return _interp(prof, pos, edge='clip').sum(axis=1)


def _candidate_offsets(prof, s, lo, hi, step):
    """Coarse offset candidates ranked by interior-rule strength.

    Returns (offs, scores): `offs` covers the full [lo, hi] sweep; the true
    grid may sit half a step below the profile peak, so refinement tests the
    peak neighbourhood plus the strongest coarse candidates shifted by -s.
    """
    offs = np.arange(lo, hi + 1e-9, step)
    offs = offs[offs + N * s <= len(prof) - 1 + 1e-9]
    offs = offs[offs >= -s - 1e-9]
    if offs.size == 0:
        return np.empty(0), np.empty(0)
    scores = _axis_scores(prof, offs, s, np.arange(1, N))
    return offs, scores


def _fit_offset_unused(*args, **kwargs):
    """Retired helpers kept as stubs so old imports fail loudly, not silently."""
    raise GeometryError(INVALID_BOARD_CROP + ': retired helper called',
                        {'reason': 'retired-helper'})


_CANDIDATE_OFFSETS = _fit_offset_unused
_REFINE_OFFSET = _fit_offset_unused
_SHIFTED_CANDIDATES = _fit_offset_unused


def _fit_spacing(prof, s_lo, s_hi, coarse_step=0.25, fine_step=0.02):
    """Joint (offset, spacing) fit of an arithmetic progression of rules."""
    idx = np.arange(1, N)                    # the 7 interior rules
    n = len(prof)
    best = None
    for s in np.arange(s_lo, s_hi + 1e-9, coarse_step):
        hi = min(n - 1 - EDGE_OFFSET - N * s, N * s)
        if hi < 0:
            continue
        off, sc = _fit_offset(prof, s, 0.0, hi, idx, coarse_step)
        if off is None:
            continue
        if best is None or sc > best[0]:
            best = (sc, off, s)
    if best is None:
        return None, 0.0

    # local refinement: spacing +-1 coarse step, offset +-2 coarse steps
    _, off, s = best
    d_off = max(coarse_step * 2.0, 0.25)
    d_s = max(coarse_step, 0.05)
    top = None
    for s2 in np.arange(s - d_s, s + d_s + 1e-9, fine_step):
        hi = min(n - 1 - EDGE_OFFSET - N * s2, N * s2)
        if hi < 0:
            continue
        o2, sc = _fit_offset(prof, s2, max(0.0, off - d_off), hi, idx,
                             fine_step)
        if o2 is None:
            continue
        if top is None or sc > top[0]:
            top = (sc, o2, s2)
    if top is None:
        return best[1], best[0]
    return top[1], top[0]

MIN_CELL = 8.0                        # smallest believable square, px
MAX_EDGE_STRENGTH_RATIO = 12.0        # a rule must beat the noise floor by this
MIN_RULE_RATIO = 0.34                 # weakest interior rule, vs the median rule
MIN_OUTER_RULE_RATIO = 0.10           # weakest outer rule, vs the median rule


# ---------------------------------------------------------------------------
# cell background sampling - away from the glyph centre
# ---------------------------------------------------------------------------

def cell_background(gray, ox, oy, s, row, col, inner=0.30, outer=0.46):
    """Robust background level of one square.

    The sample is an annulus between `inner` and `outer` of the cell, i.e. a
    ring near the square border. A chess piece sits in the middle of its
    square, so this ring is background almost everywhere and its median is a
    clean estimate of the square colour even under a large glyph.
    """
    side = max(4, int(round(s)))
    cx = ox + (col + 0.5) * s - EDGE_OFFSET
    cy = oy + (row + 0.5) * s - EDGE_OFFSET
    patch = cv2.getRectSubPix(gray, (side, side), (float(cx), float(cy)))
    ph, pw = patch.shape
    y0 = int(round(inner * ph))
    y1 = max(int(round(outer * ph)), y0 + 1)
    x0 = int(round(inner * pw))
    x1 = max(int(round(outer * pw)), x0 + 1)
    return float(np.median(patch[y0:y1, x0:x1]))


def cell_backgrounds(gray, ox, oy, s):
    """8x8 matrix of per-square background levels, indexed [row][col]."""
    return np.array([[cell_background(gray, ox, oy, s, r, c)
                     for c in range(N)] for r in range(N)], dtype=np.float64)


def _parity():
    return (np.arange(N)[:, None] + np.arange(N)[None, :]) % 2


def alternation(tones):
    """How cleanly the cell backgrounds split into the two checkerboard tones.

    Returns (separation, agreement, score). `separation` is the distance
    between the two parity medians divided by the robust spread of all 64
    values, so it is a contrast ratio and not a brightness measurement.
    `agreement` is the fraction of squares whose background is nearer its own
    parity tone. `score` blends the two into a single 0..1 alternation figure.
    """
    par = _parity()
    a = tones[par == 0]
    b = tones[par == 1]
    if a.size == 0 or b.size == 0:
        return 0.0, 0.0, 0.0
    ma, mb = float(np.median(a)), float(np.median(b))
    spread = float(np.median(np.abs(tones - np.median(tones)))) + 1e-6
    separation = abs(ma - mb) / spread
    agree = 0.5 * float((np.abs(a - ma) < np.abs(a - mb)).mean())
    agree += 0.5 * float((np.abs(b - mb) < np.abs(b - ma)).mean())
    return separation, agree, min(separation / 6.0, 1.0) * agree

MIN_ALTERNATION = 0.55                # parity separation / spread needed
MIN_BOUNDARY_CONSISTENCY = 0.42       # weakest interior rule / median rule

# A boundary seen at profile index `i` sits between pixel columns i and i+1,
# i.e. at continuous x = i + 1.0.  `ox`/`oy` are kept in "pixel centre"
# coordinates (pixel k has centre k), which is 0.5 less, hence EDGE_OFFSET.
EDGE_OFFSET = 0.5


class GeometryError(Exception):
    """Raised when no usable grid can be found in a crop."""

    def __init__(self, message, detail=None):
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


INVALID_BOARD_CROP = 'INVALID_BOARD_CROP'


def _rule_strengths(prof, off, s):
    """Strength of the 9 boundaries off + i*s, i=0..8."""
    pos = off + np.arange(N + 1, dtype=np.float64) * s
    return np.asarray(_interp(prof, pos), dtype=np.float64)


def _shifted_candidates(offs, scores, s, top=3):
    """Best coarse offsets plus copies shifted one square outward (-s).

    The clipped profile peak can sit one square inside the true grid because
    the edge-clipped outer rules score weakly; the -s copies recover it.
    """
    if offs.size == 0:
        return []
    order = np.argsort(scores)[::-1][:top]
    out = []
    for k in order:
        o = float(offs[k])
        out.append(o)
        shifted = o - float(s)
        if shifted >= -float(s) - 1e-9:
            out.append(shifted)
    return out


def _joint_spacing_fit(vprof, hprof, s_lo, s_hi, coarse_step=0.5,
                       fine_step=0.05):
    """One shared square size maximising vertical+horizontal rule sums.

    Each axis is bounded by its own length (crops may be non-square), and
    offsets may start up to one square before the crop edge (tight crops
    clip the outer rule to index -1).

    Every offset hypothesis is scored on the 7 interior rules. The locator box
    tightly frames the board, so the grid origin must sit within ±0.6 squares
    of the crop edge: this physical prior excludes one-square-inward copies
    (which otherwise win when a page-edge artifact inflates an interior peak)
    while keeping every real tight crop (observed |ox|,|oy| < 0.05*s).
    """
    idx_int = np.arange(1, N)
    nv, nh = len(vprof), len(hprof)
    best = None
    for s in np.arange(s_lo, s_hi + 1e-9, coarse_step):
        hiv = min(nv - 1 - 7 * s, 0.6 * s)
        hih = min(nh - 1 - 7 * s, 0.6 * s)
        lov = min(-0.6 * s, hiv)
        loh = min(-0.6 * s, hih)
        if hiv < lov or hih < loh:
            continue
        offs_v = np.arange(lov, hiv + 1e-9, coarse_step)
        offs_h = np.arange(loh, hih + 1e-9, coarse_step)
        if offs_v.size == 0 or offs_h.size == 0:
            continue
        sc_v = _axis_scores(vprof, offs_v, s, idx_int)
        sc_h = _axis_scores(hprof, offs_h, s, idx_int)
        kv = int(np.argmax(sc_v))
        kh = int(np.argmax(sc_h))
        sc = float(sc_v[kv] + sc_h[kh])
        if best is None or sc > best[0]:
            best = (sc, s, float(offs_v[kv]), float(offs_h[kh]))
    if best is None:
        return None
    _, s0, ov0, oh0 = best
    top = None
    for s2 in np.arange(max(s_lo, s0 - coarse_step),
                        min(s_hi, s0 + coarse_step) + 1e-9, fine_step):
        hivr = min(nv - 1 - 7 * s2, 0.6 * s2)
        hihr = min(nh - 1 - 7 * s2, 0.6 * s2)
        lovr = min(-0.6 * s2, hivr)
        lohr = min(-0.6 * s2, hihr)
        if hivr < lovr or hihr < lohr:
            continue
        d = max(coarse_step * 2.0, 0.25)
        idx_int = np.arange(1, N)
        offs_v = np.arange(max(lovr, ov0 - d), min(hivr, ov0 + d) + 1e-9,
                           fine_step)
        offs_h = np.arange(max(lohr, oh0 - d), min(hihr, oh0 + d) + 1e-9,
                           fine_step)
        if offs_v.size == 0 or offs_h.size == 0:
            continue
        sc_v = _axis_scores(vprof, offs_v, s2, idx_int)
        sc_h = _axis_scores(hprof, offs_h, s2, idx_int)
        kv = int(np.argmax(sc_v))
        kh = int(np.argmax(sc_h))
        sc = float(sc_v[kv] + sc_h[kh])
        if top is None or sc > top[0]:
            top = (sc, s2, float(offs_v[kv]), float(offs_h[kh]))
    if top is None:
        return (s0, ov0, oh0, best[0])
    return (top[1], top[2], top[3], top[0])


def validate_board_crop(board, gray, ox, oy, s, v_rules, h_rules, tones,
                        separation, agreement):
    """Reject unless all 8 ranks/files exist. Physical evidence only."""
    h, w = gray.shape
    detail = {'ox': round(float(ox), 2), 'oy': round(float(oy), 2),
              's': round(float(s), 2), 'crop': [int(w), int(h)]}
    tol = 0.30 * s
    if ox < -tol or oy < -tol or ox + N * s > w + tol or oy + N * s > h + tol:
        raise GeometryError(
            INVALID_BOARD_CROP + ': grid extends past crop edge '
            '(incomplete 8th/1st rank or a/h file)',
            dict(detail, reason='grid-outside-crop'))
    interior = np.concatenate([v_rules[1:-1], h_rules[1:-1]])
    med = float(np.median(interior)) + 1e-9
    # Tight page crops clip the board's own outer frame: the physical outer
    # boundary is the crop edge itself, so it cannot produce an inside/outside
    # step.  Validate the 14 interior rules here; the outer extent is checked
    # by the grid-fits-crop test above plus the checkerboard test below.
    outer = np.array([v_rules[0], v_rules[-1], h_rules[0], h_rules[-1]])
    outer_ratio = float(outer.min() / med)
    detail['outer'] = [round(float(v), 2) for v in outer]
    detail['median_rule'] = round(med, 2)
    weakest = float(interior.min() / med)
    consistency = float(np.median(
        [v_rules[1:-1].min() / med, h_rules[1:-1].min() / med]))
    if weakest < MIN_RULE_RATIO or consistency < MIN_BOUNDARY_CONSISTENCY:
        raise GeometryError(
            INVALID_BOARD_CROP + ': inconsistent interior rules '
            '(weakest %.2f, consistency %.2f; spacing not on all files)'
            % (weakest, consistency),
            dict(detail, reason='weak-interior-rules',
                 weakest=round(weakest, 3),
                 consistency=round(consistency, 3)))
    par = _parity()
    a = tones[par == 0]
    b = tones[par == 1]
    ma, mb = float(np.median(a)), float(np.median(b))
    rows_ok = sum(
        abs(float(np.median(tones[r, par[r] == 0])) - ma)
        < abs(float(np.median(tones[r, par[r] == 0])) - mb)
        for r in range(N))
    cols_ok = sum(
        abs(float(np.median(tones[par[:, c] == 0, c])) - ma)
        < abs(float(np.median(tones[par[:, c] == 0, c])) - mb)
        for c in range(N))
    if (separation < 1.0 or agreement < 0.70
            or rows_ok < 6 or cols_ok < 6
            or min(separation / 6.0, 1.0) * agreement < 0.15):
        raise GeometryError(
            INVALID_BOARD_CROP + ': no full-board checkerboard '
            '(sep=%.2f agree=%.2f rows=%d/8 cols=%d/8)' % (
                separation, agreement, rows_ok, cols_ok),
            dict(detail, reason='no-checkerboard',
                 separation=round(float(separation), 3),
                 agreement=round(float(agreement), 3)))
    return {'consistency': consistency, 'outer_ratio': outer_ratio,
            'rows_ok': int(rows_ok), 'cols_ok': int(cols_ok)}


def detect_board_geometry(board_crop):
    """True 8x8 grid of a board crop. Raises GeometryError if clipped."""
    if board_crop is None or getattr(board_crop, 'size', 0) == 0:
        raise GeometryError(INVALID_BOARD_CROP + ': empty crop',
                            {'reason': 'empty image'})
    gray = to_gray(board_crop)
    h, w = gray.shape
    if min(h, w) < N * MIN_CELL:
        raise GeometryError(INVALID_BOARD_CROP + ': crop too small',
                            {'reason': 'crop-too-small'})
    vprof, hprof = _robust_line_profiles(gray)
    # A board crop tightly frames the board: square ~= min/8. The 23px
    # half-period (alternating square tones, not ruled lines) is excluded.
    s_lo = max(MIN_CELL, min(h, w) / 9.5)
    s_hi = min(h, w) / 6.5
    fit = _joint_spacing_fit(vprof, hprof, s_lo, s_hi)
    if fit is None:
        raise GeometryError(INVALID_BOARD_CROP + ': no square spacing',
                            {'reason': 'no-spacing'})
    s, offv, offh, _sc = fit
    ox = offv + EDGE_OFFSET
    oy = offh + EDGE_OFFSET
    v_rules = _rule_strengths(vprof, offv, s)
    h_rules = _rule_strengths(hprof, offh, s)
    tones = cell_backgrounds(gray, ox, oy, s)
    separation, agreement, alt = alternation(tones)
    checks = validate_board_crop(board_crop, gray, ox, oy, s, v_rules,
                                 h_rules, tones, separation, agreement)
    coverage = (N * s) ** 2 / float(h * w)
    confidence = float(np.clip(
        0.55 * min(alt / 0.9, 1.0)
        + 0.30 * min(checks['consistency'] / 0.8, 1.0)
        + 0.15 * min(max(coverage, 0.0) / 0.9, 1.0), 0.0, 1.0))
    return {'ox': float(ox), 'oy': float(oy), 's': float(s),
            'confidence': round(confidence, 4),
            'separation': round(float(separation), 3),
            'agreement': round(float(agreement), 4),
            'rule_strength': round(float(checks['consistency']), 4),
            'alternation': round(float(alt), 4),
            'outer_ratio': round(float(checks['outer_ratio']), 4),
            'crop': [int(w), int(h)], 'method': 'ruled_lines'}


def extract_square(board_crop, geo, square):
    """Crop one named square ('e4') via its geometry (only pixel mapping)."""
    row, col = square_index(square)
    ox, oy, s = float(geo['ox']), float(geo['oy']), float(geo['s'])
    side = max(4, int(round(s)))
    cx = ox + (col + 0.5) * s - EDGE_OFFSET
    cy = oy + (row + 0.5) * s - EDGE_OFFSET
    return cv2.getRectSubPix(board_crop, (side, side),
                             (float(cx), float(cy)))


def extract_all_squares(board_crop, geo):
    """All 64 squares in reading order a8..h1 -> {name: image}."""
    return {sq: extract_square(board_crop, geo, sq)
            for sq in squares_in_reading_order()}


def square_rect(geo, square):
    """Pixel rect [x0,y0,x1,y1] and center (cx,cy) of a square."""
    row, col = square_index(square)
    ox, oy, s = float(geo['ox']), float(geo['oy']), float(geo['s'])
    x0, y0 = ox + col * s, oy + row * s
    return ((x0, y0, x0 + s, y0 + s), (x0 + s / 2.0, y0 + s / 2.0))


def geometry_debug(board_crop, geo, path):
    """Crop + outer boundary + 9+9 rules + a8..h8/a1..h1/ox/oy/s/conf."""
    vis = (board_crop.copy() if getattr(board_crop, 'ndim', 2) == 3
           else cv2.cvtColor(board_crop, cv2.COLOR_GRAY2BGR))
    ox, oy, s = float(geo['ox']), float(geo['oy']), float(geo['s'])
    for i in range(N + 1):
        gx = int(round(ox + i * s - EDGE_OFFSET))
        gy = int(round(oy + i * s - EDGE_OFFSET))
        col = (0, 200, 0) if i in (0, N) else (0, 0, 255)
        th = 2 if i in (0, N) else 1
        cv2.line(vis, (gx, int(round(oy - EDGE_OFFSET))),
                 (gx, int(round(oy + N * s - EDGE_OFFSET))), col, th)
        cv2.line(vis, (int(round(ox - EDGE_OFFSET)), gy),
                 (int(round(ox + N * s - EDGE_OFFSET)), gy), col, th)
    for c in range(N):
        gx = int(round(ox + (c + 0.5) * s - EDGE_OFFSET))
        for txt, yy in ((FILES[c] + '8', oy + 14),
                        (FILES[c] + '1', oy + N * s - 6)):
            cv2.putText(vis, txt, (gx - 12, int(round(yy))),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                        (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(vis, txt, (gx - 12, int(round(yy))),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1,
                        cv2.LINE_AA)
    for r in range(N):
        gy = int(round(oy + (r + 0.5) * s - EDGE_OFFSET)) + 5
        for txt, xx in (('a' + RANKS[r], ox + 3),
                        ('h' + RANKS[r], ox + N * s - 26)):
            cv2.putText(vis, txt, (int(round(xx)), gy),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                        (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(vis, txt, (int(round(xx)), gy),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1,
                        cv2.LINE_AA)
    banner = 'ox=%.1f oy=%.1f s=%.2f conf=%.3f' % (
        ox, oy, s, float(geo.get('confidence', 0)))
    cv2.putText(vis, banner, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(vis, banner, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (0, 0, 0), 1, cv2.LINE_AA)
    cv2.imwrite(path, vis)
    return path


def contact_sheet_64(board_crop, geo, path, cell=96, pad=3):
    """64 tiles: 8 rows rank8-top x 8 files a-h, each labelled."""
    header = 22
    W = N * (cell + pad) + pad
    H = N * (cell + pad) + pad + header
    sheet = np.full((H, W, 3), 245, np.uint8)
    cv2.putText(sheet, 'files a-h ->', (4, 15), cv2.FONT_HERSHEY_SIMPLEX,
                0.42, (0, 0, 0), 1, cv2.LINE_AA)
    squares = extract_all_squares(board_crop, geo)
    for r in range(N):
        for c in range(N):
            name = square_name(r, c)
            tile = cv2.resize(squares[name], (cell, cell),
                              interpolation=cv2.INTER_AREA)
            if tile.ndim == 2:
                tile = cv2.cvtColor(tile, cv2.COLOR_GRAY2BGR)
            y = pad + r * (cell + pad) + header
            x = pad + c * (cell + pad)
            sheet[y:y + cell, x:x + cell] = tile
            cv2.putText(sheet, name, (x + 2, y + 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.40, (0, 0, 255), 1,
                        cv2.LINE_AA)
    cv2.imwrite(path, sheet)
    return path
