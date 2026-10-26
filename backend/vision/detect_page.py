#!/usr/bin/env python3
"""Whole-page chess-diagram scanner.

Usage:
  python detect_page.py <page_image> [--out dir]

Scans a full rendered PDF page for every 8x8 chess diagram it contains and,
for each one found, runs the exact same single-board detector the /detect
endpoint uses (detect_diagram.run_scan), keeping only boards that pass the
legality gates (both kings, <=16 per side, 4..32 pieces).

The page is searched window-by-window because find_grid on a whole sheet of
regularly-spaced diagrams locks onto the "macro checkerboard" the layout forms
and hides the individual boards. Each candidate window is big enough to contain
a board; overlapping results are de-duplicated by coverage (highest score wins).

Emits JSON: { "boxes": [ { "x","y","w","h" (page pixels), "score", "fen",
  "occupied", "method", "coherence", "uncertain" } ] }
"""
import sys
import os
import json
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect_fen as df
import detect_diagram as dd

PAGE_MAX_DIM = 1600        # working page size for scanning
MIN_WIN_SCORE = 150        # a real worksheet board scores ~230; only page
                           # text/noise falls below ~150
WIN_FRAC = 0.5             # window side as a fraction of the min page side
STRIDE_FRAC = 0.25         # window stride as a fraction of the window side
MAX_BOARDS = 32


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0


def find_all_boards(img):
    """Return a list of (score, x, y, side) in img coords, deduplicated."""
    h, w = img.shape[:2]
    win = int(WIN_FRAC * min(h, w))
    stride = max(32, int(win * STRIDE_FRAC))
    # pad so edge windows cover the full page
    pad = win
    padded = np.full((h + 2 * pad, w + 2 * pad, 3), 255, np.uint8)
    padded[pad:pad + h, pad:pad + w] = img

    cands = []
    y = 0
    while y + win <= h + 2 * pad:
        x = 0
        while x + win <= w + 2 * pad:
            win_img = padded[y:y + win, x:x + win]
            g = df.find_grid(win_img)
            if g is not None and g['score'] >= MIN_WIN_SCORE:
                ox = x + g['ox']
                oy = y + g['oy']
                side = 8 * g['s']
                cands.append((g['score'], ox - pad, oy - pad, side))
            x += stride
        y += stride

    cands.sort(key=lambda t: -t[0])
    kept = []
    for score, cx, cy, cs in cands:
        if cs < 96 or cs > 0.75 * min(h, w):  # unreasonably small/big board
            continue
        # A candidate whose box hangs past the real canvas is a phantom grid
        # created by the white padding ring, not a board — drop it.
        if cx < 0 or cy < 0 or cx + cs > w or cy + cs > h:
            continue
        # A window may find the same board with a slightly shifted origin
        # (edge windows especially); the grid fits drift by several cells even
        # when iou is low. Drop anything whose centre falls inside a box we
        # already kept — adjacent boards are never nested like that.
        cxx, cyy = cx + cs / 2.0, cy + cs / 2.0
        nested = any(
            kx <= cxx <= kx + ks and ky <= cyy <= ky + ks for kx, ky, ks in kept)
        if nested:
            continue
        cov = kept and max(
            (iou((cx, cy, cs, cs), (kx, ky, ks, ks)) for kx, ky, ks in kept), default=0)
        if cov and cov > 0.55:
            continue
        kept.append((cx, cy, cs))
        if len(kept) >= MAX_BOARDS:
            break
    return [(round(x, 1), round(y, 1), round(s)) for x, y, s in kept]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out_dir = None
    for i, a in enumerate(sys.argv):
        if a == '--out' and i + 1 < len(sys.argv):
            out_dir = sys.argv[i + 1]
    if not args:
        print(json.dumps({'error': 'usage: detect_page.py <image> [--out dir]'}))
        sys.exit(2)
    src = args[0]
    try:
        img = cv2.imread(src, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f'Could not read image: {src}')
        h0, w0 = img.shape[:2]
        k = min(1.0, PAGE_MAX_DIM / float(max(h0, w0)))
        work = cv2.resize(img, (int(w0 * k), int(h0 * k)),
                          interpolation=cv2.INTER_AREA) if k < 1.0 else img
        wh, ww = work.shape[:2]

        boxes = []
        tmp_dir = out_dir or os.path.dirname(os.path.abspath(src))
        if not os.path.isdir(tmp_dir):
            tmp_dir = '.'
        for cx, cy, cs in find_all_boards(work):
            # full single-board pipeline + legality gates on the cropped board
            # clamp the crop box tight so an edge-touching board (grid lifting
            # past a window boundary) never hands run_scan a non-square slice
            x0 = max(0, min(int(round(cx)), ww - cs)) if cs < ww else int(round(cx))
            y0 = max(0, min(int(round(cy)), wh - cs)) if cs < wh else int(round(cy))
            side = int(round(cs))
            if side < 96:
                continue
            crop = work[y0:y0 + side, x0:x0 + side]
            if crop.shape[0] < 64 or crop.shape[1] < 64:
                continue
            # A grid found in the tight-window search is phase-exact, but the
            # board detector re-runs find_grid and a borderless crop lets the
            # phase drift (garbage readouts). Give the crop a solid margin ring
            # — the same anchoring physics as a real box with page padding.
            pad = max(6, int(round(cs * 0.06)))
            border_px = int(np.median(crop[:2, :, :].reshape(-1, 3), axis=0).mean())
            padded = np.full((crop.shape[0] + 2 * pad, crop.shape[1] + 2 * pad, 3),
                             border_px, np.uint8)
            padded[pad:pad + int(cs), pad:pad + int(cs)] = crop
            board_path = os.path.join(tmp_dir, f'board_{len(boxes) + 1}.png')
            cv2.imwrite(board_path, padded)
            res = dd.run_scan(board_path, out_dir)
            if res.get('error') or not res.get('fen'):
                continue
            boxes.append({
                'x': int(round(x0 / k)), 'y': int(round(y0 / k)),
                'w': int(round(side / k)), 'h': int(round(side / k)),
                'score': res.get('score', 0),
                'fen': res.get('fen'), 'occupied': res.get('occupied'),
                'method': res.get('method', 'grid'),
                'coherence': round(res.get('coherence', 0), 3),
                'uncertain': res.get('uncertain', []),
            })

        print(json.dumps({'w': w0, 'h': h0, 'boxes': boxes}))
    except Exception as e:  # noqa
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()