#!/usr/bin/env python3
"""Diagram fixture generator for the /api/diagrams/read pipeline.

Draws synthetic chess diagrams with PIL so the recognition path can be measured
against ground truth we control. Every fixture writes a `.json` sidecar holding
the FEN it was drawn from, so the test harness can score the detector instead of
asserting vibes.

Fixtures cover the cases the feature spec calls out: clean, blurry,
low-resolution, rotated, black-at-bottom, white-at-bottom, no-board,
two-boards-in-one-crop, and text-surrounded.

Usage:
    python vision/make_fixtures.py [outdir]

Default outdir: vision/fixtures
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont, ImageFilter

import piece_shapes

LIGHT = (240, 217, 181)
DARK = (181, 136, 99)
INK_W = (255, 255, 255)
INK_B = (25, 25, 25)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\seguisym.ttf',
    r'C:\Windows\Fonts\DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def parse_placement(placement):
    """'rnbqkbnr/pppppppp/8/...' -> {square: char}, square a1 bottom-left."""
    board = {}
    ranks = placement.split('/')
    for i, row in enumerate(ranks):
        rank = 8 - i
        file = 0
        for ch in row:
            if ch.isdigit():
                file += int(ch)
            else:
                board[chr(ord('a') + file) + str(rank)] = ch
                file += 1
    return board


def draw_board(fen, size=640, black_bottom=False, margin=24):
    """Render one diagram. Returns a PIL Image."""
    placement = fen.split(' ')[0]
    squares = parse_placement(placement)
    board_px = size - margin * 2
    cell = board_px // 8
    font = load_font(int(cell * 0.72))

    img = Image.new('RGB', (size, size), 'white')
    d = ImageDraw.Draw(img)

    for rank in range(1, 9):
        for file_index in range(8):
            # Standard: rank 1 at the bottom (visual row 7), rank 8 at the top
            # (visual row 0). Flipped: rank 8 at the bottom, rank 1 at the top.
            visual_row = (rank - 1) if black_bottom else (8 - rank)
            x0 = margin + file_index * cell
            y0 = margin + visual_row * cell
            # a8 is a light square, a1 is dark.
            is_light = ((rank + file_index) % 2 == 0)
            d.rectangle(
                [x0, y0, x0 + cell, y0 + cell],
                fill=LIGHT if is_light else DARK,
                # NO per-square outline. A 1px border on all 64 squares reads as
                # content in every cell, which pushed `occupied` to 54-56/64 on
                # a 32-piece position and tripped the detector's legality gate.
            )

    for square, ch in squares.items():
        col = ord(square[0]) - ord('a')
        rank = int(square[1])
        # Same mapping as the squares above, so a piece always lands on its own
        # square in either orientation.
        row = (rank - 1) if black_bottom else (8 - rank)
        x0 = margin + col * cell
        y0 = margin + row * cell
        # Solid filled pieces: the OpenCV classifier reads silhouette geometry,
        # so a thin outlined glyph classifies as noise. See piece_shapes.py.
        if ch.isupper():
            fill, outline = (252, 252, 252), (40, 40, 40)
        else:
            fill, outline = (28, 28, 32), (10, 10, 10)
        piece_shapes.draw_piece(d, ch, x0, y0, cell, cell, fill, outline)
    return img


def draw_text_surrounded(fen, size=700):
    """A diagram with prose around it - the 'ignore the text' fixture."""
    board = draw_board(fen, size=size - 120, margin=10)
    img = Image.new('RGB', (size, size), 'white')
    d = ImageDraw.Draw(img)
    f = load_font(15)
    for i, line in enumerate([
        'Exercise 4.  Find the winning continuation for White.',
        'Remember to check every resource before you move.',
        'The knight is undefended on the rim.',
    ]):
        d.text((16, 14 + i * 20), line, font=f, fill=(20, 20, 20))
    d.text((16, size - 60), 'Name the move, then explain why it works.', font=f, fill=(20, 20, 20))
    img.paste(board, (20, 80))
    return img


def draw_two_boards(fen, size=900):
    """Two diagrams in one crop - must be rejected as ambiguous."""
    board = draw_board(fen, size=size // 2 - 30, margin=8)
    img = Image.new('RGB', (size, size // 2 + 20), 'white')
    img.paste(board, (10, 10))
    img.paste(board, (size // 2 + 10, 10))
    return img


def draw_no_board(size=640):
    """Prose only - must be rejected."""
    img = Image.new('RGB', (size, size), 'white')
    d = ImageDraw.Draw(img)
    f = load_font(18)
    for i, line in enumerate([
        'Chapter 7 - Endgame technique', '',
        'A king and pawn ending is drawn when the',
        'pawn has crossed the centre. Remember the',
        'opposition rule and the square rule.',
    ]):
        d.text((30, 40 + i * 30), line, font=f, fill=(15, 15, 15))
    return img


# ── the fixture set ────────────────────────────────────────────────────────
# (key, fen, builder kwargs, expectation)
FIXTURES = [
    ('clean-start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {}, 'exact'),
    ('clean-italian', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1', {}, 'exact'),
    ('clean-sparse', '4k3/8/8/3K4/8/8/8/7Q w - - 0 1', {}, 'exact'),
    # Orientation pair: the SAME kind of position drawn both ways, to check the
    # reader reports which way round it is. Note the two entries must differ -
    # an earlier version set black_bottom on both, so the pair was identical.
    ('white-bottom', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
     {}, 'orientation'),
    ('black-bottom', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1',
     {'black_bottom': True}, 'orientation'),
    ('blurry', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1',
     {'blur': 1.6}, 'board'),
    ('low-res', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1',
     {'size': 220}, 'board'),
    ('rotated', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1',
     {'rotate': 7}, 'board'),
    ('text-around', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1',
     {'surround': True}, 'board'),
    ('no-board', None, {'none': True}, 'reject'),
    ('two-boards', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
     {'two': True}, 'reject'),
]


def build(outdir):
    os.makedirs(outdir, exist_ok=True)
    made = []
    for key, fen, opts, expect in FIXTURES:
        if opts.get('none'):
            img = draw_no_board()
        elif opts.get('surround'):
            img = draw_text_surrounded(fen)
        elif opts.get('two'):
            img = draw_two_boards(fen)
        else:
            img = draw_board(fen, black_bottom=opts.get('black_bottom', False))
            if opts.get('rotate'):
                img = img.rotate(opts['rotate'], expand=False, fillcolor='white')
            if opts.get('blur'):
                img = img.filter(ImageFilter.GaussianBlur(opts['blur']))
            if opts.get('size') and opts['size'] != 640:
                img = img.resize((opts['size'], opts['size']), Image.LANCZOS)

        path = os.path.join(outdir, f'{key}.png')
        img.save(path)
        meta = {
            'key': key,
            'fen': fen,
            'expect': expect,
            'orientation': 'black_bottom' if opts.get('black_bottom') else 'white_bottom',
            'width': img.width,
            'height': img.height,
        }
        with open(os.path.join(outdir, f'{key}.json'), 'w', encoding='utf-8') as fh:
            json.dump(meta, fh, indent=2)
        made.append(meta)
    return made


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
    fixtures = build(target)
    print(f'wrote {len(fixtures)} fixtures to {target}')
    for f in fixtures:
        print(f"  {f['key']:<16} {f['width']}x{f['height']} expect={f['expect']}")