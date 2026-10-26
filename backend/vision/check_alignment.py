#!/usr/bin/env python3
"""Detect whether each board's ground-truth FEN is misaligned with its crops.

The labels in real_labels.json were transcribed by hand from contact sheets.
The crops were later re-extracted by a later run of extract_chess_squares.py,
and for some boards the refined grid landed a square lower than it did the
first time. A label set that is one rank off is worse than a wrong piece type:
every piece is wrong, and nothing in the training output reveals it, because
the model simply learns the shifted world.

Rather than eyeballing 13 boards, this searches for the rank/file offset that
best lines the labelled occupancy pattern up with the ink actually present in
the crops, and reports a non-zero offset as a hard error.

Occupancy is read from the local standard deviation of each square's centre:
a bare square is nearly flat, a piece (solid or outlined) is not. The
threshold is derived per board from the midpoint of the square-value range, so
it does not assume a particular scan contrast.

Usage:
    python check_alignment.py
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
BASE = os.path.abspath(os.path.join(HERE, '..', 'debug_dataset'))


def square_values(bid):
    """Return an 8x8 array of local standard deviation, indexed [row][col]."""
    grid = np.zeros((8, 8), np.float32)
    for r, rank in enumerate(RANKS):
        for c, f in enumerate(FILES):
            t = cv2.imread(os.path.join(BASE, bid, f'{f}{rank}.png'),
                           cv2.IMREAD_GRAYSCALE)
            if t is None:
                continue
            h, w = t.shape
            m = 14
            centre = t[int(h * m / 100):int(h * (100 - m) / 100),
                       int(w * m / 100):int(w * (100 - m) / 100)]
            grid[r, c] = float(centre.std())
    return grid


def fen_occupancy(fen):
    """8x8 float array, 1.0 where the FEN has a piece, indexed [row][col]."""
    out = np.zeros((8, 8), np.float32)
    for r, row in enumerate(fen.split()[0].split('/')):
        c = 0
        for ch in row:
            if ch.isdigit():
                c += int(ch)
            else:
                out[r, c] = 1.0
                c += 1
    return out


def main():
    with open(os.path.join(HERE, 'real_labels.json')) as fh:
        labels = json.load(fh)['boards']

    problems = []
    for bid, info in sorted(labels.items()):
        if not info.get('valid'):
            print(f'{bid}: skipped (marked invalid)')
            continue
        vals = square_values(bid)
        lo, hi = float(vals.min()), float(vals.max())
        ink = (vals - lo) / max(1e-6, hi - lo)
        occ = (ink > 0.45).astype(np.float32)
        want = fen_occupancy(info['fen'])

        best, best_score = (0, 0), -1
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                shifted = np.roll(np.roll(want, dr, axis=0), dc, axis=1)
                if dr > 0:
                    shifted[:dr, :] = 0
                elif dr < 0:
                    shifted[dr:, :] = 0
                if dc > 0:
                    shifted[:, :dc] = 0
                elif dc < 0:
                    shifted[:, dc:] = 0
                score = float((shifted == occ).mean())
                if score > best_score:
                    best_score, best = score, (dr, dc)
        agree = float((want == occ).mean())
        dr, dc = best
        aligned = float(best_score)
        mark = ''
        if aligned - agree > 0.06:
            mark = f'  <-- MISALIGNED, best offset rank{dr:+d} file{dc:+d}'
            problems.append((bid, dr, dc))
        print(f'{bid}: label/ink agreement {agree:.3f}, best-aligned '
              f'{aligned:.3f}{mark}')

    if problems:
        print('\nBoards whose labels do not line up with their crops:')
        for bid, dr, dc in problems:
            print(f'  {bid}: shift rank {dr:+d}, file {dc:+d}')
        print('\nThe crops and boards.json are mutually consistent '
              '(verify_crops.py), so the LABELS are the stale side.')
        print('Re-label these boards from the per-tile-labelled sheets '
              'produced by regen_sheets.py.')
    else:
        print('\nAll labels line up with their crops.')


if __name__ == '__main__':
    main()
