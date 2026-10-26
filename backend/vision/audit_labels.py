#!/usr/bin/env python3
"""Audit the hand-transcribed ground truth in real_labels.json.

Hand transcription is exactly the kind of step that silently corrupts a
dataset, so it gets checked like code rather than trusted. Two classes of
problem are caught here:

  * structural   - a rank that does not total eight files, a malformed FEN;
  * chess-logical - impossible pieces (two kings of one colour, no king,
                    kings on adjacent squares, >16 pieces).

The output is a list of suspect squares and, with --montage, a zoomed contact
sheet of exactly those squares so the true colour can be confirmed by eye
instead of guessed at again.

Usage:
    python audit_labels.py                 # report only
    python audit_labels.py --montage       # also write suspect_king_squares.png
"""
import os
import sys
import json
import argparse

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import realscan_reader as rr                       # noqa: E402
from realscan_features import piece_vector         # noqa: E402
from extract_chess_squares import locate_boards     # noqa: E402
from build_dataset import fen_to_squares             # noqa: E402

RANK = 8
# Below this ink fraction a square is bare board. Glyph detection returns None
# well above it (any usable blob is kept), so this only fires on squares with
# no mark at all, which is exactly the case a ghost label describes.
INK_EPS = 0.005
FILE = 8


def structural_problems(fen):
    """FEN-level checks that need no chess knowledge."""
    out = []
    ranks = fen.split()[0].split('/')
    if len(ranks) != RANK:
        out.append(f'{len(ranks)} ranks (expected {RANK})')
        return out
    for i, row in enumerate(ranks):
        total, prev_run = 0, False
        for ch in row:
            if ch.isdigit():
                if ch == '0':
                    out.append(f'rank {8 - i} has a 0 run')
                if prev_run:
                    out.append(f'rank {8 - i} has two digit runs in a row')
                total += int(ch)
                prev_run = True
            else:
                if ch not in 'KQRBNPkqrbnp':
                    out.append(f'rank {8 - i} has bad character {ch!r}')
                total += 1          # a piece occupies exactly one file
                prev_run = False
        if total != FILE:
            out.append(f'rank {8 - i} totals {total} files (expected {FILE})')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--page', default=os.path.join(HERE, 'debug_import',
                                                   'page-1790629424084', 'page.png'))
    ap.add_argument('--labels', default=os.path.join(HERE, 'real_labels.json'))
    ap.add_argument('--montage', action='store_true')
    args = ap.parse_args()

    with open(args.labels) as fh:
        labels = json.load(fh)

    img = cv2.imread(args.page, cv2.IMREAD_COLOR)
    boxes = locate_boards(img) if img is not None else []
    crops = {}
    grids = {}
    for i, (x, y, side) in enumerate(boxes, 1):
        bid = f'board_{i:03d}'
        board = img[y:y + side, x:x + side]
        try:
            g = rr.validate_crop(board)
            g['board'] = board
            crops[bid] = dict(rr._squares(g))
            grids[bid] = (x, y, side)
        except rr.InvalidCrop:
            pass

    suspects, control = [], []
    for bid, info in labels['boards'].items():
        if not info.get('valid'):
            print(f'{bid}: marked invalid (expected - skipped)')
            continue
        fen = info['fen']
        problems = structural_problems(fen)
        truth = fen_to_squares(fen)

        # A square the label calls a piece but which holds no ink at all is a
        # definite transcription error, and needs no chess knowledge to spot.
        # Structural and legality checks cannot see it: a FEN is perfectly legal
        # with a piece on an empty square, so boards carrying a whole shifted
        # rank still reported "OK" while the regression lost those pieces. The
        # ink is the only independent evidence of what is actually drawn.
        ghosts = []
        for sq, cls in truth.items():
            crop = crops.get(bid, {}).get(sq)
            if crop is None:
                continue
            vec, meta = piece_vector(crop)
            ink = float(meta.get('ink_frac', 0.0)) if meta else 0.0
            if vec is None and ink < INK_EPS:
                ghosts.append((sq, cls, ink))
        if ghosts:
            problems = list(problems) + [
                f'labelled piece on blank square: ' +
                ', '.join(f'{s}({c}, ink={i:.4f})' for s, c, i in ghosts)]

        notes = rr.legality_notes(truth)
        kings = sorted(s for s, p in truth.items() if p.endswith('K'))
        w = [s for s, p in truth.items() if p == 'wK']
        b = [s for s, p in truth.items() if p == 'bK']
        if problems or notes:
            print(f'{bid}: {fen}')
            for p in problems:
                print(f'    STRUCTURE: {p}')
            for n in notes:
                print(f'    CHESS:     {n}')
            print(f'    kings: w={w} b={b}')
        else:
            print(f'{bid}: OK  ({len(truth)} pieces)')
        # Only genuine *errors* are worth a visual check. A one-sided position
        # (e.g. board_007, a real tactics study with no white king on the page)
        # reports a note but has nothing to re-read: the king that IS on the page
        # is correctly labelled, and re-viewing it only invites the reverse
        # error of "inventing" a king that was never drawn.
        if problems or any(not n.startswith('no ') for n in notes):
            for s in kings:
                suspects.append((bid, s, truth[s], crops.get(bid, {}).get(s)))
        for s in b:
            control.append((bid, s, truth[s], crops.get(bid, {}).get(s)))

    print(f'\n{len(suspects)} suspect king square(s)')

    if args.montage and (suspects or control):
        # Show every suspect king, plus up to three already-correct black kings
        # as a visual reference so black/white fill can be judged consistently.
        tiles = list(suspects) + control[:3]
        tiles = [t for t in tiles if t[3] is not None]
        if not tiles:
            print('no crops available for montage')
            return
        cell, cols = 200, 5
        rows = (len(tiles) + cols - 1) // cols
        sheet = np.full((rows * (cell + 26), cols * cell, 3), 255, np.uint8)
        for k, (bid, sq, cls, crop) in enumerate(tiles):
            r, c = divmod(k, cols)
            tile = cv2.resize(crop, (cell, cell), interpolation=cv2.INTER_NEAREST)
            y0 = r * (cell + 26)
            sheet[y0:y0 + cell, c * cell:(c + 1) * cell] = tile
            tag = f'{bid} {sq} LABEL={cls}'
            cv2.putText(sheet, tag, (c * cell + 4, y0 + cell + 17),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 200), 1, cv2.LINE_AA)
        out = os.path.join(HERE, 'suspect_king_squares.png')
        cv2.imwrite(out, sheet)
        print(f'   rows 1-{min(3, len(suspects))} = suspects, '
              f'last row = reference black kings -> {out}')


if __name__ == '__main__':
    main()
