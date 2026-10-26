#!/usr/bin/env python3
"""Train and evaluate the REAL-scan piece classifier.

Uses only crops from real scanned pages (see build_dataset.py). Synthetic
renders are deliberately excluded from both training and validation: the whole
point is to stop judging the model on glyphs the real pages never produce.

Split discipline: train/validation/test are separated BY BOARD (see
dataset/split.json). Two crops from one board are near-duplicates, so a random
square-level split leaks and reports a number that means nothing. This script
asserts the partitions are board-disjoint before it reports anything.

Colour is handled separately from type, because the two questions are different
and the evidence differs:
  * type  -> shape (silhouette + edge + ink profile)
  * colour-> fill: white pieces print as outlines, black pieces print solid
Both are learned from the real crops, so a washed-out scan shifts the decision
boundary with the data instead of tripping a hard-coded brightness threshold.

Usage:
    python train_real_model.py --dataset ../dataset --out real_model.pkl
"""
import os
import json
import pickle
import argparse

import numpy as np
import cv2

from realscan_features import piece_vector, VIEW_WEIGHTS

HERE = os.path.dirname(os.path.abspath(__file__))
# Colour is part of the class here on purpose: the dataset folders are
# colour-coded (wK..bP) and the fill difference between an outline white glyph
# and a solid black glyph is real evidence. Merging the colours back together
# would throw away the strongest signal the scan gives us.
PIECES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP',
          'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']
AUGMENTS = 6          # augmented copies per real crop during training


# --------------------------------------------------------------------------
# augmentation
# --------------------------------------------------------------------------

def augment(square, rng):
    """Realistic scan-degradation variants of one real crop.

    Stays inside what a scanner/print actually does to a glyph: small rotation
    and rescale from imperfect placement, slight shear from page curvature,
    blur from optics, contrast/brightness drift from exposure, noise from
    sensor and paper grain, and JPEG blocking from re-saving. Nothing here
    turns a pawn into something no printed page would show.
    """
    out = [square]
    for _ in range(AUGMENTS):
        img = square
        h, w = img.shape[:2]

        ang = rng.uniform(-6, 6)
        sc = rng.uniform(0.88, 1.12)
        M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), ang, sc)
        M[0, 2] += rng.uniform(-1.5, 1.5)
        M[1, 2] += rng.uniform(-1.5, 1.5)
        img = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_REPLICATE)

        if rng.random() < 0.6:
            img = cv2.GaussianBlur(img, (3, 3), rng.uniform(0.3, 1.2))
        if rng.random() < 0.5:
            alpha = rng.uniform(0.75, 1.3)      # contrast
            beta = rng.uniform(-18, 18)         # brightness
            img = cv2.convertScaleAbs(img, alpha=alpha, beta=beta)
        if rng.random() < 0.5:
            noise = rng.normal(0, rng.uniform(2, 9), img.shape)
            img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
        if rng.random() < 0.35:
            q = int(rng.integers(30, 75))
            ok, enc = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), q])
            if ok:
                img = cv2.imdecode(enc, cv2.IMREAD_COLOR)
        if rng.random() < 0.3:
            img = cv2.resize(img, None, fx=rng.uniform(0.7, 1.4), fy=rng.uniform(0.7, 1.4),
                             interpolation=cv2.INTER_AREA if rng.random() < 0.5 else cv2.INTER_LINEAR)
            img = cv2.resize(img, (w, h), interpolation=cv2.INTER_LINEAR)
        out.append(img)
    return out


# --------------------------------------------------------------------------
# dataset loading
# --------------------------------------------------------------------------

def board_of(filename):
    """Source board id encoded in the dataset filename (board_004_g7.png)."""
    if not filename.startswith('board_'):
        return '?'
    return '_'.join(filename.split('_')[:2])


def load_split(dataset):
    with open(os.path.join(dataset, 'split.json')) as fh:
        return json.load(fh)


def collect(dataset, split_boards, classes, augment_train, rng):
    """Build (X, y, keep, sources) over EVERY labelled square in the boards.

    `keep` marks the squares for which a vector actually exists. A labelled
    piece whose crop produced no vector is a detection miss and must be
    scored as such, never dropped: silently skipping failures is what makes an
    accuracy number look better than the detector actually is.
    """
    X, y, keep, src = [], [], [], []
    for cls in classes:
        d = os.path.join(dataset, cls)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith('.png'):
                continue
            bid = board_of(fn)
            if split_boards is not None and bid not in split_boards:
                continue
            img = cv2.imread(os.path.join(d, fn), cv2.IMREAD_COLOR)
            if img is None:
                continue
            variants = augment(img, rng) if augment_train else [img]
            for v in variants:
                vec, meta = piece_vector(v)
                if vec is None:
                    if not augment_train:
                        # Evaluation square: record the miss, no vector.
                        y.append(cls); keep.append(False); src.append(bid)
                    continue
                X.append(vec); y.append(cls); keep.append(True); src.append(bid)
    return np.array(X, dtype=np.float32), y, keep, src


def assert_board_disjoint(split):
    """Fail loudly if any board appears in more than one partition.

    Without this check a leaky split still prints a confident accuracy, which
    is exactly the failure mode this script exists to avoid.
    """
    tr = set(split.get('train', []))
    va = set(split.get('validation', []))
    te = set(split.get('test', []))
    for a, b, na, nb in ((tr, va, 'train', 'validation'),
                         (tr, te, 'train', 'test'),
                         (va, te, 'validation', 'test')):
        both = a & b
        if both:
            raise SystemExit(
                f'split.json is invalid: {sorted(both)} appear in both {na} and {nb}. '
                'Boards must not cross partitions or the accuracy is meaningless.')
    return tr, va, te


# --------------------------------------------------------------------------
# metrics
# --------------------------------------------------------------------------

def score_partition(model, X, y, metas):
    """Return (accuracy, errors) where errors lists (true, pred, source)."""
    if len(X) == 0:
        return None, []
    pred = model.predict(X)
    errs = [(t, p) for t, p in zip(y, pred) if t != p]
    acc = 1.0 - len(errs) / len(y)
    return acc, errs


def colour_accuracy(y_true, y_pred, colour_of):
    """Colour accuracy over squares predicted to hold any piece.

    Measured on the type-classifier output, independent of whether the piece
    type was right, so a K/Q confusion does not mask a colour failure.
    """
    tot = ok = 0
    for t, p in zip(y_true, y_pred):
        if t == 'empty':
            continue
        tot += 1
        if colour_of(t) == colour_of(p):
            ok += 1
    return (ok / tot) if tot else None, tot


def occupancy_metrics(occupied_true, occupied_pred):
    """Occupancy = did we call each square empty / non-empty correctly."""
    tp = sum(1 for o, p in zip(occupied_true, occupied_pred) if o and p)
    fp = sum(1 for o, p in zip(occupied_true, occupied_pred) if not o and p)
    fn = sum(1 for o, p in zip(occupied_true, occupied_pred) if o and not p)
    tn = sum(1 for o, p in zip(occupied_true, occupied_pred) if not o and not p)
    total = tp + fp + fn + tn
    return {
        'accuracy': (tp + tn) / total if total else None,
        'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn,
        'precision': tp / (tp + fp) if (tp + fp) else None,
        'recall': tp / (tp + fn) if (tp + fn) else None,
    }


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    global AUGMENTS

    ap = argparse.ArgumentParser()
    ap.add_argument('--dataset', default='../dataset')
    ap.add_argument('--out', default='real_model.pkl')
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--augment', type=int, default=AUGMENTS)
    args = ap.parse_args()

    AUGMENTS = args.augment

    dataset = os.path.abspath(args.dataset)
    split = load_split(dataset)
    tr_b, va_b, te_b = assert_board_disjoint(split)
    rng = np.random.default_rng(args.seed)

    from sklearn.svm import SVC
    from sklearn.ensemble import RandomForestClassifier

    # Two-stage model, mirroring the two separate questions:
    #   1. occupancy: is there a glyph at all?
    #   2. type + colour: given ink is present, what is it?
    # Keeping them separate means an empty square can never be forced into a
    # piece class just to make a position look legal.
    Xtr, ytr, _, _ = collect(dataset, tr_b, ['empty'] + PIECES, True, rng)
    if len(Xtr) == 0:
        print('no training data; run build_dataset.py first')
        return

    occ = RandomForestClassifier(n_estimators=300, random_state=args.seed, n_jobs=-1)
    occ.fit(Xtr, ytr)
    is_piece_tr = np.array([v != 'empty' for v in ytr])

    piece_only = Xtr[is_piece_tr]
    piece_lbl = [v for v, keep in zip(ytr, is_piece_tr) if keep]
    typ = SVC(kernel='rbf', C=10.0, gamma='scale', probability=True, random_state=args.seed)
    typ.fit(piece_only, piece_lbl)

    model = {
        'version': 2,
        'occupancy': occ,
        'type': typ,
        'view_weights': VIEW_WEIGHTS,
        'classes': ['empty'] + PIECES,
        'split': {'train': sorted(tr_b), 'validation': sorted(va_b), 'test': sorted(te_b)},
    }

    report = {'seed': args.seed, 'augment': args.augment, 'partitions': {}}
    for name, boards in (('validation', va_b), ('test', te_b)):
        if not boards:
            continue
        X, y, keep, src = collect(dataset, boards, ['empty'] + PIECES, False, rng)
        if len(y) == 0:
            continue

        # Predict over every labelled square. A square with no vector is a
        # detector miss, so it is scored as "nothing found" rather than
        # quietly excluded from the denominator.
        pred = ['empty'] * len(y)
        conf = [0.0] * len(y)
        idx = [i for i, k in enumerate(keep) if k]
        if idx:
            classes = list(occ.classes_)
            e = classes.index('empty')
            # P(there is a piece) = 1 - P(empty), from the occupancy stage.
            p_piece = 1.0 - occ.predict_proba(X)[:, e]
            for n, i in enumerate(idx):
                if p_piece[n] < 0.5:
                    pred[i] = 'empty'
                    conf[i] = float(p_piece[n])
                    continue
                pr = typ.predict_proba(X[n:n + 1])[0]
                k = int(np.argmax(pr))
                pred[i] = typ.classes_[k]
                conf[i] = float(pr[k])

        occ_true = np.array([v != 'empty' for v in y])
        occ_m = occupancy_metrics(occ_true, np.array([p != 'empty' for p in pred]))
        no_vector_misses = sum(1 for v, k in zip(y, keep) if not k and v != 'empty')

        piece_idx = [i for i, v in enumerate(y) if v != 'empty']
        type_acc = (sum(1 for i in piece_idx if pred[i] == y[i]) / len(piece_idx)) if piece_idx else None
        col_acc, col_n = colour_accuracy(y, pred, lambda c: c[0])
        full_acc = float(np.mean([a == b for a, b in zip(y, pred)]))

        report['partitions'][name] = {
            'boards': sorted(boards),
            'squares': len(y),
            # Only *piece* squares can be a no-vector miss. piece_vector() returns
            # None for a square with no glyph at all, which is how emptiness is
            # decided before the occupancy model ever runs, so every empty square
            # is reported as keep=False. Counting those inflated this counter to
            # ~50 of 64 and looked like catastrophic detector failure when the
            # empties were in fact all read correctly. A real miss is a labelled
            # piece whose crop produced no vector.
            'no_vector_misses': no_vector_misses,
            'occupancy': occ_m,
            'colour_accuracy': col_acc,
            'colour_n': col_n,
            'type_accuracy': type_acc,
            'full_square_accuracy': full_acc,
            'errors': sorted({f'{t}->{p} ({s})' for t, p, s in zip(y, pred, src) if t != p}),
        }
        p = report['partitions'][name]
        print(f'\n[{name}] boards={sorted(boards)}  squares={len(y)}  '
              f'piece-squares with no vector={no_vector_misses}')
        print(f'  occupancy accuracy : {occ_m["accuracy"]:.4f}  '
              f'(tp={occ_m["tp"]} fp={occ_m["fp"]} fn={occ_m["fn"]} tn={occ_m["tn"]})')
        print(f'  colour accuracy   : {col_acc:.4f}  (n={col_n})' if col_acc is not None else '  colour: n/a')
        print(f'  type accuracy     : {type_acc:.4f}' if type_acc is not None else '  type: n/a')
        print(f'  full-square acc   : {full_acc:.4f}')
        if p['errors']:
            print('  errors: ' + ', '.join(p['errors'][:14]))

    with open(args.out, 'wb') as fh:
        pickle.dump(model, fh)
    with open(os.path.splitext(args.out)[0] + '_report.json', 'w') as fh:
        json.dump(report, fh, indent=2)
    print(f'\nsaved {args.out}')


if __name__ == '__main__':
    main()
