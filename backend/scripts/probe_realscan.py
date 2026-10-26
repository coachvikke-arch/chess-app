"""Probe the existing trained realscan reader against the fixture set.

Read-only diagnostic: reports what real_model.pkl actually does before any of it
is wired into the product. No files are modified.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'vision'))

import cv2
import realscan_reader as R

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fx = os.path.join(root, 'vision', 'fixtures')

model = R.load_model()
print('model:', {k: type(v).__name__ for k, v in model.items()})
print('classes:', model.get('classes'))

rows = []
for name in sorted(os.listdir(fx)):
    if not name.endswith('.png') or name.startswith('_'):
        continue
    key = name[:-4]
    meta = json.load(open(os.path.join(fx, key + '.json'), encoding='utf-8'))
    img = cv2.imread(os.path.join(fx, name))
    try:
        res = R.read_board(img, model)
    except Exception as exc:  # noqa
        rows.append((key, meta['expect'], f'EXC {type(exc).__name__}', None, 0))
        continue

    # read_board returns {squares, placed, needsReview} - the FEN is built by
    # to_fen(placed). Reading res['fen'] returned None for every case and looked
    # like a dead model.
    fen = None
    review = []
    if isinstance(res, dict):
        try:
            fen = R.to_fen(res.get('placed') or {})
        except Exception:
            fen = None
        review = res.get('needsReview') or []
    same = bool(fen and meta.get('fen')) and fen.split(' ')[0] == meta['fen'].split(' ')[0]
    rows.append((key, meta['expect'], fen, same, len(review)))

w = 16
print()
print('case'.ljust(w), 'expect'.ljust(12), 'returned FEN')
for key, expect, fen, same, rev in rows:
    mark = '  EXACT' if same else ''
    print(key.ljust(w), str(expect).ljust(12), str(fen)[:44].ljust(44) + mark.ljust(8) + f'review={rev}')

exact = sum(1 for r in rows if r[3])
found = sum(1 for r in rows if r[2] and not str(r[2]).startswith('EXC'))
print()
print('positions returned :', found, '/', len(rows))
print('exact placement    :', exact, '/', len(rows))