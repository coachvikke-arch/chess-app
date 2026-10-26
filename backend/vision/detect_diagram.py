#!/usr/bin/env python3
"""
PDF diagram position detector — preprocessing wrapper for detect_fen.

Usage:
  python detect_diagram.py <image_path> [--out <output_dir>]

Aims the grid detector at crops extracted from (possibly scanned/blurry) PDFs:
  * grayscale
  * percentile auto-level (stretch highlights/shadows that PDF scans wash out)
  * upscale small crops so the grid search has ≥~14px cells to work with
  * unsharp mask to sharpen fuzzy diagram edges

Then runs the unchanged `detect_fen` pipeline (grid search + contour fallback)
and prints the same JSON shape to stdout:
  { "fen": "...", "placed": {...}, "occupied": n, "method": "grid"... }

Emits { "error": "..." } (exit 1) when the detector itself fails, and a
`warning` field when recognition was doubtful (e.g. an unrealistic piece count),
so callers can mark the crop for manual review.
"""

import sys
import os
import json
import numpy as np
import cv2

import detect_fen

TARGET_MAX_DIM = 160    # upscale floor: only crops smaller than this get enlarged
AUTO_PCT = (2, 98)      # auto-level percentiles
AUTO_MIN_RANGE = 128    # already-high-contrast crops are left alone (below)
UNSHARP_AMOUNT = 0.6    # strength of the sharpen pass (blurry crops only)
SHARP_MIN = 120         # Laplacian variance (224px) below which a crop is blurry


def preprocess(src_path, dst_path):
    """Normalize one crop and write the BGR image detection runs on.

    Unlike the old version this STAYS IN COLOR end-to-end. The old pipeline
    flattened to grayscale and re-expanded, which destroyed the colour signal
    the white/black piece heuristic depends on (white bodies vs light squares
    are only ~18 grey levels apart on lichess-style boards, but far apart in
    colour) — sparse positions like kings or lone queens got dropped entirely.
    detect_fen converts internally when it needs luminance, so nothing is lost.
    """
    img = cv2.imread(src_path, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f'Could not read image: {src_path}')

    # Upscale only minuscule crops so cell sizes land above the 14px floor.
    # Larger crops are left native: the grid search downscales internally for
    # its coarse sweep, and over-enlarging small crops (e.g. 200px -> 1100px)
    # makes preprocessing halo win the checkerboard objective and the detected
    # phase drifts off the squares, producing garbage like 50+ placeholder
    # symbols instead of the real position.
    h, w = img.shape[:2]
    largest = max(h, w)
    if largest < TARGET_MAX_DIM and largest > 0:
        scale = TARGET_MAX_DIM / largest
        img = cv2.resize(img, (int(round(w * scale)), int(round(h * scale))),
                         interpolation=cv2.INTER_AREA)

    # Auto-level: stretch the 2–98 percentile range onto 0–255. Fixes the
    # washed-out low-contrast look of scanned textbooks and grayscale prints.
    # BUT only when the crop is genuinely low-contrast: clean digital diagrams
    # already span most of the histogram, and stretching them bleaches the
    # light squares to 255 — which flips the white/black piece heuristic and
    # makes sparse positions (kings, lone pieces) fall under the occupancy
    # threshold. A crop whose 2–98 range is already wide (>AUTO_MIN_RANGE) is
    # left in original colours.
    lo, hi = np.percentile(img, AUTO_PCT)
    if hi - lo < AUTO_MIN_RANGE - 1:
        img = np.clip((img.astype(np.float32) - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.uint8)

    # Unsharp mask — crispens blurry diagram edges. But ONLY when the crop is
    # actually blurry: applied unconditionally it re-weights the checkerboard
    # phase objective on clean small diagrams too, drifting the grid off the
    # squares (canvas -1 reads as 50+ placeholder pieces). Measured up-front on
    # a fixed size so the threshold is resolution-independent.
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    n = cv2.resize(gray, (224, 224), interpolation=cv2.INTER_AREA)
    sharpness = float(cv2.Laplacian(n, cv2.CV_64F).var())
    if sharpness < SHARP_MIN:
        blur = cv2.GaussianBlur(img, (0, 0), 2.0)
        img = cv2.addWeighted(img, 1.0 + UNSHARP_AMOUNT, blur, -UNSHARP_AMOUNT, 0)

    cv2.imwrite(dst_path, img)
    return img


def run_scan(src, out_dir=None):
    """Preprocess + detect one crop and shape the result as the API returns it.

    Returns the JSON-able dict the controller relies on: { fen, occupied,
    method, warning, uncertain } or { error, fen: null }. Shared by the CLI,
    the backend (spawns detect_diagram.py) and the vision regression tests so
    every consumer exercises the exact same production path.
    """
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    pre = os.path.join(out_dir or os.path.dirname(os.path.abspath(src)) or '.', '_preprocessed.png')
    preprocess(src, pre)
    res = detect_fen.detect(pre, out_dir)

    # Warp/failure guards: score of 0 or an impossible piece count means the
    # crop probably wasn't a clean board — flag it for the review step.
    # One cheap legality invariant catches the rest: every chess diagram has
    # exactly one king per side and never more than 16 pieces per side, so a
    # grid landing on page text (random glyphs read as pieces, promotions run
    # amok) almost always breaks one of those rules. A >32 total is guaranteed
    # page garbage since a real position cannot exceed 16 per side.
    fen = (res.get('fen') or '').strip()
    ranks = fen.split(' ')[0] if fen.split(' ') else ''
    wk = fen.count('K')
    bk = fen.count('k')
    wp = sum(c in 'QRBNP' for c in ranks if c != '/') if ranks else 0
    bp = sum(c in 'qrbnp' for c in ranks if c != '/') if ranks else 0
    occupied = int(res.get('occupied', 0))
    if occupied == 0 or occupied > 32 or wk != 1 or bk != 1 or wp > 16 or bp > 16:
        res = {'error': 'No board detected in this crop — try a tighter rectangle.', 'fen': None}
    else:
        warning = None
        if occupied < 4 or occupied > 32:
            warning = f'{occupied} pieces found — the diagram crop may be off.'
        if warning:
            res['warning'] = warning

    # Keep the output small: drop the placed map unless debugging, and
    # surface an `uncertain` list (low-confidence piece reads) instead so
    # the review UI can highlight squares that may need a human check.
    if out_dir:
        res.pop('placed', None)
    else:
        res['_pieces'] = len(res.get('placed', {}))
        res.pop('placed', None)
    conf = res.pop('conf', None) or {}
    res['uncertain'] = [sq for sq, c in sorted(conf.items()) if c < 0.8]
    return res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out_dir = None
    for i, a in enumerate(sys.argv):
        if a == '--out' and i + 1 < len(sys.argv):
            out_dir = sys.argv[i + 1]
    if not args:
        print(json.dumps({'error': 'usage: detect_diagram.py <image> [--out dir]'}))
        sys.exit(2)

    try:
        print(json.dumps(run_scan(args[0], out_dir)))
    except Exception as e:  # noqa
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()