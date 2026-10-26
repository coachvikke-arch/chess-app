#!/usr/bin/env python3
"""Local diagram reader - no network, no API key, no cost.

Reads one cropped chess diagram and prints JSON on stdout.

    python read_local.py <image_path> [--hint white_bottom|black_bottom|unknown]

WHY THIS EXISTS

There is no external model here and none is wanted: this is a self-contained,
offline reader built on OpenCV plus a locally trained classifier
(local_model.pkl). It is the default reader for the diagram feature.

HONESTY CONTRACT

Accuracy on synthetic training data is not accuracy on a printed worksheet, so
this reader does NOT pretend. It reports:

  - `confidence`   mean probability of the pieces it placed
  - `uncertain`    every square below CONFIDENCE_MIN, so the editor can flag
                   exactly what a human should check
  - `warnings`     including an explicit accuracy caveat

The consumer is required to show the coach the captured image next to the
editor and to treat the result as a DRAFT, never as an answer.

    {"fen": "...", "turn": "w", "confidence": 0.0-1.0,
     "uncertain": ["e4", ...], "warnings": [...], "pieces": n}
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import board_locator as bl  # noqa: E402
from realscan_features import piece_vector  # noqa: E402

MODEL_PATH = os.path.join(HERE, 'local_model.pkl')

# A square below this probability is placed but flagged for review.
CONFIDENCE_MIN = 0.55
# Below this, the square is reported but NOT placed at all.
CONFIDENT_ENOUGH = 0.35

FILES = 'abcdefgh'


def load_model(path=MODEL_PATH):
    import pickle
    with open(path, 'rb') as fh:
        return pickle.load(fh)


def placement_from(squares):
    """{square: piece} -> FEN placement field."""
    rows = []
    for rank in range(8, 0, -1):
        row, gap = '', 0
        for f in FILES:
            p = squares.get(f + str(rank))
            if p:
                if gap:
                    row += str(gap)
                    gap = 0
                row += p
            else:
                gap += 1
        if gap:
            row += str(gap)
        rows.append(row)
    return '/'.join(rows)


def read_board(image, model):
    grid = bl.locate_board(image)
    if grid is None:
        return None

    clf = model['type']
    classes = [str(c) for c in clf.classes_]
    placed, uncertain, probs = {}, [], []

    for name, crop in bl.squares(image, grid):
        vec, _meta = piece_vector(crop, model.get('view_weights'))
        if vec is None:
            continue  # no ink: empty square
        # argmax over the probability row, not predict(): sklearn returns a numpy
        # string array and int() on it raises.
        row = clf.predict_proba([vec])[0]
        idx = int(np.argmax(row))
        prob = float(row[idx])
        piece = classes[idx]
        probs.append(prob)
        if prob < CONFIDENT_ENOUGH:
            uncertain.append(name)
            continue
        placed[name] = piece
        if prob < CONFIDENCE_MIN:
            uncertain.append(name)

    if not placed:
        return {'fen': None, 'pieces': 0, 'uncertain': uncertain, 'confidence': 0.0}

    confidence = float(np.mean(probs)) if probs else 0.0
    placement = placement_from(placed)
    return {
        'fen': f'{placement} w - - 0 1',
        'pieces': len(placed),
        'uncertain': sorted(set(uncertain)),
        'confidence': round(confidence, 3),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('--hint', default='unknown')
    ap.add_argument('--model', default=MODEL_PATH)
    args = ap.parse_args()

    if not os.path.exists(args.model):
        print(json.dumps({'fen': None, 'error': 'No local model is installed.', 'pieces': 0}))
        return

    img = cv2.imread(args.image)
    if img is None:
        print(json.dumps({'fen': None, 'error': 'Could not read the image.', 'pieces': 0}))
        return

    try:
        model = load_model(args.model)
        result = read_board(img, model)
    except Exception as exc:  # noqa
        print(json.dumps({'fen': None, 'error': f'{type(exc).__name__}: {exc}', 'pieces': 0}))
        return

    if result is None or not result.get('fen'):
        print(json.dumps({
            'fen': None,
            'pieces': 0,
            'uncertain': [],
            'confidence': 0.0,
            'error': 'No chessboard found in this selection.',
        }))
        return

    result['warnings'] = [
        'Read on-device by a heuristic classifier. Check the position against the diagram '
        'before using it - squares listed as uncertain are the least reliable.',
    ]
    print(json.dumps(result))


if __name__ == '__main__':
    main()