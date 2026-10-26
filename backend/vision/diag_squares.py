#!/usr/bin/env python3
"""Square-level diagnostic for the REAL scanned boards.

Answers, per square and per board, the questions that decide whether a
misread is a MODEL failure or a PREPROCESSING failure:

    square | truth | foreground_pixels | ink_ratio | mean | std | contrast
           | vector_exists | predicted

and writes, for every true-occupied square that came back empty, the four
artifacts that localise the fault:

    regress_debug/<board>/<sq>_truth_<cls>.png   raw crop
    regress_debug/<board>/<sq>_processed.png     the glyph crop actually seen
    regress_debug/<board>/<sq>_mask.png          the ink mask
    regress_debug/<board>/<sq>_vector.png        the silhouette view

If the glyph is visible in _truth but absent from _mask, preprocessing erased
it. If it is present in _mask/_vector and still misread, the classifier is at
fault. Nothing is inferred from a bare accuracy number.

It also renders an 8x8 montage per board so ground truth can be audited by eye
against the pixels, and prints the detected geometry of every board crop.

Usage:
    python diag_squares.py [--page PATH] [--board board_012] [--montage]
"""
import os
import sys
import json
import argparse

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import detect_fen as df                                        # noqa: E402
import realscan_reader as rr                                   # noqa: E402
from extract_chess_squares import locate_boards                # noqa: E402
from build_dataset import fen_to_squares                       # noqa: E402
import realscan_features as rf                                 # noqa: E402

SQUARES = [f + str(8 - r) for r in range(8) for f in 'abcdefgh']
FILES = 'abcdefgh'


def square_stats(gray):
    """Raw per-square measurements, independent of any classifier.

    foreground_pixels / ink_ratio come from the SAME mask the feature
    extractor uses, so a square whose glyph is erased here is provably lost
    before the model ever sees it.
    """
    mask, bg, cut = rf.ink_mask(gray)
    ring = rf._ring(gray)
    spread = float(np.percentile(ring, 75) - np.percentile(ring, 25))
    fg = gray[mask]
    fg_mean = float(fg.mean()) if fg.size else float(gray.mean())
    return {
        'foreground_pixels': int(mask.sum()),
        'ink_ratio': round(float(mask.mean()), 4),
        'bg': round(float(bg), 1),
        'cut': round(float(cut), 1),
        'spread': round(spread, 1),
        'mean': round(float(gray.mean()), 1),
        'std': round(float(gray.std()), 1),
        'fg_mean': round(fg_mean, 1),
        # Local contrast, NOT global brightness: how far the glyph sits below
        # its own square's paper level, normalised by that level.
        'contrast': round(float(bg - fg_mean) / max(bg, 1.0), 4),
        'mask': mask,
    }


def save_square_debug(outdir, name, truth_cls, crop, gray, stats, vec):
    """Persist the four artifacts for one misclassified square."""
    os.makedirs(outdir, exist_ok=True)
    base = f'{name}_truth_{truth_cls}' if truth_cls != 'empty' else name
    big = cv2.resize(crop, (192, 192), interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(os.path.join(outdir, f'{base}.png'), big)

    # The exact pixels the feature extractor worked on.
    bbox = rf.glyph_bbox(stats['mask'])
    proc = rf.crop_glyph(gray, bbox) if bbox is not None else gray
    pv = cv2.resize(proc, (192, 192), interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(os.path.join(outdir, f'{base}_processed.png'), pv)

    # The ink mask: empty here means preprocessing lost the glyph.
    mk = stats['mask'].astype(np.uint8) * 255
    cv2.imwrite(os.path.join(outdir, f'{base}_mask.png'),
                cv2.resize(mk, (192, 192), interpolation=cv2.INTER_NEAREST))

    if vec is not None:
        sil = rf.to_silhouette(proc)
        sv = cv2.resize((sil * 255).astype(np.uint8), (192, 192),
                        interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(os.path.join(outdir, f'{base}_vector.png'), sv)


def montage(board_dir, path, cell=110, pad=6):
    """Tile the 64 stored crops with file/rank captions, for eyeball audit."""
    W = 8 * (cell + pad) + pad
    H = 8 * (cell + pad) + pad + 40
    sheet = np.full((H, W, 3), 255, np.uint8)
    for r in range(8):
        for c in range(8):
            name = FILES[c] + str(8 - r)
            p = os.path.join(board_dir, f'{name}.png')
            if not os.path.isfile(p):
                continue
            sq = cv2.imread(p, cv2.IMREAD_COLOR)
            if sq is None:
                continue
            y = pad + r * (cell + pad) + 20
            x = pad + c * (cell + pad)
            sheet[y:y + cell, x:x + cell] = cv2.resize(
                sq, (cell, cell), interpolation=cv2.INTER_NEAREST)
            cv2.putText(sheet, name, (x + 3, y - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.imwrite(path, sheet)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--page', default=os.path.join(
        HERE, 'debug_import', 'page-1790629424084', 'page.png'))
    ap.add_argument('--labels', default=os.path.join(HERE, 'real_labels.json'))
    ap.add_argument('--crops', default=os.path.abspath(
        os.path.join(HERE, '..', 'debug_dataset')))
    ap.add_argument('--board', default='', help='restrict detail to one board')
    ap.add_argument('--montage', action='store_true', help='render 8x8 sheets')
    ap.add_argument('--debug', default='regress_debug')
    args = ap.parse_args()

    with open(args.labels) as fh:
        labels = json.load(fh)['boards']

    img = cv2.imread(args.page, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f'cannot read page {args.page}')
    boxes = locate_boards(img)
    print(f'page {os.path.basename(args.page)}  {img.shape[1]}x{img.shape[0]}  '
          f'{len(boxes)} board(s) located\n')

    try:
        model = rr.load_model()
    except rr.InvalidCrop as e:
        model = None
        print(f'[warn] no model: {e.message}')

    print('=== geometry / validation of every located board ===')
    print(f'{"board":10} {"bbox":>18} {"side":>5} {"grid":>22} {"validate":>28}')
    for i, (x, y, side) in enumerate(boxes, 1):
        bid = f'board_{i:03d}'
        board = img[y:y + side, x:x + side]
        g = df.find_grid(board)
        gs = f"ox{g['ox']} oy{g['oy']} s{g['s']}" if g else 'NONE'
        try:
            rr.validate_crop(board)
            verdict = 'ACCEPTED'
        except rr.InvalidCrop as e:
            verdict = e.detail.get('reason', e.message)[:28]
        print(f'{bid:10} {f"({x},{y},{side})":>18} {side:>5} {gs:>22} {verdict:>28}')

    if args.montage:
        os.makedirs(args.debug, exist_ok=True)
        for i in range(1, len(boxes) + 1):
            d = os.path.join(args.crops, f'board_{i:03d}')
            if os.path.isdir(d):
                montage(d, os.path.join(args.debug, f'board_{i:03d}_montage.png'))

    print('\n=== per-square diagnostic (misclassified only) ===')
    print(f'{"board":10} {"sq":>3} {"truth":>5} {"fgpx":>6} {"ink":>7} '
          f'{"mean":>6} {"std":>6} {"contr":>7} {"vec":>5} {"predicted":>10}')
    problems = []
    for i, (x, y, side) in enumerate(boxes, 1):
        bid = f'board_{i:03d}'
        info = labels.get(bid, {})
        if args.board and bid != args.board:
            continue
        if not info.get('valid'):
            print(f'{bid:10} -- labelled INVALID ({info.get("reason")})')
            continue
        truth = fen_to_squares(info['fen'])
        board = img[y:y + side, x:x + side]
        g = df.find_grid(board)
        if g is None:
            print(f'{bid:10} -- no grid found')
            continue
        g = dict(g)
        g['board'] = board
        crops = dict(rr._squares(g))
        placed = rr.read_board(board, model, g)['placed'] if model else {}
        outdir = os.path.join(args.debug, bid)

        for name in SQUARES:
            t = truth.get(name, 'empty')
            crop = crops.get(name)
            if crop is None:
                continue
            gray = rf.as_gray(crop)
            st = square_stats(gray)
            vec, meta = rf.piece_vector(crop)
            pred = placed.get(name, 'empty')
            if pred == t:
                continue
            print(f'{bid:10} {name:>3} {t:>5} {st["foreground_pixels"]:>6} '
                  f'{st["ink_ratio"]:>7} {st["mean"]:>6} {st["std"]:>6} '
                  f'{st["contrast"]:>7} {str(vec is not None):>5} {pred:>10}')
            problems.append((bid, name, t, pred, vec is not None))
            save_square_debug(outdir, name, t, crop, gray, st, vec)

    lost_white = sum(1 for p in problems if p[2].startswith('w') and p[3] == 'empty')
    lost_black = sum(1 for p in problems if p[2].startswith('b') and p[3] == 'empty')
    ghost = sum(1 for p in problems if p[2] == 'empty' and p[3] != 'empty')
    novec = sum(1 for p in problems if not p[4])
    print(f'\n{len(problems)} misclassified square(s); artifacts in {args.debug}/<board>/')
    print(f'  true white piece read as EMPTY : {lost_white}')
    print(f'  true black piece read as EMPTY : {lost_black}')
    print(f'  true EMPTY read as a piece     : {ghost}')
    print(f'  no vector at all (preprocessing erased the glyph): {novec}')


if __name__ == '__main__':
    main()
