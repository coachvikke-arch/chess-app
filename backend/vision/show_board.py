#!/usr/bin/env python3
"""Print the 64 stored crops of a board as a text grid, so a board can be
checked without relying on a rendered sheet being oriented correctly.

Each square is summarised by mean ink and by the fraction of dark pixels:
  '.'  bare square      '#'  dark/solid piece
  'o'  outlined piece   '?'  low contrast, needs a look
"""
import os
import sys

import cv2
import numpy as np

FILES = 'abcdefgh'
RANKS = '87654321'
BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    '..', 'debug_dataset'))


def tile(path):
    t = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if t is None:
        return '?'
    # Ignore the outer 12% where the grid line and neighbouring pieces bleed in.
    m = 12
    h, w = t.shape
    c = t[int(h * m / 100):int(h * (100 - m) / 100),
          int(w * m / 100):int(w * (100 - m) / 100)]
    lo, hi = np.percentile(c, 5), np.percentile(c, 95)
    span = max(1.0, hi - lo)
    contrast = span
    dark = float((c < lo + 0.45 * span).mean())
    if contrast < 28:
        return '?'
    # An outlined piece leaves a moderate amount of dark ink; a solid piece
    # leaves a lot. The split is loose on purpose - this is a triage aid.
    return '#' if dark > 0.16 else ('o' if dark > 0.05 else '.')


def main():
    bid = sys.argv[1] if len(sys.argv) > 1 else 'board_009'
    d = os.path.join(BASE, bid)
    print(f'{bid}   (rows are ranks 8 -> 1, columns files a -> h)')
    print('      ' + ''.join(f'{f:>3}' for f in FILES))
    for r in RANKS:
        cells = []
        for f in FILES:
            cells.append(f'{tile(os.path.join(d, f + r + ".png")):>3}')
        print(f'  {r}  ' + ''.join(cells))


if __name__ == '__main__':
    main()
