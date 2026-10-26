#!/usr/bin/env python3
"""Geometry validation runner (phases 1-8). Read-only vs page + labels."""
import os
import sys
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import detect_page as dp
import board_geometry as bg

PAGE = os.path.join(HERE, 'debug_import', 'page-1790629424084', 'page.png')
OUT = os.path.join(HERE, 'geometry_debug')
WANT = [1, 4, 9, 12, 13]

img = cv2.imread(PAGE, cv2.IMREAD_COLOR)
assert img is not None, 'cannot read page'
h0, w0 = img.shape[:2]
k = min(1.0, dp.PAGE_MAX_DIM / float(max(h0, w0)))
work = cv2.resize(img, (int(w0 * k), int(h0 * k)),
                  interpolation=cv2.INTER_AREA) if k < 1.0 else img
cands = dp.find_all_boards(work)
print('candidates:', len(cands))
boxes = []
for (cx, cy, cs) in cands:
    boxes.append((int(round(cx / k)), int(round(cy / k)),
                  int(round(cs / k))))
boxes.sort(key=lambda b: (round(b[1] / 100), b[0]))
for i, b in enumerate(boxes, 1):
    print('box_%03d' % i, b)
os.makedirs(OUT, exist_ok=True)

# PHASE 5 first (cheap)
assert bg.square_index('a8') == (0, 0)
assert bg.square_index('h8') == (0, 7)
assert bg.square_index('a1') == (7, 0)
assert bg.square_index('h1') == (7, 7)
assert bg.square_name(0, 0) == 'a8'
assert bg.square_name(0, 7) == 'h8'
assert bg.square_name(7, 0) == 'a1'
assert bg.square_name(7, 7) == 'h1'
print('COORDINATE MAPPING: PASS')

import detect_fen as df
geos = {}
for n in WANT:
    bid = 'board_%03d' % n
    x, y, side = boxes[n - 1]
    side = max(8, min(side, w0 - x, h0 - y))
    crop = img[y:y + side, x:x + side]
    print('%s: bbox=%d,%d,%d cropshape=%s' % (bid, x, y, side, crop.shape))
    try:
        g = bg.detect_board_geometry(crop)
        geos[bid] = (crop, g, (x, y, side))
        print('%s:\n  bbox=%d,%d,%d\n  ox=%.2f\n  oy=%.2f\n  s=%.3f\n'
              '  confidence=%.4f\n  separation=%.3f\n  agreement=%.4f\n'
              '  rule_strength=%.4f' % (
                  bid, x, y, side, g['ox'], g['oy'], g['s'],
                  g['confidence'], g['separation'], g['agreement'],
                  g['rule_strength']))
        old = df.find_grid(crop)
        if old is not None:
            print('  old: ox=%d oy=%d s=%d score=%.0f' % (
                old['ox'], old['oy'], old['s'], old['score']))
            print('  diff: dox=%.1f doy=%.1f ds=%.2f' % (
                old['ox'] - g['ox'], old['oy'] - g['oy'],
                old['s'] - g['s']))
        # grid debug + contact sheet
        bg.geometry_debug(crop, g, os.path.join(OUT, bid + '_grid.png'))
        if bid != 'board_013':
            bg.contact_sheet_64(crop, g,
                                os.path.join(OUT, bid + '_contact.png'))
            sqdir = os.path.join(OUT, bid + '_squares')
            os.makedirs(sqdir, exist_ok=True)
            allsq = bg.extract_all_squares(crop, g)
            for sq, im in allsq.items():
                cv2.imwrite(os.path.join(sqdir, sq + '.png'), im)
            print('  64 mappings (rect x0,y0,x1,y1 center cx,cy):')
            for sq in bg.squares_in_reading_order():
                (x0, y0, x1, y1), (cx0, cy0) = bg.square_rect(g, sq)
                print('  %s -> [%.1f,%.1f,%.1f,%.1f] c=(%.1f,%.1f)' % (
                    sq, x0, y0, x1, y1, cx0, cy0))
    except bg.GeometryError as e:
        print('%s: REJECTED %s detail=%s' % (bid, e.message, e.detail))
print('done ->', OUT)

# PHASE 7 - round trip: page -> crop -> geometry -> 64 -> reconstruct
sys.path.insert(0, HERE)
import geometry_roundtrip as gr
print('')
print('ROUND TRIP (page->crop->geo->64->reconstruct):')
for bid in ('board_001', 'board_004', 'board_009', 'board_012'):
    crop, g, (x, y, side) = geos[bid]
    recon, mae, bex, bey = gr.roundtrip_board(crop, g)
    gr.save_roundtrip_figure(
        crop, recon, g, mae, os.path.join(OUT, bid + '_roundtrip.png'))
    print('%s\n  boundary_error_x=%.3f\n  boundary_error_y=%.3f\n'
          '  square_size=%.3f\n  grid_confidence=%.4f\n  recon_mae=%.2f' % (
              bid, bex, bey, g['s'], g['confidence'], mae))

