#!/usr/bin/env python3
"""Generate a labelled synthetic board dataset for the local reader.

WHY THIS EXISTS

The shipped model (real_model.pkl) was trained on 13 real scanned boards -
832 labelled squares, per real_model_report.json. Its own held-out result was
16.7% exact FEN, and it does not transfer to diagrams drawn with a different
piece set or a cleaner renderer. The original author had the data volume to
build a better model and this repo does not.

So: generate the data. Every board is drawn by piece_shapes.py from a known
FEN, so the label is the FEN, not a human annotation. That makes an unlimited
labelled set possible at zero cost and with zero external services.

WHAT IS VARIED

  - piece set          solid-fill shapes (the renderer)
  - square colours     4 palettes, so colour-based features do not overfit
  - orientation        white-at-bottom and black-at-bottom
  - board size         200px to 900px, so cell resolution varies
  - margin             0 to 40px of surrounding page
  - blur               none to heavy
  - noise              light gaussian grain
  - jpeg-ish softness  mild blur + grain combination

The goal is that a model trained here works on a book diagram it has never
seen, not on this renderer's exact output.

Usage:
    python vision/gen_dataset.py --boards 400 --out vision/dataset
"""

import argparse
import json
import os
import random
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import piece_shapes  # noqa: E402

FILES = 'abcdefgh'

# Four board palettes. a8 is light in all of them, as in a real diagram.
PALETTES = [
    ((240, 217, 181), (181, 136, 99)),
    ((235, 236, 208), (119, 147, 107)),
    ((222, 184, 135), (125, 94, 55)),
    ((255, 255, 255), (160, 160, 160)),
    ((214, 194, 153), (137, 125, 92)),
]

PIECE_FILL = {'w': (250, 250, 250), 'b': (24, 24, 28)}

# Ink for hollow glyphs. Diagrams are essentially monochrome, so one ink colour
# is used for both sides; the SQUARE colour is what separates light from dark
# pieces, plus the presence of a glyph at all.
INK = (26, 26, 30)


def placement_to_board(placement):
    """FEN placement -> {square: piece}."""
    out = {}
    for i, row in enumerate(placement.split('/')):
        rank = 8 - i
        file = 0
        for ch in row:
            if ch.isdigit():
                file += int(ch)
            else:
                out[FILES[file] + str(rank)] = ch
                file += 1
    return out


def rand_legal_fen(rng):
    """A random position that is actually legal, so training data never teaches
    an illegal position the validator would reject anyway."""
    squares = {}
    for _ in range(rng.randint(2, 20)):
        squares[rng.choice(FILES) + str(rng.randint(1, 8))] = None
    squares = {k: v for k, v in squares.items()}

    # exactly one king each
    squares['e1'] = 'K'
    squares['e8'] = 'k'
    used = set(squares)

    def free():
        while True:
            s = rng.choice(FILES) + str(rng.randint(1, 8))
            if s not in used:
                used.add(s)
                return s

    for piece, count in [('Q', rng.choice([0, 1, 1, 2])), ('R', rng.choice([0, 1, 2])),
                         ('B', rng.choice([0, 1, 2])), ('N', rng.choice([0, 1, 2]))]:
        for _ in range(count):
            squares[free()] = piece
    for _ in range(rng.randint(0, 8)):
        rank = rng.randint(2, 7)
        squares[FILES[rng.randint(0, 7)] + str(rank)] = 'P'
    for _ in range(rng.randint(0, 8)):
        rank = rng.randint(2, 7)
        squares[FILES[rng.randint(0, 7)] + str(rank)] = 'p'

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


def draw_board(placement, size, palette, margin, black_bottom, blur, noise, rng):
    board_px = size - margin * 2
    if board_px < 64:
        return None
    cell = board_px // 8
    light, dark = palette
    img = Image.new('RGB', (size, size), 'white')
    d = ImageDraw.Draw(img)

    for rank in range(1, 9):
        for fi in range(8):
            visual_row = (rank - 1) if black_bottom else (8 - rank)
            x0 = margin + fi * cell
            y0 = margin + visual_row * cell
            d.rectangle([x0, y0, x0 + cell, y0 + cell],
                        fill=light if (rank + fi) % 2 == 0 else dark)

    for sq, ch in placement_to_board(placement).items():
        fi = FILES.index(sq[0])
        rank = int(sq[1])
        visual_row = (rank - 1) if black_bottom else (8 - rank)
        x0 = margin + fi * cell
        y0 = margin + visual_row * cell
        # HOLLOW outlined glyphs, not solid fills. The local pipeline's ink mask
        # only sees ink that is DARKER than the square, and its body_intensity
        # feature measures paper inside an outline. Solid pieces were invisible
        # to it: 2.5 of ~14 pieces per board were even found.
        paper = light if (rank + fi) % 2 == 0 else dark
        # White and black pieces are drawn identically - the ink colour is the
        # same, which is exactly how printed diagrams work.
        piece_shapes.draw_piece_outlined(d, ch, x0, y0, cell, cell, INK, paper)

    arr = np.array(img)
    if blur:
        arr = np.array(Image.fromarray(arr).filter(ImageFilter.GaussianBlur(blur)))
    if noise:
        arr = np.clip(arr.astype(np.float32) + np.random.normal(0, noise, arr.shape), 0, 255).astype(np.uint8)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--boards', type=int, default=400)
    ap.add_argument('--seed', type=int, default=11)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    np.random.seed(args.seed)
    out = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dataset')
    os.makedirs(out, exist_ok=True)

    meta = []
    for i in range(args.boards):
        placement = rand_legal_fen(rng)
        size = rng.randint(200, 900)
        palette = rng.choice(PALETTES)
        margin = rng.choice([0, 6, 12, 24, 40])
        black_bottom = rng.random() < 0.4
        blur = rng.choice([0, 0, 0.4, 0.8, 1.4, 2.2])
        noise = rng.choice([0, 0, 2, 5, 9])
        img = draw_board(placement, size, palette, margin, black_bottom, blur, noise, rng)
        if img is None:
            continue
        name = f'b{i:05d}.png'
        cv2.imwrite(os.path.join(out, name), img)
        meta.append({
            'file': name,
            'placement': placement,
            'orientation': 'black_bottom' if black_bottom else 'white_bottom',
            'size': size,
            'margin': margin,
            'blur': blur,
            'noise': noise,
        })

    with open(os.path.join(out, 'labels.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh)
    print(f'wrote {len(meta)} boards to {out}')


if __name__ == '__main__':
    main()