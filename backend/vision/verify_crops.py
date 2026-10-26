#!/usr/bin/env python3
"""Check that the on-disk crops really match the grid recorded in boards.json.

The labeling workflow has three artifacts that can drift apart: the crops in
debug_dataset/board_NNN/, the manifest grids, and the contact sheets. When
they disagree, a human labels the wrong board and the model is then trained on
labels that describe a different position entirely -- a failure that is
invisible in the accuracy numbers, because both crops and labels are
self-consistent but describe the wrong thing.

This re-extracts every square from the source page using the manifest grid and
compares it to the stored PNG. A large mismatch means the manifest and the
crops were produced by different runs and neither can be trusted for labeling
until the dataset is rebuilt.

Usage:
    python verify_crops.py
"""
import os
import sys
import json

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

FILES = 'abcdefgh'
RANKS = '87654321'

PAGE = os.path.join(HERE, 'debug_import', 'page-1790629424084', 'page.png')
BASE = os.path.abspath(os.path.join(HERE, '..', 'debug_dataset'))


def main():
    with open(os.path.join(BASE, 'boards.json')) as fh:
        manifest = json.load(fh)
    img = cv2.imread(PAGE, cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(f'cannot read page image: {PAGE}')
        return 2

    worst = 0.0
    bad = []
    for b in manifest['boards']:
        bid = b['id']
        x, y, side = b['x'], b['y'], b['side']
        g = b['grid']
        board = img[y:y + side, x:x + side]
        diffs = []
        for r, rank in enumerate(RANKS):
            for c, f in enumerate(FILES):
                sx = int(round(g['ox'] + c * g['s']))
                sy = int(round(g['oy'] + r * g['s']))
                ex = int(round(g['ox'] + (c + 1) * g['s']))
                ey = int(round(g['oy'] + (r + 1) * g['s']))
                fresh = board[max(0, sy):ey, max(0, sx):ex]
                stored = cv2.imread(os.path.join(BASE, bid, f'{f}{rank}.png'),
                                    cv2.IMREAD_GRAYSCALE)
                if fresh.size == 0 or stored is None:
                    continue
                if fresh.shape != stored.shape:
                    fresh = cv2.resize(fresh, (stored.shape[1], stored.shape[0]))
                # Compare by ink content rather than raw bytes: JPEG-free PNGs
                # should be identical, but a resize/resave round trip still
                # means the crop came from different pixels.
                d = float(np.abs(fresh.astype(np.int16)
                                 - stored.astype(np.int16)).mean())
                diffs.append(d)
        if not diffs:
            continue
        m = max(diffs)
        worst = max(worst, m)
        flag = '  <-- MISMATCH' if m > 12 else ''
        print(f'{bid}: mean {np.mean(diffs):6.2f}  max {m:6.2f}{flag}')
        if m > 12:
            bad.append(bid)

    print(f'\nworst single-square difference: {worst:.2f}')
    if bad:
        print('Crops do NOT match the manifest grid for: ' + ', '.join(bad))
        print('The dataset is inconsistent. Re-extract before labeling:')
        print('  python extract_chess_squares.py <page.png> '
              f'--out ..\\debug_dataset --sheet')
    else:
        print('Crops agree with the manifest grid; safe to label from.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
