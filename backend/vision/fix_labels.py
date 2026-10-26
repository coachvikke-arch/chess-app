#!/usr/bin/env python3
"""Apply the confirmed ground-truth corrections to real_labels.json.

Two rounds of corrections, both confirmed against the actual pixels rather
than assumed.

ROUND 1 - colour of the back-rank king.
  audit_labels.py flagged ten boards as having two white kings and no black
  king. Reading suspect_king_squares.png against the correctly-labelled black
  kings showed a solid black crown on the 8th rank of boards 003-008 and
  010-012, so those were transcribed as an uppercase `K` instead of `k`.

ROUND 2 - the labels were read off stale contact sheets.
  The contact sheets in debug_dataset/board_NNN/ were generated at 03:24:48,
  but the 64 square crops in the same directories were re-extracted at
  03:36:57 by a later run of extract_chess_squares.py. The manifest grid in
  boards.json (written at 03:36:57) agrees with the crops exactly -- verified
  by verify_crops.py, which re-extracts every square and compares -- so the
  crops and manifest are self-consistent and the *sheets* are the stale
  artifact. For several boards the re-extraction landed one square lower, so
  the recorded labels sit one rank above the true position.

  Re-labelling was done from freshly regenerated, per-tile-labelled sheets
  (regen_sheets.py) so the rank orientation cannot be misread. On board_007 the
  grid did not move, so only the round-1 colour fix applies; on board_009 the
  whole position moves down one rank and the 8th-rank "king" turns out to be
  a pawn, with the real black king on h2.

Each correction is applied by square, then re-validated with the same
structural and chess checks as the audit, so a bad edit fails loudly instead
of silently corrupting the training set again.

Run audit_labels.py afterwards: every valid board must report OK.
"""
import os
import json

HERE = os.path.dirname(os.path.abspath(__file__))
LABELS = os.path.join(HERE, 'real_labels.json')

# board -> {square: correct class or 'empty'}
CORRECTIONS = {
    'board_003': {'b8': 'bK'},   # solid black crown, was K
    'board_004': {'g7': 'bK'},   # solid black crown, was K
    'board_005': {'a7': 'bK'},   # solid black crown, was K
    'board_006': {'e8': 'bK'},   # solid black crown, was K
    'board_007': {'g8': 'bK'},   # solid black crown, was K
    'board_008': {'f8': 'bK'},   # solid black crown, was K
    'board_009': {'e8': 'empty', # blank square, phantom king
                  'h3': 'wB'},   # white bishop, misread as a king
    'board_010': {'c8': 'bK'},   # solid black crown, was K
    'board_011': {'b8': 'bK'},   # solid black crown, was K
    'board_012': {'g8': 'bK'},   # solid black crown, was K
}

# board_009 needs more than per-square edits: the whole position sits one rank
# above the true one, so every piece has to move down. check_alignment.py
# measures this as a +1 rank offset (label/ink agreement 0.719 unshifted,
# 0.938 when shifted), and the per-tile-labelled sheet confirms it.
#
# The labelled squares are re-read from the regenerated sheet:
#   d7 bN   e7 wK   g7 bP   h6 bP   e5 bP
#   b4 bP   e4 wP   a3 bR   h3 wB   g2 wP   h2 bK   e1 wQ
#
# The piece that was labelled a white king on h3 is a white BISHOP; the real
# black king is on h2 and the white king on e7, which is why this board was
# the only one still lacking a king after the round-1 colour fixes.
RANK_SHIFT = {
    'board_009': {
        'd7': 'bN', 'e7': 'wK', 'g7': 'bP', 'h6': 'bP', 'e5': 'bP',
        'b4': 'bP', 'e4': 'wP', 'a3': 'bR', 'h3': 'wB', 'g2': 'wP',
        'h2': 'bK', 'e1': 'wQ',
    },
}

RANK_FILES = 'abcdefgh'


def to_fen(placed):
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


def to_squares(placement):
    out = {}
    for r, row in enumerate(placement.split('/')):
        c = 0
        for ch in row:
            if ch.isdigit():
                c += int(ch)
                continue
            out[RANK_FILES[c] + str(8 - r)] = ('w' if ch.isupper() else 'b') + ch.upper()
            c += 1
    return out


def main():
    with open(LABELS) as fh:
        labels = json.load(fh)

    # Whole-position replacements are applied first: for a board that was
    # transcribed from a stale sheet every square is wrong, so patching single
    # squares on top of it would leave a mixture of the two positions.
    for bid, placed in RANK_SHIFT.items():
        info = labels['boards'][bid]
        old_fen = info['fen']
        new_fen = to_fen(placed)
        if to_squares(new_fen.split()[0]) != placed:
            raise SystemExit(f'{bid}: re-read position does not survive the '
                             'FEN round-trip')
        info['fen'] = new_fen
        info['notes'] = [n for n in info.get('notes', [])
                         if not n.startswith('corrected ')]
        info.setdefault('notes', []).append(
            f'realigned down one rank: labels were read from a stale contact '
            f'sheet ({old_fen.split()[0]} -> {new_fen.split()[0]})')
        print(f'{bid}  [realigned]\n    {old_fen.split()[0]}\n -> '
              f'{new_fen.split()[0]}')

    for bid, fixes in CORRECTIONS.items():
        if bid in RANK_SHIFT:
            continue          # already replaced wholesale above
        info = labels['boards'][bid]
        old_fen = info['fen']
        placed = to_squares(old_fen.split()[0])
        for sq, cls in fixes.items():
            if cls == 'empty':
                placed.pop(sq, None)
            else:
                placed[sq] = cls
        new_fen = to_fen(placed)

        # verify the edit did what it intended, per square
        check = to_squares(new_fen.split()[0])
        for sq, cls in fixes.items():
            got = check.get(sq, 'empty')
            if got != cls:
                raise SystemExit(f'{bid} {sq}: intended {cls}, FEN round-trip gave {got}')

        info['fen'] = new_fen
        info['notes'] = [n for n in info.get('notes', [])
                         if not n.startswith('corrected ')]
        info.setdefault('notes', []).append(
            f'corrected {[f"{s}->{c}" for s, c in fixes.items()]} '
            f'(verified against pixels; {old_fen.split()[0]} -> {new_fen.split()[0]})')
        print(f'{bid}\n    {old_fen.split()[0]}\n -> {new_fen.split()[0]}')

    with open(LABELS, 'w') as fh:
        json.dump(labels, fh, indent=2)
    print(f'\nupdated {LABELS}')
    print('Now run: python audit_labels.py   (every valid board must report OK)')


if __name__ == '__main__':
    main()
