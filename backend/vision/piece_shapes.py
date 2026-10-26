#!/usr/bin/env python3
"""Solid-fill chess piece renderer for diagram fixtures.

The classifier in `detect_fen.py` reads pieces from SILHOUETTE GEOMETRY
(`silhouette_features`), not colour and not sprites. A first attempt at fixtures
used Segoe UI Symbol glyphs and failed badly - those are thin OUTLINED shapes, so
the silhouette features came back meaningless and the start position was read as
54 pieces, mostly queens.

Real book/PDF diagrams use solid filled piece shapes, which is what this draws.
The shapes are deliberately plain (circle + trapezoid + base) because the
classifier keys on gross proportions - base width, body width, height, number of
holes - not on decorative detail.
"""
import math


def _poly(d, pts, fill):
    d.polygon([(round(x), round(y)) for x, y in pts], fill=fill)


def pawn(d, x, y, w, h, fill):
    cx, top = x + w / 2, y + h * 0.10
    r = w * 0.24
    d.ellipse([cx - r, top, cx + r, top + 2 * r], fill=fill)
    bw = w * 0.56
    _poly(d, [(cx - bw / 2, y + h * 0.94), (cx + bw / 2, y + h * 0.94),
              (cx + w * 0.16, top + 2 * r), (cx - w * 0.16, top + 2 * r)], fill)
    d.rectangle([cx - w * 0.46, y + h * 0.90, cx + w * 0.46, y + h], fill=fill)


def rook(d, x, y, w, h, fill):
    cx = x + w / 2
    d.rectangle([x + w * 0.12, y + h * 0.08, x + w * 0.88, y + h * 0.34], fill=fill)
    for i in range(3):  # crenellations
        d.rectangle([x + w * 0.12 + i * w * 0.26, y, x + w * 0.12 + i * w * 0.26 + w * 0.16, y + h * 0.10], fill=fill)
    d.rectangle([cx - w * 0.22, y + h * 0.34, cx + w * 0.22, y + h * 0.88], fill=fill)
    d.rectangle([x + w * 0.04, y + h * 0.86, x + w * 0.96, y + h], fill=fill)


def knight(d, x, y, w, h, fill):
    cx = x + w / 2
    _poly(d, [
        (cx - w * 0.30, y + h),
        (cx + w * 0.34, y + h),
        (cx + w * 0.34, y + h * 0.44),
        (cx + w * 0.16, y + h * 0.30),
        (cx + w * 0.10, y + h * 0.10),
        (cx - w * 0.06, y + h * 0.22),
        (cx - w * 0.26, y + h * 0.30),
        (cx - w * 0.34, y + h * 0.62),
    ], fill)


def bishop(d, x, y, w, h, fill):
    cx = x + w / 2
    d.ellipse([cx - w * 0.22, y + h * 0.06, cx + w * 0.22, y + h * 0.40], fill=fill)
    d.polygon([(cx - w * 0.03, y + h * 0.20), (cx + w * 0.03, y + h * 0.20),
               (cx + w * 0.10, y + h * 0.40), (cx - w * 0.10, y + h * 0.40)], fill=(255, 255, 255))
    _poly(d, [(cx - w * 0.20, y + h * 0.42), (cx + w * 0.20, y + h * 0.42),
              (cx + w * 0.14, y + h * 0.88), (cx - w * 0.14, y + h * 0.88)], fill)
    d.rectangle([cx - w * 0.42, y + h * 0.88, cx + w * 0.42, y + h], fill=fill)


def queen(d, x, y, w, h, fill):
    cx = x + w / 2
    spikes = 5
    pts = []
    for i in range(spikes):
        fx = x + w * (0.14 + 0.72 * i / (spikes - 1))
        pts.append((fx, y + h * 0.06))
        pts.append((fx + w * 0.06, y + h * 0.30))
    _poly(d, pts + [(x + w * 0.90, y + h * 0.36), (x + w * 0.10, y + h * 0.36)], fill)
    for i in range(spikes):  # coronet knobs
        fx = x + w * (0.14 + 0.72 * i / (spikes - 1))
        d.ellipse([fx - w * 0.05, y, fx + w * 0.05, y + h * 0.10], fill=fill)
    d.rectangle([cx - w * 0.10, y + h * 0.36, cx + w * 0.10, y + h * 0.86], fill=fill)
    d.rectangle([cx - w * 0.44, y + h * 0.84, cx + w * 0.44, y + h], fill=fill)


def king(d, x, y, w, h, fill):
    cx = x + w / 2
    d.rectangle([cx - w * 0.055, y, cx + w * 0.055, y + h * 0.22], fill=fill)
    d.rectangle([cx - w * 0.19, y + h * 0.07, cx + w * 0.19, y + h * 0.15], fill=fill)
    _poly(d, [(cx - w * 0.22, y + h * 0.60), (cx - w * 0.20, y + h * 0.22),
              (cx + w * 0.20, y + h * 0.22), (cx + w * 0.22, y + h * 0.60)], fill)
    d.rectangle([cx - w * 0.14, y + h * 0.58, cx + w * 0.14, y + h * 0.86], fill=fill)
    d.rectangle([cx - w * 0.46, y + h * 0.84, cx + w * 0.46, y + h], fill=fill)


SHAPES = {'P': pawn, 'R': rook, 'N': knight, 'B': bishop, 'Q': queen, 'K': king}


def draw_piece_outlined(d, letter, x, y, w, h, ink=(30, 30, 34), paper=None):
    """Draw a piece the way a real diagram does: a HOLLOW outlined glyph.

    This is the form the whole local pipeline is built around.
    realscan_features.ink_mask states it outright: "printed chess glyphs are
    always darker than the paper they are printed on, regardless of whether the
    piece is white or black" - it treats the ink as an OUTLINE and measures the
    paper inside it. Solid fills defeat it completely:

      * a solid white piece on a light square has nothing darker than the
        background, so the square reads as empty;
      * a solid black piece has no interior paper, so body_intensity, which is
        one of the strongest features, has nothing to measure.

    So the silhouette is drawn in ink, then a slightly inset copy of the same
    silhouette is filled with the square's own colour, leaving a rim. `paper`
    must be that square's colour, which is why the caller passes it in.
    """
    shape = SHAPES[letter.upper()]
    shape(d, x, y, w, h, ink)
    inset = max(1.0, w * 0.13)
    shape(d, x + inset, y + inset, w - 2 * inset, h - 2 * inset, paper if paper is not None else (255, 255, 255))


def draw_piece(d, letter, x, y, w, h, fill, outline):
    """Draw one piece; letter is upper-case (colour comes from `fill`).

    The piece is drawn TWICE: once slightly oversized in the outline colour,
    then at true size in the fill colour. That produces a silhouette with a
    contrasting rim - which is how every real chess diagram draws pieces, and
    it is not optional:

    A solid white piece on a light square (240,217,181) differs from its
    background by only ~10-35 grey levels. In grayscale the piece essentially
    vanishes, `ink_mask` finds nothing, and the square reads as empty. Without
    the rim the classifier saw 2.5 pieces per 14-piece board and misread Q/R/B
    most of the time.

    The rim is around the SILHOUETTE, not a bounding box: a box frame inflates
    the measured silhouette and swamps the shape features.
    """
    pad = max(1, int(round(min(w, h) * 0.055)))
    SHAPES[letter.upper()](d, x - pad, y - pad, w + 2 * pad, h + 2 * pad, outline)
    SHAPES[letter.upper()](d, x, y, w, h, fill)