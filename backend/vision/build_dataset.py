#!/usr/bin/env python3
"""Build the REAL-scan piece dataset from labelled boards.

Reads `real_labels.json` (ground truth transcribed from the scanned pages) and
the square crops produced by `extract_chess_squares.py`, and lays them out as:

    dataset/empty/  dataset/wK/  ... dataset/bP/

Splits are recorded BY BOARD, never by square: two crops from the same physical
board are near-duplicates, so a random square-level split would leak and report
a meaningless accuracy. The split is written to `dataset/split.json` and the
trainer refuses to mix boards across partitions.

Usage:
    python build_dataset.py --crops debug_dataset --labels real_labels.json \
                            --out dataset
"""
import os
import json
import argparse

RANKS = '87654321'
FILES = 'abcdefgh'
CLASSES = ['empty', 'wK', 'wQ', 'wR', 'wB', 'wN', 'wP',
           'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']


def fen_to_squares(fen):
    """Expand a FEN placement into {square: class}, 'empty' omitted."""
    placement = fen.split()[0]
    out = {}
    for r, row in enumerate(placement.split('/')):
        c = 0
        for ch in row:
            if ch.isdigit():
                c += int(ch)
                continue
            colour = 'w' if ch.isupper() else 'b'
            out[FILES[c] + RANKS[r]] = colour + ch.upper()
            c += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--crops', default='debug_dataset')
    ap.add_argument('--labels', default='real_labels.json')
    ap.add_argument('--out', default='dataset')
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    labels_path = args.labels if os.path.isabs(args.labels) else os.path.join(here, args.labels)
    with open(labels_path) as fh:
        labels = json.load(fh)

    for cls in CLASSES:
        d = os.path.join(args.out, cls)
        # Clear the class folder before writing. Ground-truth corrections MOVE
        # crops between class folders (e.g. a king re-coloured, or a whole
        # position replaced), and copying into the new folder without removing
        # the old one leaves the same pixels in two classes. The classifier then
        # trains on contradictory labels and the regression test fails for reasons
        # that have nothing to do with recognition. A rebuild must be a rebuild.
        if os.path.isdir(d):
            for fn in os.listdir(d):
                if fn.lower().endswith('.png'):
                    os.remove(os.path.join(d, fn))
        os.makedirs(d, exist_ok=True)

    counts = {c: 0 for c in CLASSES}
    per_board = {}
    skipped = []

    for board_id, info in labels['boards'].items():
        if not info.get('valid') or not info.get('fen'):
            skipped.append({'board': board_id, 'reason': info.get('reason', 'invalid')})
            continue
        truth = fen_to_squares(info['fen'])
        src = os.path.join(args.crops, board_id)
        if not os.path.isdir(src):
            skipped.append({'board': board_id, 'reason': 'crops not found'})
            continue

        written = {'pieces': 0, 'empty': 0, 'missing': []}
        for r in range(8):
            for c in range(8):
                sq = FILES[c] + RANKS[r]
                cls = truth.get(sq, 'empty')
                src_png = os.path.join(src, f'{sq}.png')
                if not os.path.isfile(src_png):
                    written['missing'].append(sq)
                    continue
                # Every board is a distinct source, so prefixing the filename
                # with the board id keeps the split auditable on disk.
                dst = os.path.join(args.out, cls, f'{board_id}_{sq}.png')
                with open(src_png, 'rb') as fi, open(dst, 'wb') as fo:
                    fo.write(fi.read())
                counts[cls] += 1
                written['pieces' if cls != 'empty' else 'empty'] += 1
        per_board[board_id] = written

    with open(os.path.join(args.out, 'split.json'), 'w') as fh:
        json.dump(labels['split'], fh, indent=2)
    with open(os.path.join(args.out, 'build_report.json'), 'w') as fh:
        json.dump({'counts': counts, 'per_board': per_board, 'skipped': skipped},
                  fh, indent=2)

    print(f'dataset -> {args.out}')
    for cls in CLASSES:
        print(f'  {cls:>5}: {counts[cls]}')
    print('skipped boards: ' + (', '.join(s['board'] for s in skipped) or 'none'))

    # A build that wrote nothing is a broken build, and it used to look like a
    # success: every count was 0 and the script exited 0, so the next training
    # run either trained on nothing or, worse, on the previous run's crops.
    if counts and sum(counts.values()) == 0:
        raise SystemExit(
            f'build_dataset: no crops written. Skipped {len(skipped)} board(s): '
            + '; '.join(f"{s['board']} ({s['reason']})" for s in skipped[:6])
            + ('...' if len(skipped) > 6 else '')
            + f'  Check --crops (currently {args.crops!r}); it is resolved relative '
              'to the CWD, so run from backend/ or pass an absolute path.')


if __name__ == '__main__':
    main()
