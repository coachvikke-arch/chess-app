"""Diagnose why piece_vector returns None for most occupied squares."""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'vision'))

import board_locator as bl  # noqa: E402
import realscan_features as rf  # noqa: E402

FILES = 'abcdefgh'


def placement_map(p):
    out = {}
    for i, row in enumerate(p.split('/')):
        rank = 8 - i
        f = 0
        for ch in row:
            if ch.isdigit():
                f += int(ch)
            else:
                out[FILES[f] + str(rank)] = ch
                f += 1
    return out


meta = json.load(open(os.path.join(HERE, 'vision', 'dataset', 'labels.json'), encoding='utf-8'))
stats = {}
ink_fractions = []

for entry in meta[:40]:
    img = cv2.imread(os.path.join(HERE, 'vision', 'dataset', entry['file']))
    if img is None:
        continue
    grid = bl.locate_board(img)
    if grid is None:
        continue
    truth = placement_map(entry['placement'])
    for sq, crop in bl.squares(img, grid):
        label = truth.get(sq, 'empty')
        gray = rf.as_gray(crop)
        mask = rf.ink_mask(gray)
        frac = float(mask.mean()) if mask.size else 0.0
        ink_fractions.append((label, frac))
        vec, _ = rf.piece_vector(crop, None)
        key = (label, vec is not None)
        stats[key] = stats.get(key, 0) + 1

print('label  vec!=None  count   (share of that label)')
by_label = {}
for (label, has), n in stats.items():
    d = by_label.setdefault(label, [0, 0])
    d[0] += n
    d[1] += 1 if has else 0
for label, (total, withvec) in sorted(by_label.items()):
    print(f'  {label:<6} {withvec:>4}/{total:<5} {withvec / total:.0%}')

print()
print('ink fraction by label (median):')
for label in sorted(by_label):
    fr = [f for l, f in ink_fractions if l == label]
    if fr:
        print(f'  {label:<6} median {np.median(fr):.4f}  max {max(fr):.4f}')