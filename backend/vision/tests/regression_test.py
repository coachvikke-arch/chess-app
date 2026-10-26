#!/usr/bin/env python3
"""Regression tests for the PDF-diagram detector (backend/vision).

Runs the FULL production path (detect_diagram.run_scan: preprocess + grid search
+ piece classification + the >32-piece guard) on synthetic boards rendered from
fixed FENs, and asserts the detector derives the same FEN back from the pixels.

The reference position is the top-left diagram of the worksheet used to develop
the feature (White Kb4 Ne5 Pd3 / Black Kd4 Pe4 Qh2). Nothing here is fed back
into production detection — the detector must read it off the image.

Usage: python tests/regression_test.py
Exit code 0 = all PASS, 1 = any FAIL.
"""
import os
import sys

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TEST_DIR)
sys.path.insert(0, os.path.join(TEST_DIR, '..'))

import cv2  # noqa: E402
import make_board as mb  # noqa: E402
import detect_diagram as dd  # noqa: E402

# (FEN, label, [scales]). The reference worksheet diagram is the sparse one.
POSITIONS = [
    ('8/8/8/4N3/1K1kp3/3P4/7q/8', 'reference worksheet diagram (top-left)', (0.8, 1.0, 1.6, 2.0)),
    ('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'start position', (1.0,)),
    ('8/8/8/8/8/3k4/3Q4/3K4', 'K+Q vs K (bare endgame)', (1.0, 1.6)),
    # The worksheet style: plain grey print, no colour. White piece bodies are
    # barely lighter than the light squares — the mask only catches their dark
    # outline, and colour must come from the q90-vs-background rule.
    ('8/8/8/4N3/1K1kp3/3P4/7q/8', 'reference GREYSCALE (monochrome print)', (1.0,)),
    ('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'start GREYSCALE (monochrome print)', (1.0,)),
]


def render_board(occ, scale, grayscale=False):
    img = mb.build_board(occ, sprites=True)
    if grayscale:
        # Worksheets render diagrams in plain grey print — no colour at all.
        # This is the defeat-the-absolute-luminance-heuristic case.
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        img = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    if scale != 1.0:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return img


def board_png(occ, scale, key, name):
    path = os.path.join(TEST_DIR, '_debug', name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, render_board(occ, scale, grayscale=(key == 'g')))
    return path


def main():
    failures = 0
    total = 0

    # 1) The reference worksheet diagram must be read back exactly.
    for fen, label, scales in POSITIONS:
        occ = mb.fen_to_occupied(fen)
        gray = 'GREYSCALE' in label
        for i, scale in enumerate(scales):
            total += 1
            suffix = 'g' if gray else 'c'
            path = board_png(occ, scale, suffix, f'_reg_{fen[:2].replace("/", "-")}_{suffix}_{scale}.png')
            res = dd.run_scan(path)
            got = res.get('fen') or ''
            ok = got.startswith(fen) and res.get('error') is None
            status = 'PASS' if ok else 'FAIL'
            if not ok:
                failures += 1
            print(f'{status}  {label} @ scale={scale}')
            if not ok:
                print(f'      expected: {fen}')
                print(f'      got:      {got}')
                print(f'      detail:   {res}')

    # 2) A board with >32 "pieces" (impossible in chess) must be rejected as
    #    not-a-board by the guard, not returned as garbage.
    total += 1
    over = {}
    for r in range(8):
        for c in range(8):
            over['abcdefgh'[c] + str(8 - r)] = 'wQ' if (r + c) % 2 == 0 else 'bN'
    path = board_png(over, 1.0, 'x', '_reg_overfill.png')
    res = dd.run_scan(path)
    ok = res.get('error') is not None and res.get('fen', None) is None
    if not ok:
        failures += 1
        print(f'FAIL  non-board (40 "pieces") not rejected: {res}')
    else:
        print('PASS  non-board (40 "pieces") rejected -> "No board detected"')

    print(f'\n{total - failures}/{total} checks passed')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()