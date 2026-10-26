#!/usr/bin/env python3
"""Print silhouette features for a known board, for inspecting the trained piece classifier (piece_model.py)."""
import sys
import os
import json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cv2
import detect_fen as df
import make_board as mb

occ = {
    'a1': 'wR', 'a4': 'wN', 'b6': 'wB', 'c3': 'wQ', 'd5': 'wK', 'e2': 'wP',
    'a8': 'bR', 'h8': 'bN', 'f6': 'bB', 'd3': 'bQ', 'c5': 'bK', 'h3': 'bP',
}
img = mb.build_board(occ, sprites=True)
cv2.imwrite('_cal_board.png', img)

os.makedirs('_debug', exist_ok=True)
det = df.detect('_cal_board.png', debug_dir='_debug')
print('grid:', det['method'], 'score', det.get('score'))
print('detect() fen:', det['fen'])
print()
# probe the found grid directly
g = df.find_grid(df._work) if hasattr(df, '_work') else None
with open('_debug/_features.json') as fh:
    feat = json.load(fh)
print(f"{'sq':>3} {'true':>4} {'pred':>4} {'area':>5} {'cmp':>5} {'asp':>5} "
      f"{'tW':>4} {'t2W':>4} {'mW':>4} {'bW':>4} {'run':>3} {'asym':>5}")
for sq in sorted(feat):
    v = feat[sq]
    t = occ.get(sq, '.')
    if v.get('empty'):
        print(f"{sq:>3} {t:>4} {'----':>4} {v['area_frac']:>5.3f}")
    else:
        print(f"{sq:>3} {t:>4} {v['pred']:>4} {v['area_frac']:>5.3f} "
              f"{v['compact']:>5.2f} {v['aspect']:>5.2f} "
              f"{v['top_w']:>4.2f} {v['top2_w']:>4.2f} {v['mid_w']:>4.2f} {v['base_w']:>4.2f} "
              f"{v['runs']:>3} {v['asym_top']:>5.2f}")