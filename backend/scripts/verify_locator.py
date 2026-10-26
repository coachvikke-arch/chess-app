"""Verify board_locator against boards whose true geometry we generated.

For each generated board we know margin and size, so the expected cell size and
origin are known exactly. Any mismatch here is a training/inference bug, so it
is checked BEFORE spending time on feature extraction.
"""
import json
import os
import sys

import cv2

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'vision'))
import board_locator as bl  # noqa: E402

data = os.path.join(HERE, 'vision', 'dataset')
meta = json.load(open(os.path.join(data, 'labels.json'), encoding='utf-8'))

worst_cell = 0.0
worst_off = 0.0
bad = []

for e in meta:
    img = cv2.imread(os.path.join(data, e['file']))
    if img is None:
        continue
    g = bl.locate_board(img)
    if g is None:
        bad.append((e['file'], 'no grid'))
        continue
    exp_side = e['size'] - 2 * e['margin']
    exp_cell = exp_side / 8.0
    exp_ox = e['margin']
    cell_err = abs(g['s'] - exp_cell)
    off_err = abs(g['ox'] - exp_ox) + abs(g['oy'] - exp_ox)
    worst_cell = max(worst_cell, cell_err)
    worst_off = max(worst_off, off_err)
    # Allow a couple of pixels of slop for the border trim.
    if cell_err > 3 or off_err > 6:
        bad.append((e['file'], f'cell {g["s"]:.1f} vs {exp_cell:.1f}, off ({g["ox"]:.0f},{g["oy"]:.0f}) vs {exp_ox}'))

print(f'boards checked : {len(meta)}')
print(f'worst cell err : {worst_cell:.2f}px')
print(f'worst off err  : {worst_off:.2f}px')
print(f'outside slop   : {len(bad)}')
for f, why in bad[:10]:
    print('  ', f, why)