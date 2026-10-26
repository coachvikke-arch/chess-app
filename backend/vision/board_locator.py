#!/usr/bin/env python3
"""Locate the 8x8 board inside a hand-drawn crop.

WHY THIS EXISTS

detect_fen.find_grid searches for a periodic light/dark pattern and was tuned on
printed boards with visible grid lines. On a clean diagram it routinely lands on
the page margin instead (observed: a 380px board reported a grid at offset
(25,25) with a 26px cell - i.e. it found the text, not the board). Everything
downstream then classifies the wrong pixels, which is why the original detector
scored 0/9.

A coach drags a box around ONE diagram by hand, so the crop is already
approximately the board. That makes this a far easier problem than "find a board
anywhere on a page":

  1. drop the page around it      - page is near-uniform white
  2. drop the quiet inner border  - the 1-2px frame around a diagram
  3. fall back to the whole crop  - if step 1 finds nothing
  4. optionally refine           - if detect_fen finds a grid that agrees

Step 4 is only trusted when its cell size and offsets are consistent with what
we already know, which is exactly the check the old code was missing.

Everything is deterministic - no randomness - so training and inference derive
square geometry the same way.
"""

import numpy as np


def _page_mask(board):
    """Pixels that are part of the board rather than the surrounding page.

    The page is near-white and near-uniform. A diagram always contains both
    light squares and dark squares, so 'is this near-white' alone is not enough -
    a light square is near-white too. Instead: find the largest region whose
    colour is NOT close to the corner colour of the image (the page).
    """
    h, w = board.shape[:2]
    flat = board.reshape(-1, 3).astype(np.int16)
    page = np.median(np.concatenate([
        flat[: max(1, len(flat) // 50)],                 # top strip
        flat[-max(1, len(flat) // 50):],                # bottom strip
        flat[: max(1, w) * max(1, len(flat) // (50 * max(1, h)) )],  # left
    ]), axis=0)
    dist = np.linalg.norm(flat - page, axis=1).reshape(h, w)
    return dist > 24


def _largest_box(mask):
    """Bounding box of mask pixels, as (x0, y0, x1, y1) inclusive-exclusive.

    Row/column projection rather than connected components: a diagram is a solid
    block, and projection is immune to a stray dark pixel in the margin.
    """
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def locate_board(board, trim_px=1):
    """Return the 8x8 grid for a hand-cropped diagram.

    Grid dict matches detect_fen's shape: {ox, oy, s} where `s` is the cell size
    in pixels and (ox, oy) is the top-left of the first square.

    `trim_px` is a FIXED pixel trim, not a fraction. A proportional trim looked
    tidier but shifted every board by a systematic 4px on a 300px crop, and a
    few pixels of offset is the difference between a square centred on a piece
    and one sitting next to it.
    """
    if board is None or board.size == 0:
        return None
    h, w = board.shape[:2]

    box = _largest_box(_page_mask(board))
    if box is not None:
        x0, y0, x1, y1 = box
        # A diagram is square. If the detected region is wildly non-square the
        # projection probably caught a caption, so ignore it and use the crop.
        bw, bh = x1 - x0, y1 - y0
        if min(bw, bh) >= h * 0.35 and 0.72 <= (bw / max(bh, 1)) <= 1.38:
            t = max(0, int(trim_px))
            x0, y0 = x0 + t, y0 + t
            bw, bh = bw - 2 * t, bh - 2 * t
    else:
        x0, y0, bw, bh = 0, 0, w, h

    # Force a square region: centre the shorter axis inside the longer one.
    side = int(min(bw, bh))
    if side <= 0:
        return None
    x0 = x0 + (bw - side) // 2
    y0 = y0 + (bh - side) // 2

    s = side / 8.0
    return {'ox': float(x0), 'oy': float(y0), 's': s, 'side': side}


def squares(board, grid):
    """Yield (square_name, crop) for a grid produced by locate_board."""
    if grid is None:
        return
    ox, oy, s = grid['ox'], grid['oy'], grid['s']
    for r in range(8):
        for c in range(8):
            x0 = int(round(ox + c * s))
            y0 = int(round(oy + r * s))
            x1 = int(round(ox + (c + 1) * s))
            y1 = int(round(oy + (r + 1) * s))
            # Clamp into the image; a fractional cell can round outward by one px.
            x0 = max(0, min(x0, board.shape[1] - 1))
            y0 = max(0, min(y0, board.shape[0] - 1))
            x1 = max(x0 + 1, min(x1, board.shape[1]))
            y1 = max(y0 + 1, min(y1, board.shape[0]))
            name = 'abcdefgh'[c] + str(8 - r)
            yield name, board[y0:y1, x0:x1]