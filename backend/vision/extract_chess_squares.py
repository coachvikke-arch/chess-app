#!/usr/bin/env python3
"""Extract the 8x8 squares of every chess diagram on a scanned page.

Production dataset tool. Board boxes come from detect_page; grid geometry
comes ONLY from board_geometry (single source of truth). This module owns:
- locate board bounding boxes
- crop board from page at full resolution
- invoke shared geometry
- save the 64 outputs
- generate debug/contact artifacts
- write metadata

It MUST NOT compute square rectangles by hand (no ox+c*s math here).
"""
import os
import sys
import json
import argparse
import datetime

import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import detect_page as dp  # noqa: E402
import board_geometry as bg  # noqa: E402


def locate_boards(img):
    """Return [(x, y, side)] in FULL page pixels for every board on the page."""
    h0, w0 = img.shape[:2]
    k = min(1.0, dp.PAGE_MAX_DIM / float(max(h0, w0)))
    if k < 1.0:
        work = cv2.resize(img, (int(w0 * k), int(h0 * k)),
                          interpolation=cv2.INTER_AREA)
    else:
        work = img
    boxes = []
    for cx, cy, cs in dp.find_all_boards(work):
        side = int(round(cs / k))
        x0 = int(round(cx / k))
        y0 = int(round(cy / k))
        side = max(8, min(side, min(w0 - x0, h0 - y0)))
        if side < 96:
            continue
        boxes.append((x0, y0, side))
    boxes.sort(key=lambda b: (round(b[1] / 100), b[0]))
    return boxes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image', nargs='?', default=None)
    ap.add_argument('--out', default='debug_dataset')
    ap.add_argument('--sheet', action='store_true')
    ap.add_argument('--overlay', action='store_true')
    ap.add_argument('--zoom', default='')
    ap.add_argument('--zoom-only', action='store_true')
    args = ap.parse_args()

    if args.zoom_only:
        print(json.dumps({'error': 'zoom-only removed with legacy path'}))
        sys.exit(2)
    if not args.image:
        print(json.dumps({'error': 'usage: extract_chess_squares.py <page.png> [--out DIR] [--sheet] [--overlay]'}))
        sys.exit(2)

    img = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if img is None:
        print(json.dumps({'error': f'could not read {args.image}'}))
        sys.exit(2)

    os.makedirs(args.out, exist_ok=True)
    boxes = locate_boards(img)
    stamp = datetime.datetime.now().isoformat(timespec='seconds')
    manifest = {'image': os.path.basename(args.image), 'boards': [],
                'generator': 'board_geometry.detect_board_geometry+extract_all_squares',
                'generated_at': stamp,
                'source_page': os.path.abspath(args.image)}

    for i, (x, y, side) in enumerate(boxes, 1):
        bid = f'board_{i:03d}'
        board = img[y:y + side, x:x + side]
        try:
            geo = bg.detect_board_geometry(board)
        except bg.GeometryError as e:
            rej_dir = os.path.join(args.out, bid)
            if os.path.isdir(rej_dir):
                for fn in os.listdir(rej_dir):
                    fp = os.path.join(rej_dir, fn)
                    try:
                        if os.path.isfile(fp):
                            os.remove(fp)
                    except OSError:
                        pass
            else:
                os.makedirs(rej_dir, exist_ok=True)
            with open(os.path.join(rej_dir, 'REJECTED.txt'), 'w') as fh:
                fh.write(f'{bid} INVALID_BOARD_CROP\n{str(e)}\n'
                         f'generated_at={stamp}\n')
            manifest['boards'].append({
                'id': bid, 'x': x, 'y': y, 'side': side,
                'status': 'REJECTED',
                'reason': str(e)[:300],
                'geometry': getattr(e, 'detail', {}),
            })
            print(f'{bid}  box=({x},{y},{side})  REJECTED {str(e)[:120]}')
            continue

        bdir = os.path.join(args.out, bid)
        os.makedirs(bdir, exist_ok=True)
        for fn in os.listdir(bdir):
            if fn.endswith('.png') or fn in ('REJECTED.txt',):
                try:
                    os.remove(os.path.join(bdir, fn))
                except OSError:
                    pass
        squares = bg.extract_all_squares(board, geo)
        for name, tile in squares.items():
            cv2.imwrite(os.path.join(bdir, f'{name}.png'), tile)

        if args.sheet:
            bg.contact_sheet_64(board, geo,
                                os.path.join(bdir, 'contact_sheet.png'))
        if args.overlay:
            bg.geometry_debug(board, geo,
                              os.path.join(bdir, 'board_grid.png'))

        manifest['boards'].append({
            'id': bid, 'dir': bdir, 'x': x, 'y': y, 'side': side,
            'status': 'OK',
            'geometry': {k: (round(float(v), 3)
                             if isinstance(v, (int, float)) else v)
                         for k, v in geo.items()},
        })
        print(f'{bid}  box=({x},{y},{side})  '
              f'geo=ox{geo["ox"]:.2f},oy{geo["oy"]:.2f},s={geo["s"]:.2f} '
              f'conf={geo["confidence"]:.3f}')

    with open(os.path.join(args.out, 'boards.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
    with open(os.path.join(args.out, 'GENERATED_AT.txt'), 'w') as fh:
        fh.write(f'generated_at={stamp}\ngenerator=board_geometry\n'
                 f'source={os.path.abspath(args.image)}\n')
    print(f'\n{len(boxes)} board(s) -> {args.out}  at {stamp}')


if __name__ == '__main__':
    main()
