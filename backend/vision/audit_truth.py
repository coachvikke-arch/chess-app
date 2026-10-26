#!/usr/bin/env python3
"""Audit the GROUND TRUTH in real_labels.json against the actual pixels.

The regression was reporting white/black pieces that, on inspection, are not
on the page at all: e.g. board_012/f2 is labelled `wK` but the crop is bare
paper, and board_003/h7 is labelled `wQ` and is also empty. When a label
disagrees with the pixels, the dataset builder copies empty paper into a
piece class, the model trains on contradictory data, and every metric
downstream is meaningless.

This script makes that disagreement objective instead of a matter of opinion.
For each square it measures ink with a deliberately GENEROUS, model-independent
detector (a fixed drop below the square's own paper level, chosen so faint
glyphs still register), then compares pixel evidence against label:

  * label says a piece, pixels say blank  -> SUSPECT LABEL (phantom piece)
  * label says empty,    pixels say ink   -> SUSPECT LABEL (missed piece)

Nothing here changes a label. It reports which ones are contradicted by the
image so they can be corrected at the source.

Usage:
    python audit_truth.py [--crops ../debug_dataset] [--drop 14]
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

SQUARES = [f + str(8 - r) for r in range(8) for f in 'abcdefgh']


def paper_level(gray):
    """Brightest paper level of the square, from its outer ring."""
    ring = np.concatenate([gray[0, :].ravel(), gray[-1, :].ravel(),
                           gray[:, 0].ravel(), gray[:, -1].ravel()])
    return float(np.percentile(ring, 92))


def ink_evidence(gray, drop=14.0, min_px=10):
    """Piece evidence measured against the SQUARE'S OWN tone, not the page.

    First attempt used the outer ring (bright paper) as the baseline. That is
    wrong on a chessboard: squares alternate light/dark, so a perfectly EMPTY
    dark square sits ~40 levels below the light paper ring and registers as
    ~80% "ink". Every dark empty square looked like a piece.

    The fix is to normalise by the square itself. The checker tint is a
    per-square constant offset, so comparing the darkest central pixels with
    the square's own median cancels it exactly and is immune to page exposure.
    A drawn glyph is tens of levels darker than its own square; bare board is
    uniform.

    Returns `depth`  = median - 5th percentile inside the central region
            `cstd`   = contrast spread inside that region
            `ink_px` = pixels below (median - drop) in the central region
    """
    c = gray.shape[0] // 2
    h = max(4, c // 3)
    centre = gray[c - h:c + h, c - h:c + h]
    med = float(np.median(centre))
    mask = centre < (med - drop)
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    keep = 0
    if n > 1:
        a = stats[1:, cv2.CC_STAT_AREA]
        keep = int(a[a >= min_px].sum()) if a.size else 0
    return {
        'bg': round(med, 1),
        'ink_px': keep,
        'ink_ratio': round(keep / float(centre.size), 4),
        'depth': round(med - float(np.percentile(centre, 5)), 1),
        'cstd': round(float(centre.std()), 1),
        'cmin': int(centre.min()),
    }


# A glyph is drawn when the central region is both dark relative to its own
# square and strongly textured. Bare board is flat; a printed piece is not.
# Measured separation on the real page: bare squares cstd<=8, glyphs cstd>=30.
PIECE_CSTD = 15.0
PIECE_DEPTH = 25.0


def dump_board(bid, crops, drop):
    """Raw per-square numbers: how dark is the darkest pixel, how much of the
    square sits below its own paper level, and what the centre looks like.

    Printed for every square so a human can see, without any model in the
    loop, which squares actually contain a drawn glyph.
    """
    d = os.path.join(crops, bid)
    print(f'=== raw pixels for {bid} ({d}) ===')
    print(f'{"sq":>3} {"min":>4} {"p2":>4} {"p10":>5} {"p50":>5} {"p90":>5} '
          f'{"max":>4} {"ring92":>7} {"mean":>5} {"std":>5} {"inkpx":>6} '
          f'{"ctr_min":>7} {"ctr_std":>7}')
    for name in SQUARES:
        p = os.path.join(d, f'{name}.png')
        if not os.path.isfile(p):
            continue
        img = cv2.imread(p, cv2.IMREAD_COLOR)
        if img is None:
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
        bg = paper_level(gray)
        c = gray.shape[0] // 2
        h = max(4, c // 3)
        centre = gray[c - h:c + h, c - h:c + h]
        mask = gray < (bg - drop)
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
        keep = 0
        if n > 1:
            a = stats[1:, cv2.CC_STAT_AREA]
            keep = int(a[a >= 10].sum()) if a.size else 0
        print(f'{name:>3} {gray.min():>4} {np.percentile(gray,2):>4.0f} '
              f'{np.percentile(gray,10):>5.0f} {np.percentile(gray,50):>5.0f} '
              f'{np.percentile(gray,90):>5.0f} {gray.max():>4} {bg:>7.1f} '
              f'{gray.mean():>5.0f} {gray.std():>5.1f} {keep:>6} '
              f'{centre.min():>7} {centre.std():>7.1f}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--crops', default=os.path.abspath(
        os.path.join(HERE, '..', 'debug_dataset')))
    ap.add_argument('--labels', default=os.path.join(HERE, 'real_labels.json'))
    ap.add_argument('--drop', type=float, default=14.0,
                    help='grey levels below local paper that count as ink')
    ap.add_argument('--ink-min', type=float, default=0.012,
                    help='ink_ratio at/above which a piece is plainly drawn')
    ap.add_argument('--dump', default='',
                    help='board id: print raw per-square pixel statistics')
    args = ap.parse_args()

    if args.dump:
        dump_board(args.dump, args.crops, args.drop)
        return

    with open(args.labels) as fh:
        labels = json.load(fh)['boards']

    total_phantom = total_missed = 0

    for bid in sorted(labels):
        info = labels[bid]
        d = os.path.join(args.crops, bid)
        if not info.get('valid') or not info.get('fen'):
            continue
        if not os.path.isdir(d):
            print(f'{bid}: NO CROPS at {d}')
            continue
        truth = fen_to_squares(info['fen'])
        phantom, missed = [], []
        for name in SQUARES:
            p = os.path.join(d, f'{name}.png')
            if not os.path.isfile(p):
                continue
            img = cv2.imread(p, cv2.IMREAD_COLOR)
            if img is None:
                continue
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
            ev = ink_evidence(gray, args.drop)
            labelled = truth.get(name, 'empty')
            has_ink = (ev['cstd'] >= PIECE_CSTD) and (ev['depth'] >= PIECE_DEPTH)
            if labelled != 'empty' and not has_ink:
                phantom.append((name, labelled, ev))
            elif labelled == 'empty' and has_ink:
                missed.append((name, ev))

        total_phantom += len(phantom)
        total_missed += len(missed)
        status = 'OK' if not phantom and not missed else 'MISMATCH'
        print(f'\n=== {bid}  {status}   {info["fen"]}')
        if phantom:
            print(f'  label claims a piece but the crop is blank ({len(phantom)}):')
            for name, cls, ev in phantom:
                print(f'    {name} labelled {cls:>3}  cstd={ev["cstd"]:>5} '
                      f'depth={ev["depth"]:>5} cmin={ev["cmin"]:>4} '
                      f'ink_px={ev["ink_px"]:>5}')
        if missed:
            print(f'  label says EMPTY but ink is present ({len(missed)}):')
            for name, ev in missed:
                print(f'    {name}              cstd={ev["cstd"]:>5} '
                      f'depth={ev["depth"]:>5} cmin={ev["cmin"]:>4} '
                      f'ink_px={ev["ink_px"]:>5}')

    print('\n=== TOTALS ===')
    print(f'  phantom pieces (labelled, not on page): {total_phantom}')
    print(f'  unlabelled ink   (on page, labelled empty): {total_missed}')
    if total_phantom or total_missed:
        print('\n  Ground truth disagrees with the pixels. Training or '
              'evaluating on it measures the labels, not the recogniser. '
              'Correct real_labels.json from the page image first.')


if __name__ == '__main__':
    main()
