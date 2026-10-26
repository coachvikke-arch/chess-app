#!/usr/bin/env python3
"""Decide WHERE the disagreement is: in the labels, or in the square mapping.

`audit_truth.py` reports phantom/missed squares, but a phantom finding alone
cannot tell you whether real_labels.json is wrong or whether extract_chess_squares
is cutting the board in the wrong place. Those two failures look identical from
the label side and need opposite fixes, so this script separates them:

  A. STALENESS  - re-extract every crop and diff it against the committed
     debug_dataset. Any difference means the labels were read off different
     pixels than the ones in the dataset.
  B. ALIGNMENT  - for every square that really does contain a glyph, measure
     the ink centroid's offset from the cell centre. A grid cut in the wrong
     place shifts EVERY glyph in a consistent direction, so the mean offset
     separates "grid is off" from "labels are off".
  C. SEPARATION - the depth distribution of glyph squares vs blank squares, to
     check there is a clean gap a label can be trusted against.
"""
import os
import sys
import json
import argparse

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from build_dataset import fen_to_squares      # noqa: E402
from audit_truth import ink_evidence          # noqa: E402
from extract_chess_squares import locate_boards, refine_grid   # noqa: E402

SQUARES = [f + str(8 - r) for r in range(8) for f in 'abcdefgh']


def centroid_offset(gray, drop=14.0):
    """Offset of the darkest blob from the cell centre, in cell fractions."""
    med = float(np.median(gray))
    mask = (gray < (med - drop)).astype(np.uint8)
    n, lab, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return None
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= 12]
    if not keep:
        return None
    w = np.array([stats[i, cv2.CC_STAT_AREA] for i in keep], float)
    cx = sum(cents[i][0] * wi for i, wi in zip(keep, w)) / w.sum()
    cy = sum(cents[i][1] * wi for i, wi in zip(keep, w)) / w.sum()
    h, wd = gray.shape[:2]
    return ((cx - wd / 2.0) / wd, (cy - h / 2.0) / h)



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--page', default=os.path.join(
        HERE, 'debug_import', 'page-1790629424084', 'page.png'))
    ap.add_argument('--crops', default=os.path.abspath(
        os.path.join(HERE, '..', 'debug_dataset')))
    ap.add_argument('--labels', default=os.path.join(HERE, 'real_labels.json'))
    args = ap.parse_args()

    img = cv2.imread(args.page, cv2.IMREAD_COLOR)
    boxes = locate_boards(img)

    # ---- A. staleness -----------------------------------------------------
    print('=== A. staleness: committed crops vs a fresh extraction ===')
    stale = []
    for i, (x, y, side) in enumerate(boxes, 1):
        bid = f'board_{i:03d}'
        board = img[y:y + side, x:x + side]
        grid = refine_grid(board, side)
        ox, oy, s = grid['ox'], grid['oy'], grid['s']
        diff = 0
        for r in range(8):
            for c in range(8):
                name = 'abcdefgh'[c] + str(8 - r)
                p = os.path.join(args.crops, bid, f'{name}.png')
                if not os.path.isfile(p):
                    stale.append((bid, name, 'MISSING'))
                    continue
                old = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
                y0 = max(0, int(round(oy + r * s)))
                x0 = max(0, int(round(ox + c * s)))
                new = board[y0:y0 + old.shape[0], x0:x0 + old.shape[1]]
                if new.shape != old.shape or not np.array_equal(old, new):
                    diff += 1
        if diff:
            stale.append((bid, f'{diff} squares', 'DIFFERS'))
    print(f'  {len(boxes)} boards re-extracted; {len(stale)} mismatch(es)')
    for row in stale[:12]:
        print('   ', row)
    if not stale:
        print('   debug_dataset matches a fresh extraction exactly.')

    # ---- B. alignment + C. separation ------------------------------------
    with open(args.labels) as fh:
        labels = json.load(fh)['boards']

    print('\n=== B/C. glyph centroid offset and depth separation ===')
    print('    offsets are cell fractions from centre; a grid cut in the')
    print('    wrong place pushes every glyph the same way.')
    all_off, glyph_d, blank_d = [], [], []
    for i, (x, y, side) in enumerate(boxes, 1):
        bid = f'board_{i:03d}'
        info = labels.get(bid, {})
        if not info.get('valid') or not info.get('fen'):
            continue
        offs = []
        for name in SQUARES:
            p = os.path.join(args.crops, bid, f'{name}.png')
            if not os.path.isfile(p):
                continue
            g = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
            if g is None:
                continue
            ev = ink_evidence(g)
            off = centroid_offset(g)
            # depth is the trustworthy "is there a glyph" signal; cstd is not.
            if ev['depth'] >= 25.0:
                glyph_d.append(ev['depth'])
                if off:
                    offs.append(off)
                    all_off.append(off)
            else:
                blank_d.append(ev['depth'])
        if offs:
            mx = float(np.mean([o[0] for o in offs]))
            my = float(np.mean([o[1] for o in offs]))
            print(f'  {bid}: n={len(offs):>2}  mean offset dx={mx:+.3f} dy={my:+.3f}')

    if all_off:
        mx = float(np.mean([o[0] for o in all_off]))
        my = float(np.mean([o[1] for o in all_off]))
        print(f'\n  ALL glyphs: n={len(all_off)} mean dx={mx:+.4f} dy={my:+.4f}')
        bad = abs(mx) > 0.06 or abs(my) > 0.06
        print('  -> ' + ('GRID IS CUT WRONG (systematic offset)' if bad else
                         'grid is sound; any disagreement is in the LABELS'))

    glyph_d, blank_d = np.array(glyph_d), np.array(blank_d)
    if glyph_d.size and blank_d.size:
        lo, hi = blank_d.max(), glyph_d.min()
        print(f'\n  depth  glyph squares: min={hi:.0f} median={np.median(glyph_d):.0f}')
        print(f'  depth  blank squares: max={lo:.0f} 99th pct={np.percentile(blank_d, 99):.0f}')
        if lo < hi:
            print(f'  -> CLEAN GAP: blank <= {lo:.0f} < glyph >= {hi:.0f}; '
                  f'midpoint {((lo + hi) / 2):.0f} separates them perfectly')
        else:
            print('  -> NO CLEAN GAP; occupancy cannot be decided by depth alone')


if __name__ == '__main__':
    main()

    if not stale:
        print('   debug_dataset matches a fresh extraction exactly.')
