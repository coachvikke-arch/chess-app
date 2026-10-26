#!/usr/bin/env python3
"""Runtime piece reader for scanned chess crops.

Wraps the model trained by train_real_model.py and adds the two things the
detector needs around it:

* crop validation, so a partial board is rejected with a clear reason instead
  of being fed to piece classification and producing a wrong position;
* per-square results carrying a confidence, and a `needsReview` flag when the
  model is unsure, so a low-confidence piece is never silently inserted.

Chess legality is applied only as a *secondary* check: it can flag an
implausible position for review, but it never edits the visual reading to make
a position legal. Inventing pieces to satisfy a rule is how a detector starts
confidently reporting positions that are not on the page.
"""
import os
import pickle

import numpy as np
import cv2

from realscan_features import piece_vector

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, 'real_model.pkl')
RANK_FILES = 'abcdefgh'

# Below this the piece is reported but flagged for review.
REVIEW_CONF = 0.55
# Below this a piece is not placed at all: the crop is too ambiguous to trust.
MIN_CONF = 0.30


class InvalidCrop(Exception):
    """Raised when the image is not a complete, usable chessboard crop."""

    def __init__(self, message, detail=None):
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


def load_model(path=MODEL_PATH):
    if not os.path.isfile(path):
        raise InvalidCrop(
            'Piece model is not built. Run: python train_real_model.py',
            {'model': path})
    with open(path, 'rb') as fh:
        return pickle.load(fh)


# --------------------------------------------------------------------------
# crop validation
# --------------------------------------------------------------------------

def validate_crop(board):
    """Reject anything that is not a complete 8x8 board before classifying.

    Checks the properties that actually failed in practice: the board must be
    big enough to resolve a glyph, the grid must be found and well formed, all
    8 rows and columns must lie inside the image, and the piece area must be
    plausible for a chess diagram rather than a photo of text.

    Raises InvalidCrop with a human-readable reason; returns the grid on
    success. Grid detection itself is delegated to detect_fen.find_grid so
    validation and detection can never disagree about where the board is.
    """
    import detect_fen as df

    if board is None or board.size == 0:
        raise InvalidCrop('Please crop the complete chessboard.', {'reason': 'empty image'})

    h, w = board.shape[:2]
    if min(h, w) < 96:
        raise InvalidCrop('Please crop the complete chessboard.',
                          {'reason': 'crop too small', 'size': [w, h]})

    # An 8x8 board is square. A tall crop is almost always a board plus a
    # heading or neighbouring diagram, which is what produced the original
    # "Double attack" failure.
    ratio = float(max(h, w)) / float(min(h, w))
    if ratio > 1.45:
        raise InvalidCrop('Please crop the complete chessboard.',
                          {'reason': 'crop is not square; it likely includes surrounding text',
                           'aspect': round(ratio, 2)})

    gray = cv2.cvtColor(board, cv2.COLOR_BGR2GRAY) if board.ndim == 3 else board
    grid = df.find_grid(board)
    if grid is None:
        raise InvalidCrop('Please crop the complete chessboard.',
                          {'reason': 'no chessboard grid found'})

    s = grid['s']
    ox, oy = grid['ox'], grid['oy']
    if s < 8:
        raise InvalidCrop('Please crop the complete chessboard.',
                          {'reason': 'squares too small to read', 'cell': round(s, 1)})

    # All 8 rows and all 8 columns must be present in the image. A clipped
    # board still yields a grid, it just runs off the edge.
    if ox < -1 or oy < -1 or ox + 8 * s > w + 1 or oy + 8 * s > h + 1:
        raise InvalidCrop('Please crop the complete chessboard.',
                          {'reason': 'board is cut off; not all 8 rows/columns fit',
                           'grid': {'ox': round(ox, 1), 'oy': round(oy, 1), 's': round(s, 1)},
                           'size': [w, h]})

    # A real diagram has pieces on a minority of squares and lots of bare
    # board. Text or a photo trips this.
    ink = float((gray < (float(np.percentile(gray, 90)) - 40)).mean())
    if ink > 0.55:
        raise InvalidCrop('Please crop the complete chessboard.',
                          {'reason': 'crop contains too much non-board content',
                           'ink_fraction': round(ink, 3)})

    return grid


# --------------------------------------------------------------------------
# per-square reading
# --------------------------------------------------------------------------

def _squares(grid):
    """Yield (square_name, crop) for all 64 cells of a validated grid."""
    ox, oy, s = grid['ox'], grid['oy'], grid['s']
    for r in range(8):
        for c in range(8):
            y0 = int(round(oy + r * s)); y1 = int(round(oy + (r + 1) * s))
            x0 = int(round(ox + c * s)); x1 = int(round(ox + (c + 1) * s))
            crop = grid['board'][max(0, y0):y1, max(0, x0):x1]
            if crop.size:
                yield RANK_FILES[c] + str(8 - r), crop


def read_board(board, model=None, grid=None):
    """Classify every square of a board crop.

    Returns a dict with `squares` (all 64 readings incl. empties), `placed`
    (only confident pieces), and `needsReview` (squares the model was unsure
    about). Low-confidence pieces are reported but NOT placed, so the FEN is
    built only from evidence the model actually stands behind.
    """
    model = model or load_model()
    grid = dict(grid or validate_crop(board))
    grid['board'] = board

    occ, typ = model['occupancy'], model['type']
    classes = list(occ.classes_)
    e = classes.index('empty')

    squares, placed, review = [], {}, []
    vectors, owners = [], []
    for name, crop in _squares(grid):
        vec, meta = piece_vector(crop, model.get('view_weights'))
        if vec is None:
            squares.append({'square': name, 'piece': None, 'confidence': 0.0,
                            'empty': True, 'inkFrac': round(meta.get('ink_frac', 0.0), 4)})
            continue
        vectors.append(vec); owners.append((name, meta))

    if vectors:
        X = np.array(vectors, dtype=np.float32)
        p_piece = 1.0 - occ.predict_proba(X)[:, e]
        piece_rows = np.nonzero(p_piece >= 0.5)[0]
        type_pred, type_prob = {}, {}
        if len(piece_rows):
            pr = typ.predict_proba(X[piece_rows])
            for k, row in enumerate(piece_rows):
                j = int(np.argmax(pr[k]))
                type_pred[int(row)] = typ.classes_[j]
                type_prob[int(row)] = float(pr[k][j])

        for n, (name, meta) in enumerate(owners):
            if p_piece[n] < 0.5:
                squares.append({'square': name, 'piece': None,
                                'confidence': round(float(p_piece[n]), 3),
                                'empty': True,
                                'inkFrac': round(meta.get('ink_frac', 0.0), 4)})
                continue
            piece = type_pred.get(n)
            conf = round(type_prob.get(n, 0.0), 3)
            rec = {'square': name, 'piece': piece, 'confidence': conf,
                   'empty': False, 'inkFrac': round(meta.get('ink_frac', 0.0), 4)}
            if conf < MIN_CONF:
                # Too ambiguous to place. Surfaced, never inserted.
                rec['dropped'] = True
                rec['reason'] = 'confidence below minimum'
                review.append(rec)
            else:
                placed[name] = piece
                if conf < REVIEW_CONF:
                    rec['needsReview'] = True
                    review.append(rec)
            squares.append(rec)

    return {'squares': squares, 'placed': placed, 'needsReview': review,
            'grid': {k: grid[k] for k in ('ox', 'oy', 's') if k in grid}}



# --------------------------------------------------------------------------
# position assembly
# --------------------------------------------------------------------------

def to_fen(placed):
    """Placement FEN from {square: 'wN'} using the same convention as detect_fen."""
    rows = []
    for r in range(8):
        row, n = [], 0
        for c in range(8):
            p = placed.get(RANK_FILES[c] + str(8 - r))
            if p is None:
                n += 1
                continue
            if n:
                row.append(str(n)); n = 0
            row.append(p[1].upper() if p[0] == 'w' else p[1].lower())
        if n:
            row.append(str(n))
        rows.append(''.join(row))
    return '/'.join(rows) + ' w - - 0 1'


def legality_notes(placed):
    """Flag implausible positions for review. Never edits the position.

    Chess logic here is a secondary signal only. It reports what looks wrong so
    a human can look, but the returned position is exactly what the vision
    stage read: a rule must never add, remove or recolour a piece to make a
    position legal.
    """
    notes = []
    wk = [s for s, p in placed.items() if p == 'wK']
    bk = [s for s, p in placed.items() if p == 'bK']
    if len(wk) > 1:
        notes.append(f'multiple white kings: {sorted(wk)}')
    if len(bk) > 1:
        notes.append(f'multiple black kings: {sorted(bk)}')
    # A missing king is only worth flagging when the other side HAS one. Many
    # printed tactics diagrams show a study position where the mover's king is
    # off the material on the page, and a two-sided position missing one king
    # is the genuinely broken case.
    if not wk and bk:
        notes.append('no white king found')
    if not bk and wk:
        notes.append('no black king found')
    if not wk and not bk:
        notes.append('no kings found')
    if len(wk) == 1 and len(bk) == 1:
        def coord(sq):
            return RANK_FILES.index(sq[0]), int(sq[1])
        wf, wr = coord(wk[0])
        bf, br = coord(bk[0])
        if abs(wf - bf) <= 1 and abs(wr - br) <= 1:
            notes.append('kings are adjacent')
    for colour, limit in (('w', 16), ('b', 16)):
        n = sum(1 for p in placed.values() if p[0] == colour)
        if n > limit:
            notes.append(f'{n} {colour} pieces exceeds the {limit} maximum')
    return notes


# --------------------------------------------------------------------------
# debug rendering
# --------------------------------------------------------------------------

def render_debug(board, result, path, cell=110, pad=4):
    """Board with the 8x8 grid, per-square labels and confidences.

    Written so a developer can see *where* recognition failed rather than only
    reading an aggregate number: each occupied cell is captioned with its piece
    and confidence, flagged cells are outlined, and ground truth can be
    overlaid for a side-by-side diff.
    """
    grid = result['grid']
    ox, oy, s = grid['ox'], grid['oy'], grid['s']
    vis = board.copy()
    for i in range(9):
        gx = int(round(ox + i * s)); gy = int(round(oy + i * s))
        cv2.line(vis, (gx, int(round(oy))), (gx, int(round(oy + 8 * s))), (0, 0, 255), 1)
        cv2.line(vis, (int(round(ox)), gy), (int(round(ox + 8 * s)), gy), (0, 0, 255), 1)

    truth = result.get('truth') or {}
    for rec in result['squares']:
        name = rec['square']
        c = RANK_FILES.index(name[0]); r = 8 - int(name[1])
        x0 = int(round(ox + c * s)); y0 = int(round(oy + r * s))
        x1 = int(round(ox + (c + 1) * s)); y1 = int(round(oy + (r + 1) * s))
        if rec.get('needsReview') or rec.get('dropped'):
            cv2.rectangle(vis, (x0, y0), (x1 - 1, y1 - 1), (0, 140, 255), 2)
        t = truth.get(name)
        if t and t != 'empty' and rec.get('piece') and t != rec['piece']:
            cv2.rectangle(vis, (x0, y0), (x1 - 1, y1 - 1), (255, 0, 255), 2)

    cv2.imwrite(path, cv2.resize(vis, (8 * cell, 8 * cell), interpolation=cv2.INTER_NEAREST))

    # Caption panel: one line per square, so the whole reading is greppable.
    lines = []
    for rec in result['squares']:
        name = rec['square']
        piece = rec.get('piece') or ('empty' if rec.get('empty') else '?')
        flag = ''
        if rec.get('dropped'):
            flag = '  DROPPED (low confidence)'
        elif rec.get('needsReview'):
            flag = '  needsReview'
        t = truth.get(name)
        if t and t != piece:
            flag += f'  TRUTH={t}'
        lines.append(f"{name}: {piece} {rec.get('confidence', 0):.2f}{flag}")
    with open(os.path.splitext(path)[0] + '.txt', 'w') as fh:
        fh.write('fen: ' + result.get('fen', '') + '\n')
        fh.write('\n'.join(lines) + '\n')
        for n in result.get('legality', []):
            fh.write('LEGALITY: ' + n + '\n')
    return lines

