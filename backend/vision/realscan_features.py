"""Feature extraction for REAL scanned chess piece crops.

One module owns the representation so training and runtime can never drift
apart: `train_real_model.py` builds vectors with `piece_vector()` and the
detector at inference time calls the exact same function.

Design notes
------------
Scanned puzzle pages differ from digital boards in ways that break the old
pipeline:

* the paper background is not a constant colour,
* squares carry a checker tint whose contrast varies board to board,
* ink is faded, so "dark" is relative to the local square, not absolute,
* white pieces render as *outline* glyphs and black pieces as *solid*
  silhouettes, so stroke weight and interior ink both carry signal,
* pieces rarely fill their square, and glyph placement drifts a few pixels.

So every crop is normalised relative to its own square background, then
described from several complementary views (filled silhouette, edge map,
ink-density profiles) rather than a single thresholded bitmap.
"""

import numpy as np
import cv2

NORM = 32          # normalised glyph size for the silhouette/edge views
PROFILE = 8        # rows/cols in the coarse ink-density profile

# Per-class view weights. Tunable so they can be retuned without editing
# classifier code; see train_real_model.py --report for the score each wins.
VIEW_WEIGHTS = {
    'silhouette': 1.00,
    'edge': 0.85,
    'profile': 0.70,
    'ink': 0.60,
}


def _ring(gray):
    """Outer ring pixels of a square: dominated by bare paper, not glyph."""
    return np.concatenate([
        gray[0, :].ravel(), gray[-1, :].ravel(),
        gray[:, 0].ravel(), gray[:, -1].ravel(),
    ])


def square_background(gray):
    """Robust estimate of the empty-square paper/board level for one square.

    Uses the upper percentile of the outer ring: pieces are centred in the
    square and rarely reach its edge, so the ring stays paper even on a square
    that is mostly ink.
    """
    return float(np.percentile(_ring(gray), 90))


def square_spread(gray):
    """Robust background noise scale, used to derive a relative ink cut.

    A fixed ink threshold is what breaks on faded scans; expressing the cut in
    units of the square's own background spread makes it exposure invariant.
    """
    ring = _ring(gray)
    return max(4.0, float(np.percentile(ring, 75) - np.percentile(ring, 25)))


def ink_mask(gray):
    """Binary ink mask relative to the square's own background.

    Returns (mask, bg, cut). `mask` is True on ink and `cut` is the intensity
    below which a pixel counts as ink. Pixels brighter than the background are
    never ink: printed chess glyphs are always darker than the paper they are
    printed on, regardless of whether the piece is white or black.
    """
    bg = square_background(gray)
    cut = bg - max(3.0 * square_spread(gray), 8.0)
    mask = gray < cut
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n > 1:
        min_area = max(3, int(0.0015 * mask.size))
        keep = np.zeros(n, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
        mask = keep[lab]
    return mask, bg, cut


def glyph_bbox(mask):
    """Bounding box of the ink, or None when the square is empty.

    Touching the square edge is recorded rather than rejected: a real glyph is
    centred and inset, so edge contact usually means a page mark or grid rule,
    which the caller uses as an emptiness hint.
    """
    ys, xs = np.nonzero(mask)
    if ys.size < max(6, int(0.004 * mask.size)):
        return None
    h, w = mask.shape
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    bw, bh = x1 - x0, y1 - y0
    if bw < 3 or bh < 3:
        return None
    return {'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1,
            'touches': bool(y0 <= 0 or x0 <= 0 or y1 >= h or x1 >= w)}


def crop_glyph(gray, bbox, pad=0.04):
    """Crop to the glyph with a small relative margin, preserving aspect.

    The margin keeps the base/shoulder of the glyph, whose shape separates a
    bishop from a pawn more reliably than the crown does.
    """
    h, w = gray.shape
    x0, y0, x1, y1 = bbox['x0'], bbox['y0'], bbox['x1'], bbox['y1']
    mx, my = int(round((x1 - x0) * pad)), int(round((y1 - y0) * pad))
    x0 = max(0, x0 - mx); x1 = min(w, x1 + mx)
    y0 = max(0, y0 - my); y1 = min(h, y1 + my)
    return gray[y0:y1, x0:x1]


def _fit_square(arr, blur=False):
    """Resize preserving aspect ratio into NORM x NORM centred on the frame."""
    a = arr.astype(np.uint8) if arr.dtype != np.uint8 else arr
    if blur:
        a = cv2.GaussianBlur(a, (3, 3), 0)
    h, w = a.shape[:2]
    s = NORM / float(max(h, w))
    nh, nw = max(1, int(round(h * s))), max(1, int(round(w * s)))
    r = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(r, cv2.COLOR_BGR2GRAY) if r.ndim == 3 else r
    out = np.zeros((NORM, NORM), np.uint8)
    oy, ox = (NORM - nh) // 2, (NORM - nw) // 2
    out[oy:oy + nh, ox:ox + nw] = gray
    return out.astype(np.float32)


def to_silhouette(gray_crop):
    """Filled glyph silhouette at NORM x NORM.

    Interior holes are flooded out first, so an outline glyph (white piece)
    becomes a solid shape directly comparable to a filled glyph (black piece).
    """
    g = gray_crop.astype(np.float32)
    ink = (g < float(np.percentile(g, 60))).astype(np.uint8)
    h, w = ink.shape
    inv = (1 - ink).astype(np.uint8)
    ff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(inv, ff, (0, 0), 2)
    holes = ((inv == 1).astype(np.uint8)) * 255
    filled = cv2.bitwise_or(ink * 255, holes)
    return (_fit_square(filled) > 127).astype(np.float32)


def to_edge(gray_crop):
    """Edge/glyph-outline view at NORM x NORM."""
    g = _fit_square(gray_crop.astype(np.float32), blur=True)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.GaussianBlur(cv2.magnitude(gx, gy), (3, 3), 0)
    m = float(mag.max()) or 1.0
    return np.clip(mag / m, 0, 1)




def to_profile(mask):
    """Coarse ink-density row/column profile of a glyph mask.

    Raster detail is too brittle across scan resolutions, but where the ink
    sits vertically and how wide it is at each height separates the six piece
    types well: a knight leans, a rook is a constant-width column, a pawn is a
    small cone, a king/queen flare at the crown.
    """
    h, w = mask.shape
    rows = np.zeros(PROFILE)
    cols = np.zeros(PROFILE)
    step_y = max(1, h // PROFILE)
    step_x = max(1, w // PROFILE)
    for i in range(PROFILE):
        blk = mask[i * step_y:min(h, (i + 1) * step_y), :]
        rows[i] = blk.mean() if blk.size else 0.0
        blk = mask[:, i * step_x:min(w, (i + 1) * step_x)]
        cols[i] = blk.mean() if blk.size else 0.0
    return np.concatenate([rows, cols])


def as_gray(square):
    """Grayscale view of a square crop, whatever the caller's colour space."""
    if square.ndim == 3:
        return cv2.cvtColor(square, cv2.COLOR_BGR2GRAY)
    return square


def body_intensity(gray, bbox):
    """Mean intensity of the glyph's *interior* (paper inside outline glyphs).

    White pieces print as outlines, so the interior stays paper-bright; black
    pieces are solid, so the interior is ink-dark. Compared against the
    square's own background this yields an exposure-independent colour signal
    instead of a fixed brightness cutoff.
    """
    crop = crop_glyph(gray, bbox, pad=-0.10)
    if crop.size == 0:
        return float(gray.mean())
    lo = float(np.percentile(crop, 20))
    hi = float(np.percentile(crop, 80))
    return 0.5 * (lo + hi)


def piece_vector(square, weights=None):
    """Full feature vector for one square crop, or None if the square is empty.

    Returns (vector, meta). `meta` carries the intermediate quantities the
    detector needs for colour and confidence decisions, so those never have to
    re-derive the mask and never disagree with what was classified.
    """
    w = dict(VIEW_WEIGHTS)
    if weights:
        w.update(weights)

    gray = as_gray(square)
    if gray.shape[0] < 8 or gray.shape[1] < 8:
        return None, {}

    mask, bg, cut = ink_mask(gray)
    bbox = glyph_bbox(mask)
    if bbox is None:
        return None, {'empty': True, 'bg': bg, 'cut': cut,
                      'ink_frac': float(mask.mean()), 'touches': False}

    gray_crop = crop_glyph(gray, bbox)
    if min(gray_crop.shape[:2]) < 5:
        return None, {'empty': True, 'bg': bg, 'cut': cut,
                      'ink_frac': float(mask.mean()), 'touches': bool(bbox['touches'])}

    sil = to_silhouette(gray_crop)
    edg = to_edge(gray_crop)
    m = mask[bbox['y0']:bbox['y1'], bbox['x0']:bbox['x1']].astype(np.float32)
    prof = to_profile(m)

    # Ink-fill ratio: an outline (white) glyph is mostly paper inside, a solid
    # (black) glyph is mostly ink. Feeds both the vector and the colour test.
    ink_frac = float(m.mean()) if m.size else 0.0
    third = max(1, m.shape[0] // 3)
    ink_feat = np.array([
        ink_frac,
        1.0 - ink_frac,
        min(1.0, ink_frac / 0.5),
        m.shape[1] / float(m.shape[0]) if m.shape[0] else 0.0,
        float(np.mean(m[:third])) if m.size else 0.0,
        float(np.mean(m[-third:])) if m.size else 0.0,
    ])

    vec = np.concatenate([
        sil.ravel() * w['silhouette'],
        edg.ravel() * w['edge'],
        prof * w['profile'],
        ink_feat * w['ink'],
    ]).astype(np.float32)

    meta = {
        'empty': False,
        'bg': bg,
        'cut': cut,
        'ink_frac': ink_frac,
        'glyph_h': bbox['y1'] - bbox['y0'],
        'glyph_w': bbox['x1'] - bbox['x0'],
        'square': int(gray.shape[0]),
        'touches': bool(bbox['touches']),
        'body': body_intensity(gray, bbox),
    }
    return vec, meta

