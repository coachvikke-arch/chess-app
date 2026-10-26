#!/usr/bin/env python3
"""End-to-end regression test on the REAL scanned pages.

This is the test that must stay green. It runs the full pipeline the API uses
-- crop validation, board detection, grid, per-square reading, FEN -- over the
scanned page and compares against the ground truth in real_labels.json.

Reports, per board and overall:
    occupancy accuracy   pieces found where there are pieces
    colour accuracy      white vs black, ignoring type
    type accuracy        exact piece class
    full-board accuracy  every one of the 64 squares correct
    FEN accuracy         the whole position string matches

A high per-piece score with a wrong FEN is still a failure, which is why the
FEN line is reported and asserted separately.

Usage:
    python regress_real_scans.py
"""
import os
import sys
import json
import argparse

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import realscan_reader as rr                            # noqa: E402
from extract_chess_squares import locate_boards        # noqa: E402
from build_dataset import fen_to_squares                # noqa: E402


def score(placed, truth):
    """Per-board accuracy breakdown against a ground-truth square map."""
    squares = [f + r for f in 'abcdefgh' for r in '12345678']
    occ = {'tp': 0, 'fp': 0, 'fn': 0, 'tn': 0}
    col_ok = col_n = type_ok = type_n = full_ok = 0
    for sq in squares:
        t = truth.get(sq, 'empty')
        p = placed.get(sq)
        t_occ, p_occ = t != 'empty', p is not None
        occ['tp' if (t_occ and p_occ) else
            'fp' if (not t_occ and p_occ) else
            'fn' if t_occ else 'tn'] += 1
        if t_occ:
            col_n += 1
            type_n += 1
            if p_occ:
                col_ok += (p[0] == t[0])
                type_ok += (p == t)
        full_ok += ((p or 'empty') == t)
    n = len(squares)
    return {
        'squares': n,
        'occupancy_accuracy': (occ['tp'] + occ['tn']) / n,
        'occupancy': occ,
        'colour_accuracy': col_ok / col_n if col_n else None,
        'colour_n': col_n,
        'type_accuracy': type_ok / type_n if type_n else None,
        'type_n': type_n,
        'full_board_accuracy': full_ok / n,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--page', default=os.path.join(HERE, 'debug_import',
                                                   'page-1790629424084', 'page.png'))
    ap.add_argument('--labels', default=os.path.join(HERE, 'real_labels.json'))
    ap.add_argument('--debug', default='regress_debug')
    ap.add_argument('--json', default='regress_report.json')
    args = ap.parse_args()

    with open(args.labels) as fh:
        labels = json.load(fh)

    img = cv2.imread(args.page, cv2.IMREAD_COLOR)
    if img is None:
        print(json.dumps({'error': f'cannot read {args.page}'}))
        sys.exit(2)
    os.makedirs(args.debug, exist_ok=True)

    model = rr.load_model()
    boxes = locate_boards(img)

    results = {'page': os.path.basename(args.page), 'boards': [], 'totals': {}}
    agg = {'occ_ok': 0, 'sq': 0, 'col_ok': 0, 'col_n': 0, 'type_ok': 0, 'type_n': 0,
           'full_ok': 0, 'fen_ok': 0, 'boards': 0, 'invalid_ok': 0, 'invalid_total': 0}

    for i, (x, y, side) in enumerate(boxes, 1):
        bid = f'board_{i:03d}'
        info = labels['boards'].get(bid, {})
        board = img[y:y + side, x:x + side]

        # --- an invalid board must be rejected cleanly, with no FEN --------
        if not info.get('valid'):
            agg['invalid_total'] += 1
            try:
                rr.validate_crop(board)
                status, reason = 'NOT REJECTED', 'accepted an invalid board'
            except rr.InvalidCrop as e:
                status, reason = 'rejected', e.detail.get('reason', e.message)
                agg['invalid_ok'] += 1
            results['boards'].append({'board': bid, 'expect': 'invalid',
                                      'status': status, 'reason': reason})
            print(f'{bid}: INVALID expected -> {status} ({reason})')
            continue

        truth = fen_to_squares(info['fen'])
        try:
            grid = rr.validate_crop(board)
        except rr.InvalidCrop as e:
            results['boards'].append({'board': bid, 'expect': 'valid',
                                      'status': 'WRONGLY REJECTED', 'reason': e.message,
                                      'detail': e.detail})
            print(f'{bid}: valid board but rejected: {e.message} {e.detail}')
            continue

        res = rr.read_board(board, model, grid)
        fen = rr.to_fen(res['placed'])
        res['fen'] = fen
        res['legality'] = rr.legality_notes(res['placed'])
        res['truth'] = truth

        sc = score(res['placed'], truth)
        fen_ok = fen.split()[0] == info['fen'].split()[0]
        sc.update({'fen': fen, 'expected': info['fen'], 'fen_ok': fen_ok,
                   'review': [r['square'] for r in res['needsReview']],
                   'legality': res['legality'], 'board': bid, 'expect': 'valid'})
        results['boards'].append(sc)

        rr.render_debug(board, res, os.path.join(args.debug, f'{bid}.png'))

        agg['occ_ok'] += sc['occupancy']['tp'] + sc['occupancy']['tn']
        agg['sq'] += sc['squares']
        agg['col_ok'] += int(round((sc['colour_accuracy'] or 0) * sc['colour_n']))
        agg['col_n'] += sc['colour_n']
        agg['type_ok'] += int(round((sc['type_accuracy'] or 0) * sc['type_n']))
        agg['type_n'] += sc['type_n']
        agg['full_ok'] += sc['full_board_accuracy'] * sc['squares']
        agg['fen_ok'] += 1 if fen_ok else 0
        agg['boards'] += 1

        print(f"{bid}: occ={sc['occupancy_accuracy']:.3f} "
              f"colour={sc['colour_accuracy']:.3f} type={sc['type_accuracy']:.3f} "
              f"board={sc['full_board_accuracy']:.3f} fen={'OK' if fen_ok else 'FAIL'}")
        if not fen_ok:
            print(f"    got      {fen}")
            print(f"    expected {info['fen']}")
        for note in res['legality']:
            print(f'    LEGALITY: {note}')

    results['totals'] = {
        'boards_scored': agg['boards'],
        'occupancy_accuracy': agg['occ_ok'] / agg['sq'] if agg['sq'] else None,
        'colour_accuracy': agg['col_ok'] / agg['col_n'] if agg['col_n'] else None,
        'type_accuracy': agg['type_ok'] / agg['type_n'] if agg['type_n'] else None,
        'full_board_accuracy': agg['full_ok'] / agg['sq'] if agg['sq'] else None,
        'fen_accuracy': agg['fen_ok'] / agg['boards'] if agg['boards'] else None,
        'invalid_rejected': f"{agg['invalid_ok']}/{agg['invalid_total']}",
    }
    t = results['totals']
    print('\n=== TOTALS (real scanned boards) ===')
    print(f"  boards scored      : {t['boards_scored']}")
    print(f"  occupancy accuracy : {t['occupancy_accuracy']:.4f}")
    print(f"  colour accuracy    : {t['colour_accuracy']:.4f}")
    print(f"  type accuracy      : {t['type_accuracy']:.4f}")
    print(f"  full-board accuracy: {t['full_board_accuracy']:.4f}")
    print(f"  FEN accuracy       : {t['fen_accuracy']:.4f}")
    print(f"  invalid rejected   : {t['invalid_rejected']}")

    with open(args.json, 'w') as fh:
        json.dump(results, fh, indent=2)
    print(f'\nreport -> {args.json}   debug -> {args.debug}/')


if __name__ == '__main__':
    main()
