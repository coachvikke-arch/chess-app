#!/usr/bin/env python3
"""Generate synthetic digital chessboard screenshots for testing detect_fen.py."""
import sys
import os
import random
import numpy as np
import cv2

CELL = 48
LIGHT = np.array([206, 240, 234], dtype=np.uint8)   # BGR lichess-green light
DARK = np.array([82, 154, 122], dtype=np.uint8)     # BGR lichess-green dark
PAGE = np.array([242, 242, 242], dtype=np.uint8)
WHITE_BODY = np.array([252, 252, 252], dtype=np.uint8)
WHITE_OUT = np.array([70, 74, 90], dtype=np.uint8)
BLACK_BODY = np.array([46, 50, 58], dtype=np.uint8)
BLACK_OUT = np.array([18, 18, 24], dtype=np.uint8)

FEN_CHAR = {'wK': 'K', 'wQ': 'Q', 'wR': 'R', 'wB': 'B', 'wN': 'N', 'wP': 'P',
            'bK': 'k', 'bQ': 'q', 'bR': 'r', 'bB': 'b', 'bN': 'n', 'bP': 'p'}

_SPRITES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
_SPRITES = None


def load_sprites():
    global _SPRITES
    if _SPRITES is None:
        _SPRITES = {}
        for color in 'wb':
            for kind in 'kqrbnp':
                path = os.path.join(_SPRITES_DIR, f'{color}{kind}.png')
                if os.path.exists(path):
                    _SPRITES[color + kind] = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    return _SPRITES


class SpriteMissing(Exception):
    pass


def composite(img, x0, y0, sprite, scale):
    """Copy an RGBA sprite (scaled) onto a BGR image at (x0,y0)."""
    bgra = cv2.resize(sprite, None, fx=scale, fy=scale,
                      interpolation=cv2.INTER_AREA)
    h, w = bgra.shape[:2]
    if h <= 0 or w <= 0:
        return
    alpha = bgra[:, :, 3:4].astype(np.float32) / 255.0
    rgb = bgra[:, :, :3].astype(np.float32)
    y0 = int(y0)
    x0 = int(x0)
    reg = img[y0:y0 + h, x0:x0 + w].astype(np.float32)
    out = rgb * alpha + reg * (1 - alpha)
    img[y0:y0 + h, x0:x0 + w] = out.astype(np.uint8)


def union():
    return np.zeros((CELL, CELL), dtype=bool)


def add_circle(m, cx, cy, r):
    yy, xx = np.ogrid[:CELL, :CELL]
    m[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r] = True


def add_rect(m, x0, y0, x1, y1):
    m[int(max(0, y0)):int(min(CELL, y1)), int(max(0, x0)):int(min(CELL, x1))] = True


def add_tri(m, pts):
    poly = np.array(pts, dtype=np.int32)
    cv2.fillPoly(m.astype(np.uint8), [poly], 1)
    m[:] = m.astype(bool)


def glyph(kind):
    m = union()
    cx = CELL / 2.0
    if kind == 'P':
        add_rect(m, cx - 6, 32, cx + 6, 46)
        add_rect(m, cx - 8, 36, cx + 8, 47)
        add_circle(m, cx, 22, 13)
        add_rect(m, cx - 5, 24, cx + 5, 33)
    elif kind == 'R':
        add_rect(m, cx - 13, 20, cx + 13, 47)
        add_rect(m, cx - 13, 18, cx + 13, 26)
        for dx in (-11, -1, 9):
            add_rect(m, cx + dx, 6, cx + dx + 5, 22)
    elif kind == 'N':
        add_rect(m, cx - 11, 26, cx + 12, 47)
        add_circle(m, cx - 10, 25, 8)
        add_circle(m, cx + 10, 30, 8)
        add_tri(m, [(cx + 2, 10), (cx + 15, 16), (cx + 6, 24)])
    elif kind == 'B':
        add_rect(m, cx - 4, 20, cx + 4, 47)
        add_rect(m, cx - 9, 30, cx + 9, 34)
        add_circle(m, cx, 12, 7)
        add_tri(m, [(cx, 2), (cx + 5, 9), (cx - 5, 9)])
    elif kind == 'Q':
        add_rect(m, cx - 10, 24, cx + 10, 47)
        add_rect(m, cx - 13, 32, cx + 13, 39)
        add_tri(m, [(cx, 2), (cx - 9, 20), (cx + 9, 20)])
        add_tri(m, [(cx - 12, 4), (cx - 16, 20), (cx - 8, 20)])
        add_tri(m, [(cx + 12, 4), (cx + 8, 20), (cx + 16, 20)])
        add_circle(m, cx, 15, 5)
    elif kind == 'K':
        add_rect(m, cx - 11, 24, cx + 11, 47)
        add_rect(m, cx - 13, 32, cx + 13, 40)
        add_rect(m, cx - 4, 14, cx + 4, 28)
        add_rect(m, cx - 8, 8, cx + 8, 14)
        add_circle(m, cx, 13, 5)
    return m


def build_board(occupied_by_sq, sprites=False):
    """occupied_by_sq: dict {square:'wP'|'bN'|...}. Returns BGR image."""
    side = CELL * 8 + 40
    img = np.full((side, side, 3), PAGE, dtype=np.uint8)
    mx, my = 20, 20
    for r in range(8):
        for c in range(8):
            sq = 'abcdefgh'[c] + str(8 - r)
            x0 = mx + c * CELL
            y0 = my + r * CELL
            img[y0:y0 + CELL, x0:x0 + CELL] = LIGHT if (r + c) % 2 == 0 else DARK
            pc = occupied_by_sq.get(sq)
            if pc:
                if sprites:
                    spr = load_sprites().get(pc.lower())
                    if spr is None:
                        raise SpriteMissing(pc)
                    target = CELL * 0.82
                    scale = target / spr.shape[0]
                    w = int(spr.shape[1] * scale)
                    x = x0 + (CELL - w) // 2
                    y = y0 + int(CELL * 0.16)
                    composite(img, x, y, spr, scale)
                else:
                    render_piece(img, x0, y0, pc)
    return img


def render_piece(img, x0, y0, pc):
    kind = pc[1]
    white = pc[0] == 'w'
    body = WHITE_BODY if white else BLACK_BODY
    out = WHITE_OUT if white else BLACK_OUT
    m = glyph(kind).astype(np.uint8)
    k = np.ones((5, 5), np.uint8)
    edge = cv2.dilate(m, k) - m
    box = img[y0:y0 + CELL, x0:x0 + CELL].copy()
    box[edge > 0] = out
    box[m > 0] = body
    img[y0:y0 + CELL, x0:x0 + CELL] = box


def fen_to_occupied(fen):
    occ = {}
    rows = fen.split()[0].split('/')
    for r, row in enumerate(rows):
        c = 0
        for ch in row:
            if ch.isdigit():
                c += int(ch)
            else:
                white = ch.isupper()
                sq = 'abcdefgh'[c] + str(8 - r)
                occ[sq] = ('w' if white else 'b') + ch.upper()
                c += 1
    return occ


def shuf_start(seed=None):
    """A random but legal-ish position: full back rows + random middle pieces."""
    rng = random.Random(seed)
    occ = fen_to_occupied('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1')
    for _ in range(rng.randint(8, 24)):
        sq = 'abcdefgh'[rng.randrange(8)] + str(rng.randrange(1, 9))
        pc = rng.choice(['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ'])
        if pc[1] == 'K':
            pass
        if occ.get(sq) == 'wK' or occ.get(sq) == 'bK':
            continue
        occ[sq] = pc
    return occ


def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else None
    out = sys.argv[2] if len(sys.argv) > 2 else 'board.png'
    occ = shuf_start(seed)
    img = build_board(occ)
    cv2.imwrite(out, img)
    fen = []
    for r in range(8):
        row = ''
        n = 0
        for c in range(8):
            p = occ.get('abcdefgh'[c] + str(8 - r))
            if not p:
                n += 1
            else:
                if n:
                    row += str(n); n = 0
                row += FEN_CHAR[p]
        if n:
            row += str(n)
        fen.append(row)
    print('/'.join(fen))


if __name__ == '__main__':
    main()