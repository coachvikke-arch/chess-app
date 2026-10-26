#!/usr/bin/env python3
"""Rebuild contact sheets from the per-square crops on disk.

The sheets in debug_dataset were generated in an earlier run, before the
crops were regenerated, so they can disagree with the crops they are supposed
to summarise. Labelling from a stale sheet silently labels the wrong board.

This rebuilds each sheet from the *current* `<file><rank>.png` files, which are
the same bytes the trainer reads, so what a human sees is exactly what the
model is trained and evaluated on.

Usage:
    python regen_sheets.py [board_007 board_009 ...]     # default: all
"""
import os
import sys
import json

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, '..', 'debug_dataset'))
FILES = 'abcdefgh'
RANKS = '12345678'


def sheet_for(board_dir, path, cell=96, pad=3):
    """Tile the 64 on-disk crops, labelling every tile with its own square.

    Each tile carries its file/rank so the sheet can never be misread the way
    an unlabelled 8x8 mosaic can, where an off-by-one row silently shifts
    every label by a rank and corrupts the ground truth without any visible
    error.
    """
    missing = []
    W = 8 * (cell + pad) + pad
    H = 8 * (cell + pad) + pad + 22
    sheet = np.full((H, W, 3), 245, np.uint8)
    for r, rank in enumerate(RANKS):
        # RANKS is '12345678'; rank 8 belongs at the TOP of the sheet.
        for c, f in enumerate(FILES):
            p = os.path.join(board_dir, f'{f}{rank}.png')
            t = cv2.imread(p)
            if t is None:
                missing.append(f'{f}{rank}')
                continue
            t = cv2.resize(t, (cell, cell), interpolation=cv2.INTER_AREA)
            y = pad + (7 - r) * (cell + pad) + 22
            x = pad + c * (cell + pad)
            sheet[y:y + cell, x:x + cell] = t
            tag = f'{f}{rank}'
            cv2.putText(sheet, tag, (x + 4, y + 15), cv2.FONT_HERSHEY_SIMPLEX,
                        0.42, (0, 0, 210), 2, cv2.LINE_AA)
            cv2.putText(sheet, tag, (x + 4, y + 15), cv2.FONT_HERSHEY_SIMPLEX,
                        0.42, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(sheet, 'files a-h ->', (4, 15), cv2.FONT_HERSHEY_SIMPLEX,
                0.42, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.imwrite(path, sheet)
    return missing


def main():
    wanted = sys.argv[1:]
    ids = wanted or [f'board_{i:03d}' for i in range(1, 14)]
    for bid in ids:
        d = os.path.join(BASE, bid)
        if not os.path.isdir(d):
            print(f'{bid}: no such directory')
            continue
        missing = sheet_for(d, os.path.join(d, 'contact_sheet.png'))
        note = f'  MISSING: {missing}' if missing else ''
        print(f'{bid}: rebuilt contact_sheet.png{note}')


if __name__ == '__main__':
    main()
