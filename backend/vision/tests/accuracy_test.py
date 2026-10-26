#!/usr/bin/env python3
"""Grid-of-every-piece accuracy test for detect_fen.py.

Each trial: a random legal-ish position is rendered with the cburnett sprite
set at several scales, then detect()'s placed map is compared piece-by-piece.
Usage: python accuracy_test.py [N]
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import cv2
import numpy as np
import detect_fen as df
import make_board as mb


def render(occ, scale):
    img = mb.build_board(occ, sprites=True)
    if scale != 1.0:
        img = cv2.resize(img, None, fx=scale, fy=scale,
                         interpolation=cv2.INTER_AREA)
    return img


def match(detected, truth):
    """{sq: (true, pred)} for every square where they differ."""
    bad = {}
    placed = detected['placed']
    for r in range(8):
        for c in range(8):
            sq = 'abcdefgh'[c] + str(8 - r)
            t = truth.get(sq)
            p = placed.get(sq)
            if (t or None) != (p or None):
                bad[sq] = (t, p)
    return bad


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 15
    total_pe = total_ee = 0
    wrong = {}
    for scale in (0.8, 1.0, 2.0):
        pe = ee = 0
        for i in range(n):
            occ = mb.shuf_start(seed=1000 + i)
            tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               '_debug', '_acc_board.png')
            os.makedirs(os.path.dirname(tmp), exist_ok=True)
            cv2.imwrite(tmp, render(occ, scale))
            r = df.detect(tmp)
            bad = match(r, occ)
            n_e = sum(1 for v in bad.values() if v[0] is None)
            n_p = len(bad) - n_e
            pe += n_p
            ee += n_e
            for sq, (t, p) in bad.items():
                wrong[(t, p)] = wrong.get((t, p), 0) + 1
        total_pe += pe
        total_ee += ee
        print(f'scale {scale:>4}: {n} boards, {pe} piece-errors, {ee} empty-errors')
    print(f'TOTAL: {total_pe} piece-errors, {total_ee} empty-errors across 3 scales x {n}')
    top = sorted(wrong.items(), key=lambda kv: -kv[1])[:8]
    print('most common wrong map:', top)


if __name__ == '__main__':
    main()