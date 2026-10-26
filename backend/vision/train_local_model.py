#!/usr/bin/env python3
"""Train the local diagram reader on synthetic boards.

Produces a drop-in replacement for real_model.pkl: the same dict shape, the
same feature extractor (realscan_features.piece_vector) and the same reader
(realscan_reader.read_board). Nothing else in the product changes.

Why retrain at all? The shipped model saw 13 real boards (832 squares) and
scored 16.7% exact FEN on held-out scans. gen_dataset.py can make 26,880
labelled squares for free, with the labels known exactly rather than annotated.

Honest caveat, repeated in the printed report: this is trained on SYNTHETIC
boards. Accuracy on those is a lower bound on nothing and an upper bound on
nothing - it measures the pipeline, not real book diagrams. The real test is
running it on an actual worksheet.

Usage:
    python vision/train_local_model.py --data vision/dataset --out vision/local_model.pkl
"""

import argparse
import json
import os
import pickle
import random
import sys
import time

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from sklearn.ensemble import RandomForestClassifier  # noqa: E402
from sklearn.svm import SVC  # noqa: E402

import detect_fen as df  # noqa: E402
from realscan_features import piece_vector, VIEW_WEIGHTS  # noqa: E402
import realscan_reader as rr  # noqa: E402

FILES = 'abcdefgh'


def squares_of(board_img, entry=None):
    """The 64 square crops for a board image.

    For GENERATED boards the true geometry is known from labels.json, so it is
    used directly instead of re-detecting it. Two reasons: the shipped grid
    detector cannot handle a board without visible grid lines (it returned a
    26px cell for a 380px board), and training on geometry we can reproduce
    exactly keeps the labels trustworthy.

    `entry` also supplies a small random shift, so the model sees squares that
    are a couple of pixels off centre. Without that, a 3px locator error at
    inference looks like a completely different piece to the classifier.
    """
    if entry is not None and 'margin' in entry and 'size' in entry:
        side = entry['size'] - 2 * entry['margin']
        grid = {
            'ox': float(entry['margin']),
            'oy': float(entry['margin']),
            's': side / 8.0,
            'side': float(side),
        }
        if 'shift' in entry:
            grid['ox'] += entry['shift'][0]
            grid['oy'] += entry['shift'][1]
    else:
        import board_locator as bl
        grid = bl.locate_board(board_img)
    if grid is None:
        return {}
    return dict(bl_squares(board_img, grid))


def bl_squares(board_img, grid):
    import board_locator as bl
    return bl.squares(board_img, grid)


def placement_map(placement):
    out = {}
    for i, row in enumerate(placement.split('/')):
        rank = 8 - i
        f = 0
        for ch in row:
            if ch.isdigit():
                f += int(ch)
            else:
                out[FILES[f] + str(rank)] = ch
                f += 1
    return out


def collect(data_dir, limit=None):
    """Extract per-square feature vectors and labels, grouped by board.

    Returns a list of per-board records because the split MUST be by board.
    Splitting rows instead would put neighbouring squares of the same board into
    both partitions and report an accuracy the model could never reach on a
    diagram it has not seen.

    `piece_vector` returns None for a square with no ink, so occupancy is
    implicit - there is nothing to train for it. Only the TYPE classifier is
    learned, which is why this counts occupied squares only.
    """
    label_file = os.path.join(data_dir, 'labels.json')
    meta = json.load(open(label_file, encoding='utf-8'))
    if limit:
        meta = meta[:limit]

    boards, skipped = [], 0
    for entry in meta:
        path = os.path.join(data_dir, entry['file'])
        img = cv2.imread(path)
        if img is None:
            skipped += 1
            continue
        # Random per-board shift so the model tolerates small locator error.
        entry = dict(entry)
        entry['shift'] = (random.uniform(-2.5, 2.5), random.uniform(-2.5, 2.5))
        try:
            crops = squares_of(img, entry)
        except Exception:
            skipped += 1
            continue
        if len(crops) != 64:
            skipped += 1
            continue

        truth = placement_map(entry['placement'])
        samples = []
        for sq, crop in crops.items():
            label = truth.get(sq)
            if not label:
                continue  # empty square: nothing to learn from it
            vec, _ = piece_vector(crop, None)
            if vec is None:
                continue
            samples.append((vec, label))
        if samples:
            boards.append({'file': entry['file'], 'samples': samples})

    return boards, skipped, len(meta)


def flatten(records):
    x = np.array([v for r in records for v, _ in r['samples']])
    y = np.array([lbl for r in records for _, lbl in r['samples']])
    return x, y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.path.join(HERE, 'dataset'))
    ap.add_argument('--out', default=os.path.join(HERE, 'local_model.pkl'))
    ap.add_argument('--limit', type=int, default=None)
    ap.add_argument('--seed', type=int, default=7)
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    t0 = time.time()

    print('extracting features ...')
    boards, skipped, total = collect(args.data, args.limit)
    print(f'  boards kept   : {len(boards)} (skipped {skipped} of {total})')
    print(f'  piece samples : {sum(len(b["samples"]) for b in boards)}')
    if len(boards) < 60:
        print('NOT ENOUGH BOARDS - aborting rather than writing a useless model')
        return 1

    # Split by BOARD, so no board contributes to both partitions.
    order = list(range(len(boards)))
    random.shuffle(order)
    cut = int(len(order) * 0.8)
    train_records = [boards[i] for i in order[:cut]]
    test_records = [boards[i] for i in order[cut:]]

    xtr, ytr = flatten(train_records)
    xte, yte = flatten(test_records)
    print(f'  train / test  : {len(xtr)} / {len(xte)} samples, {len(train_records)}/{len(test_records)} boards')

    if len(np.unique(ytr)) < 6:
        print(f'NOT ENOUGH CLASSES ({sorted(set(ytr))}) - generate more boards')
        return 1

    print('training type classifier (SVC, rbf, probability) ...')
    typ = SVC(kernel='rbf', probability=True, random_state=args.seed)
    typ.fit(xtr, ytr)

    # Occupancy stays implicit (piece_vector already gated it), but the key is
    # kept so the dict shape matches what realscan_reader expects.
    occ = RandomForestClassifier(n_estimators=100, random_state=args.seed, n_jobs=-1)
    occ.fit(xtr, np.ones(len(xtr), dtype=int))

    pred = typ.predict(xte)
    acc = float((pred == yte).mean())
    per_class = {}
    for true, p in zip(yte, pred):
        c = per_class.setdefault(true, [0, 0])
        c[1] += 1
        if true == p:
            c[0] += 1

    model = {
        'version': 2,
        'occupancy': occ,
        'type': typ,
        'view_weights': dict(VIEW_WEIGHTS),
        'classes': ['empty'] + list(typ.classes_),
        'split': {'seed': args.seed, 'source': 'synthetic', 'train_boards': len(train_records)},
    }
    with open(args.out, 'wb') as fh:
        pickle.dump(model, fh)

    report = {
        'source': 'synthetic',
        'boards_total': total,
        'boards_used': len(boards),
        'train_samples': int(len(xtr)),
        'test_samples': int(len(xte)),
        'held_out_type_accuracy': round(acc, 4),
        'per_class_type_accuracy': {k: round(v[0] / v[1], 4) for k, v in sorted(per_class.items())},
        'caveat': 'Measured on SYNTHETIC boards held out by board. This measures the pipeline, '
                  'not real printed worksheets. Run against a real worksheet before trusting it.',
        'seconds': round(time.time() - t0, 1),
    }
    with open(args.out.replace('.pkl', '_report.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=2)

    print()
    print(json.dumps(report, indent=2))
    print(f'\nwrote {args.out}')
    return 0
if __name__ == '__main__':
    sys.exit(main())
