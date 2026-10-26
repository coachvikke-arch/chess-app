#!/usr/bin/env python3
"""
Digital-board chess position detector (OpenCV).

Usage:
  python detect_fen.py <image_path> [--debug [output_dir]]

Reads a board image (any size; works best for straight-on digital board
screenshots), finds the 8x8 grid via a checkerboard integral-image search,
then classifies each square:

  * empty vs piece     -> per-cell Otsu on color distance from the square's
                          background colour
  * piece colour       -> closeness of the piece region's colour to the
                          board's light/dark square references
  * piece type         -> trained decision-tree classifier over silhouette
                          shape features (see piece_model.py), covering both
                          printed-workbook schematic glyphs and standard
                          digital piece sprites

Emits JSON to stdout:
  { "fen": "...", "placed": {"e4":"wP", ...}, "occupied": n, "method": "grid" }

If the grid search quality is poor, a contour-based board-corners fallback
warps the board to a square and re-runs the search.
"""

import sys
import json
import re
import os
import numpy as np
import cv2

from piece_model import classify_features as _model_classify

TARGET = 1600        # working image max dimension for the grid search
MAX_CELL = 240       # largest candidate cell size
MIN_CELL = 14        # smallest candidate cell size (px) at TARGET scale
MIN_GRID_SCORE = 150  # acquire the board if the checkerboard fit clears this
RANK_FILES = 'abcdefgh'


# --------------------------------------------------------------------------
# grid search (checkerboard fit)
# --------------------------------------------------------------------------

def integral_img(gray):
    h, w = gray.shape
    ii = np.zeros((h + 1, w + 1), dtype=np.float64)
    np.cumsum(gray, axis=0, out=ii[1:, 1:])
    np.cumsum(ii[1:, 1:], axis=1, out=ii[1:, 1:])
    return ii

def grid_score(ii, ox, oy, s):
    h, w = ii.shape[0] - 1, ii.shape[1] - 1
    # A fractional/rounded grid can hang past the image edge — bail out cheaply
    # instead of indexing out of bounds (an 8x8 grid must fully fit).
    if s < 1 or ox < 0 or oy < 0 or ox + 8 * s > w or oy + 8 * s > h:
        return np.zeros((8, 8), dtype=np.float64), -np.inf
    r = np.arange(9)
    top = oy + r[:-1] * s
    bottom = oy + r[1:] * s
    left = ox + r[:-1] * s
    right = ox + r[1:] * s
    A = ii[top[:, None], left[None, :]]
    B = ii[top[:, None], right[None, :]]
    C = ii[bottom[:, None], left[None, :]]
    D = ii[bottom[:, None], right[None, :]]
    cells = (D - B - C + A) / float(s * s)
    neigh = np.abs(cells[:, 1:] - cells[:, :-1]).sum() + \
            np.abs(cells[1:, :] - cells[:-1, :]).sum()
    far = np.abs(cells[:, 2:] - cells[:, :-2]).sum() + \
          np.abs(cells[2:, :] - cells[:-2, :]).sum()
    return cells, neigh - 1.7 * far

def grid_scores(ii, s, step):
    """Score the stepped offset grid for a fixed cell size `s`.

    Equivalent to running grid_score(ii, ox, oy, s) for every (ox, oy) on the
    coarse sweep's stride (`step = max(3, s // 4)`), as one batched integral
    gather instead of per-offset Python calls. Returns a (No, Nx) score map at
    [oy_count, ox_count]; offset = count * step. Invalid offsets are not
    represented, matching the coarse loop's strictly-"greater" first-max
    tie-break.
    """
    h, w = ii.shape[0] - 1, ii.shape[1] - 1
    maxo = min(h, w) - 8 * s
    if maxo < 0:
        return np.zeros((0, 0), dtype=np.float64)
    od = np.arange(0, maxo + 1, step)
    r = np.arange(9)
    rows = (od[:, None, None, None] + r[None, :, None, None] * s)
    cols = (od[None, None, :, None] + r[None, None, None, :] * s)
    iii = ii[rows, cols]                       # (No, 9, Nx, 9)
    cells = (iii[:, 1:, :, 1:] - iii[:, 1:, :, :-1] -
             iii[:, :-1, :, 1:] + iii[:, :-1, :, :-1]) / float(s * s)
    nh = np.abs(cells[:, :, :, 1:] - cells[:, :, :, :-1]).sum(axis=(1, 3))
    nv = np.abs(cells[:, 1:, :, :] - cells[:, :-1, :, :]).sum(axis=(1, 3))
    fh = np.abs(cells[:, :, :, 2:] - cells[:, :, :, :-2]).sum(axis=(1, 3))
    fv = np.abs(cells[:, 2:, :, :] - cells[:, :-2, :, :]).sum(axis=(1, 3))
    return nh + nv - 1.7 * (fh + fv)


def find_grid(img):
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Coarse sweep on a downscaled copy: the size/offset search is O(sizes x
    # spans^2) with small cells producing huge offset grids, so cap the search
    # at ~224px and let the refinement snap exact boundaries at full res.
    k = min(1.0, 224.0 / min(h, w))
    if k < 1.0:
        sgray = cv2.resize(gray, (int(w * k), int(h * k)),
                           interpolation=cv2.INTER_AREA)
    else:
        sgray = gray

    sh, sw = sgray.shape
    ii = integral_img(sgray)
    best = None
    from_cell = max(12, int(MIN_CELL * k))
    for s in range(from_cell, min(MAX_CELL, int(0.95 * min(sh, sw) / 8)) + 1):
        maxo = min(sh, sw) - 8 * s
        if maxo < 0:
            continue
        step = max(3, s // 4)
        m = grid_scores(ii, s, step)
        if m.size == 0:
            continue
        flat = int(np.argmax(m))
        sc = m.flat[flat]
        if best is None or sc > best[0]:
            oy = (flat // m.shape[1]) * step
            ox = (flat % m.shape[1]) * step
            cells, _ = grid_score(ii, ox, oy, s)
            best = (sc, ox, oy, s, cells)
    if best is None:
        return None
    sc, ox, oy, s, cells = best

    # lift the coarse winner to full resolution; rounding can push the grid
    # a hair past the edge, and the coarse sampler may have stopped a step
    # short of the true bottom-right corner — clamp so it always fits.
    ox = int(round(ox / k))
    oy = int(round(oy / k))
    s = max(MIN_CELL, int(round(s / k)))
    ox = min(ox, w - 8 * s)
    oy = min(oy, h - 8 * s)
    if ox < 0 or oy < 0:
        return None
    ii = integral_img(gray)
    cells, sc = grid_score(ii, ox, oy, s)

    # local refinement, two stages so big cells stay cheap: snap the offset
    # (step 2) over a window sized to the coarse sampling error, then a fine
    # step-1 offset + size pass around the optimum.
    best_cfg = (sc, ox, oy, s, cells)
    ws = s // 4 + 4
    for oy2 in range(max(0, oy - ws), min(h - 8 * s, oy + ws) + 1, 2):
        for ox2 in range(max(0, ox - ws), min(w - 8 * s, ox + ws) + 1, 2):
            c2, sc2 = grid_score(ii, ox2, oy2, s)
            if sc2 > best_cfg[0]:
                best_cfg = (sc2, ox2, oy2, s, c2)
    sc, ox, oy, s, cells = best_cfg
    for s2 in range(max(MIN_CELL, s - 3), min(MAX_CELL, s + 3 + 1)):
        for oy2 in range(max(0, oy - 3), min(h - 8 * s2, oy + 3) + 1):
            for ox2 in range(max(0, ox - 3), min(w - 8 * s2, ox + 3) + 1):
                c2, sc2 = grid_score(ii, ox2, oy2, s2)
                if sc2 > best_cfg[0]:
                    best_cfg = (sc2, ox2, oy2, s2, c2)
    sc, ox, oy, s, cells = best_cfg
    return {'ox': ox, 'oy': oy, 's': s, 'cells': cells, 'score': sc}


# --------------------------------------------------------------------------
# forward/back mapping between working and original image coordinates
# --------------------------------------------------------------------------

def grid_corners_orig(g, scale):
    """4 corners of the found grid in original-image pixel space."""
    o = np.array([
        [g['ox'], g['oy']],
        [g['ox'] + 8 * g['s'], g['oy']],
        [g['ox'] + 8 * g['s'], g['oy'] + 8 * g['s']],
        [g['ox'], g['oy'] + 8 * g['s']],
    ], dtype=np.float32)
    return (o / scale)


def contour_fallback(img):
    """Find the largest near-square quad and warp it flat ('magic' mode)."""
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(g, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    edges = cv2.dilate(edges, None, iterations=1)
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for c in sorted(cnts, key=cv2.contourArea, reverse=True)[:20]:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.03 * peri, True)
        if len(approx) != 4:
            continue
        area = cv2.contourArea(approx)
        if area < 0.05 * h * w:
            continue
        (x, y, ww, hh) = cv2.boundingRect(approx)
        if hh < 20 or ww < 20:
            continue
        if not (0.3 < ww / hh < 3):
            continue
        pts = approx.reshape(4, 2).astype(np.float32)
        pts = order_points(pts)
        if best is None or area > best[0]:
            best = (area, pts)
    if best is None:
        return None
    _, pts = best
    dst = np.array([[512, 0], [512, 512], [0, 512], [0, 0]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(pts, dst)
    flat = cv2.warpPerspective(img, M, (512, 512))
    return flat


def order_points(pts):
    s = pts.sum(axis=1); d = np.diff(pts, axis=1).ravel()
    tl = pts[np.argmin(s)]; br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]; bl = pts[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def contour_fallback_warp(img):
    flat = contour_fallback(img)
    if flat is None:
        return None, None
    g = find_grid(flat)
    if g is None:
        return None, None
    return flat, g


# --------------------------------------------------------------------------
# per-square segmentation + classification
# --------------------------------------------------------------------------

def square_references(cell_medians):
    """The two board square colours (light/dark).

    Each cell contributes its per-channel *median* pixel colour (the piece
    never covers the cell, so the median is the background even when most of
    the board is occupied), then a 2-cluster k-means splits the 64 cells into
    light and dark squares. Robust to a parity having more occupied cells.
    """
    pts = cell_medians.reshape(64, 3).astype(np.float64)
    em = np.arange(8)[:, None] % 2 == np.arange(8)[None, :] % 2
    om = ~em
    c0 = np.median(cell_medians[em], axis=0)
    c1 = np.median(cell_medians[om], axis=0)
    centers = np.array([c0, c1])
    for _ in range(6):
        d0 = np.linalg.norm(pts - centers[0], axis=1)
        d1 = np.linalg.norm(pts - centers[1], axis=1)
        a0 = d0 <= d1
        if a0.sum():
            centers[0] = pts[a0].mean(axis=0)
        if (~a0).sum():
            centers[1] = pts[~a0].mean(axis=0)
    lum = cv2.cvtColor(centers.astype(np.uint8)[None, :, :], cv2.COLOR_BGR2LAB)[0]
    li = int(np.argmax(lum[:, 0]))
    light_ref, dark_ref = centers[li], centers[1 - li]
    light_idx = 0 if np.linalg.norm(c0 - light_ref) <= np.linalg.norm(c1 - light_ref) else 1
    return light_ref, dark_ref, light_idx


def split_square(img, r, c, ox, oy, s):
    return img[oy + r * s: oy + (r + 1) * s, ox + c * s: ox + (c + 1) * s]


def clean_mask(mask):
    """Keep the largest connected component, fill holes."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 1:
        return np.zeros_like(mask)
    sizes = [stats[i, cv2.CC_STAT_AREA] for i in range(1, n)]
    big = int(np.argmax(sizes)) + 1
    comp = (lab == big).astype(np.uint8)
    return cv2.morphologyEx(comp, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))


def silhouette_features(mask):
    """Shape features of the cleaned piece region."""
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    r0, r1 = ys.min(), ys.max() + 1
    c0, c1 = xs.min(), xs.max() + 1
    bh = int(r1 - r0)
    bw = int(c1 - c0)
    m = mask[r0:r1, c0:c1].astype(bool)
    area = int(m.sum())
    compact = area / float(bw * bh) if bw and bh else 0
    aspect = bw / float(bh) if bh else 0
    area_frac = area / float(h * w)

    colprof = m.sum(axis=0)
    rowprof = m.sum(axis=1)
    topk = max(1, int(bh * 0.18))
    top = m[:topk]
    topocc = top.sum() / float(topk * bw) if bw > 0 else 0
    colprof_top = (top.sum(axis=0) > 0)
    runs = 0
    prev = False
    for v in colprof_top:
        if v and not prev:
            runs += 1
        prev = v
    maxrun = 0
    cur = 0
    for v in colprof_top:
        cur = cur + 1 if v else 0
        maxrun = max(maxrun, cur)

    mid = m[int(bh * 0.35): int(bh * 0.65)]
    neck = mid.sum(axis=0) > 0
    minw = int(neck.sum())
    maxw = int((m.sum(axis=0) > 0).sum())

    half = m.shape[1] // 2
    asym_top = float(abs(int(m[:topk, :half].sum()) - int(m[:topk, half:].sum())))
    asym_top /= (area + 1)

    def width_frac(rows):
        if rows.shape[0] == 0 or bw == 0:
            return 0.0
        return int((rows.sum(axis=0) > 0).sum()) / float(bw)

    top_w = width_frac(m[:max(1, int(bh * 0.10))])
    top2_w = width_frac(m[max(1, int(bh * 0.10)): max(2, int(bh * 0.28))])
    mid_w = width_frac(m[int(bh * 0.35): int(bh * 0.65)])
    base_w = width_frac(m[int(bh * 0.70):])

    return {
        'area': area, 'bh': bh, 'bw': bw,
        'compact': compact, 'aspect': aspect, 'area_frac': area_frac,
        'topocc': topocc, 'runs': int(runs), 'maxrun': maxrun / float(bw) if bw else 0,
        'minw': minw / float(bw) if bw else 0, 'maxw': maxw / float(bw) if bw else 0,
        'asym_top': asym_top,
        'top_w': top_w, 'top2_w': top2_w, 'mid_w': mid_w, 'base_w': base_w,
    }


def detect(path, debug_dir=None):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': 'cannot read image'}

    h0, w0 = img.shape[:2]
    scale = 1.0
    work = img
    mx = max(h0, w0)
    if mx > TARGET:
        scale = TARGET / float(mx)
        work = cv2.resize(img, (int(w0 * scale), int(h0 * scale)),
                          interpolation=cv2.INTER_AREA)
    elif mx < 720:
        # Low-resolution crops (or small screenshots) leave cells under ~90px
        # and the shape features get noisy. Lift them to a comfortable cell
        # size first — mirrors detect_diagram's upscale floor.
        scale = 1100.0 / mx
        work = cv2.resize(img, (int(w0 * scale), int(h0 * scale)),
                          interpolation=cv2.INTER_CUBIC)

    g = find_grid(work)
    method = 'grid'
    flat = None
    if g is None or g['score'] < MIN_GRID_SCORE:
        flat, g = contour_fallback_warp(work)
        if g is None:
            return {'error': 'no board found', 'score': g['score'] if g else 0}
        method = 'corners'
        base = flat
        ox = oy = 0
        s = g['s']
        img_units = flat
    else:
        base = work
        ox, oy, s = g['ox'], g['oy'], g['s']
        img_units = work

    # per-square median BGR colours from the found grid (grayscale 'cells' was
    # for the grid search only; median keeps the piece from skewing the ref)
    cell_colors = np.zeros((8, 8, 3), dtype=np.float32)
    for r in range(8):
        for c in range(8):
            win = base[oy + r * s: oy + (r + 1) * s,
                       ox + c * s: ox + (c + 1) * s]
            cell_colors[r, c] = np.median(win.reshape(-1, 3), axis=0)

    light_ref, dark_ref, light_idx = square_references(cell_colors)
    light_ref = light_ref.astype(np.uint8)
    dark_ref = dark_ref.astype(np.uint8)
    sep = float(cv2.norm(light_ref - dark_ref, cv2.NORM_L2))
    bg_by_parity = [light_ref, dark_ref]
    # parity->ref index : (r+c) even -> light_idx, else 1-light_idx
    def parity_ref(r, c):
        even = (r + c) % 2 == 0
        return bg_by_parity[0] if (even == (light_idx == 0)) else bg_by_parity[1]

    # Parity coherence: a real board's squares sit close to their expected
    # light/dark colour and alternate cleanly; text or page content that the
    # grid search happened to "fit" usually does neither. Reported so
    # detect_diagram can reject non-boards with a clear message.
    coherence_matches = 0
    for r in range(8):
        for c in range(8):
            d_light = float(np.linalg.norm(cell_colors[r, c] - light_ref))
            d_dark = float(np.linalg.norm(cell_colors[r, c] - dark_ref))
            near_light = d_light <= d_dark
            parity_light = ((r + c) % 2 == 0) == (light_idx == 0)
            if near_light == parity_light:
                coherence_matches += 1
    coherence = coherence_matches / 64.0

    placed = {}
    confs = {}
    occupied = 0
    dets = []
    featdump = {} if debug_dir is not None else None

    for r in range(8):
        for c in range(8):
            bg = parity_ref(r, c)
            cell = split_square(base, r, c, ox, oy, s)
            # sample an inset region: the found integer grid can sit a pixel
            # off the true (fractional) board phase, leaving a thin ring of
            # the neighbouring square colour; a ~2% margin discards it.
            m = max(1, round(0.02 * s))
            usable = (2 * m < cell.shape[0] and 2 * m < cell.shape[1])
            ins = cell[m:-m, m:-m] if usable else cell
            diff = np.linalg.norm(ins.astype(np.float32) - bg.astype(np.float32), axis=-1)
            diff8 = np.clip(diff, 0, 255).astype(np.uint8)

            # Mask = pixels whose colour differs from the square's background.
            # The floor is scaled to how far the piece actually stands out on
            # THIS square. Deriving it from the board's global light/dark
            # separation alone underestimates the threshold on a washed-out
            # grayscale scan, where paper texture alone clears the bar and every
            # square reads as occupied (measured: 34/64 squares "occupied" on a
            # board holding ~10 pieces, which then trips the legality gate and
            # surfaces as a bogus "no board detected").
            # Per-square contrast = distance from this square's own background to
            # its brightest decile, so an empty (texture-only) square cannot
            # clear the bar while a real piece always can.
            bright = (float(np.percentile(ins.reshape(-1, 3).astype(np.float32), 90, axis=0).mean())
                      if ins.size else 0.0)
            contrast = max(6.0, bright - float(bg.astype(np.float32).mean()))
            thr = max(24.0, 0.16 * sep, 0.45 * contrast)
            mask = diff8 > thr
            mask = clean_mask(mask)
            if mask.shape[0] < 4 or mask.shape[1] < 4:
                mask = np.zeros(mask.shape, dtype=np.uint8)
            farea = float(mask.sum())
            area_frac = farea / float(ins.shape[0] * ins.shape[1])

            sq = RANK_FILES[c] + str(8 - r)
            f = silhouette_features(mask)

            if f is None or area_frac < 0.05:
                if debug_dir is not None:
                    cv2.imwrite(f'{debug_dir}/cell_{sq}_empty.png', diff8)
                    if featdump is not None:
                        featdump[sq] = {'empty': True, 'area_frac': round(area_frac, 4)}
                continue

            cell_full = split_square(base, r, c, ox, oy, s)
            cg = cv2.cvtColor(cell_full, cv2.COLOR_BGR2GRAY)
            full_mask = clean_mask(
                (np.linalg.norm(cell_full.astype(np.float32) -
                                bg.astype(np.float32), axis=-1) > thr).astype(np.uint8))
            # Piece luminance from the piece's BRIGHT side, not its diff mask.
            # A white piece on a light square leaves only a dark outline ring
            # in the mask whose median collapses into the black-army band, and
            # a queen's dark crown drags even a filled white body's median
            # down. The 85th percentile of the mask's grays is the near-body
            # tone: ~250 for white pieces on every square, <= 218 for black
            # pieces, so it separates the armies cleanly even in monochrome
            # worksheets.
            if full_mask.sum() > 0:
                piece_lum = float(np.percentile(cg[full_mask > 0], 85))
            else:
                piece_lum = float(np.median(cg))

            letter, conf = _model_classify(f)
            if letter is None or conf < 0.45:
                continue
            occupied += 1
            dets.append((sq, letter, conf, piece_lum))
            if debug_dir is not None:
                cv2.imwrite(f'{debug_dir}/cell_{sq}_{letter}.png', diff8)
                if featdump is not None:
                    featdump[sq] = {'empty': False,
                                    'lum': round(piece_lum, 1),
                                    'area_frac': round(area_frac, 4),
                                    **{k: round(v, 3) for k, v in f.items()}}

    # Assign piece colours on the p85-brightness scale. Measured across every
    # readable board (color + monochrome, scales 0.8-2.0, sparse + full): the
    # white arm members' near-body percentile is always >= 240 while black
    # pieces never exceed 218, so a fixed threshold separates them cleanly.
    # Split-by-gap heuristics fail here BECAUSE the black band fragments on
    # square parity (e.g. black pawns read ~44 on dark squares and ~96 on
    # light ones), so the largest gap lands *inside* the black band and half
    # the black army turns white.
    #
    # The fixed 230 cutoff only works when some piece actually reaches it. On a
    # washed-out grayscale scan the whole board is re-leveled and the brightest
    # piece tops out around 220, so the old `if max >= 230 else 0.0` fallback
    # fired and put the threshold at 0 — labelling EVERY piece white (measured
    # on the reference page: 3 white kings, 0 black kings, all 40 pieces "white").
    # When the fixed cutoff does not apply, fall back to the midpoint between
    # this position's own dimmest and brightest piece, which separates the two
    # armies for any exposure. A single-army position stays one colour, which is
    # correct — the legality gate is what rejects those, not this threshold.
    lums = np.array([d[3] for d in dets], dtype=np.float64)
    if lums.size == 0:
        thresh = 0.0
    elif lums.max() >= 230.0:
        thresh = 230.0
    else:
        thresh = float((lums.min() + lums.max()) / 2.0)

    for sq, letter, conf, piece_lum in dets:
        is_white = piece_lum > thresh
        placed[sq] = ('w' if is_white else 'b') + letter
        confs[sq] = round(conf, 3)
        if featdump is not None:
            featdump[sq]['pred'] = placed[sq]

    if featdump is not None:
        with open(os.path.join(debug_dir, '_features.json'), 'w') as fh:
            json.dump(featdump, fh, indent=1)

    fen = placed_to_fen(placed)
    return {'fen': fen, 'placed': placed, 'occupied': occupied,
            'method': method, 'score': round(g['score']), 'conf': confs,
            'coherence': round(coherence, 3)}


def placed_to_fen(placed):
    out = []
    for r in range(8):
        row = []
        n = 0
        for c in range(8):
            p = placed.get(RANK_FILES[c] + str(8 - r))
            if p is None:
                n += 1
            else:
                if n:
                    row.append(str(n)); n = 0
                row.append(p[1].upper() if p[0] == 'w' else p[1].lower())
        if n:
            row.append(str(n))
        out.append(''.join(row))
    return '/'.join(out) + ' w - - 0 1'


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    debug_dir = None
    for i, a in enumerate(sys.argv):
        if a == '--debug' and i + 1 < len(sys.argv):
            debug_dir = sys.argv[i + 1]
    if not args:
        print(json.dumps({'error': 'usage: detect_fen.py <image> [--debug dir]'}))
        sys.exit(2)
    try:
        res = detect(args[0], debug_dir)
    except Exception as e:  # noqa
        res = {'error': str(e)}
    print(json.dumps(res))


if __name__ == '__main__':
    main()