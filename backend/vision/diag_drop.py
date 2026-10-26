import cv2, sys, json, os
sys.path.insert(0, '.')
import realscan_reader as rr
import detect_fen as df
from extract_chess_squares import locate_boards

img = cv2.imread('debug_import/page-1790629424084/page.png')
bx = locate_boards(img)

bj = None
for p in ('../boards.json', 'boards.json', '../debug_dataset/boards.json'):
    if os.path.isfile(p):
        bj = json.load(open(p))
        print('boards.json ->', p)
        break
print('runtime vs stored grid:')
for i, (x, y, s) in enumerate(bx, 1):
    b = img[y:y + s, x:x + s]
    g = df.find_grid(b)
    bid = 'board_%03d' % i
    stored = (bj or {}).get(bid)
    line = '%s runtime ox=%.1f oy=%.1f s=%.1f' % (bid, g['ox'], g['oy'], g['s'])
    if stored:
        line += '  stored %s' % json.dumps(stored)
    print(line)

model = rr.load_model()

print('\n=== pixel compare: runtime crop vs stored crop ===')
import numpy as np
from PIL import Image
for i, (x, y, s) in enumerate(bx, 1):
    bid = 'board_%03d' % i
    b = img[y:y + s, x:x + s]
    same = diff = 0
    for sq in ['a1', 'b8', 'd4', 'g7', 'h3']:
        p = '../debug_dataset/%s/%s.png' % (bid, sq)
        if not os.path.isfile(p):
            continue
        stored = np.array(Image.open(p).convert('RGB'))
        g2 = dict(df.find_grid(b)); g2['board'] = b
        crop = dict(rr._squares(g2))[sq]
        live = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        if live.shape == stored.shape:
            if np.abs(live.astype(int) - stored.astype(int)).mean() < 2:
                same += 1
            else:
                diff += 1
    print('%s  bbox=(%d,%d,%d)  identical=%d  differing=%d' % (bid, x, y, s, same, diff))

print('\n=== stored bbox from boards.json ===')
for rec in bj['boards']:
    print('%s  bbox=(%d,%d,%d)' % (rec['id'], rec['x'], rec['y'], rec['side']))

print('\n=== review sheets: ink-bearing squares + model top-2 ===')
import realscan_reader as rr
import detect_fen as df
from realscan_features import piece_vector
from build_dataset import fen_to_squares

labels = json.load(open('real_labels.json'))['boards']
occ, typ = model['occupancy'], model['type']
e = list(occ.classes_).index('empty')
SQUARES = [f + str(8 - r) for r in range(8) for f in 'abcdefgh']

os.makedirs('review', exist_ok=True)
for i, (x, y, s) in enumerate(bx, 1):
    bid = 'board_%03d' % i
    info = labels.get(bid, {})
    if not info.get('valid'):
        continue
    truth = fen_to_squares(info['fen'])
    board = img[y:y + s, x:x + s]
    g = dict(df.find_grid(board)); g['board'] = board
    crops = dict(rr._squares(g))
    inked, tiles = [], []
    for sq in SQUARES:
        vec, meta = piece_vector(crops[sq])
        if vec is None:
            continue
        pr = typ.predict_proba(vec.reshape(1, -1))[0]
        order = np.argsort(pr)[::-1]
        top = '%s %.2f / %s %.2f' % (typ.classes_[order[0]], pr[order[0]],
                                     typ.classes_[order[1]], pr[order[1]])
        inked.append((sq, truth.get(sq, '.'), top))
        tiles.append((sq, truth.get(sq, '.'), top, crops[sq]))
    print('\n%s  label=%s' % (bid, info['fen']))
    for sq, t, top in inked:
        flag = '  <== LABEL SAYS EMPTY' if t == '.' else ''
        print('   %-3s label=%-4s model: %s%s' % (sq, t, top, flag))

    cell = 150
    cols = 6
    rows = (len(tiles) + cols - 1) // cols
    sheet = np.full((rows * (cell + 46), cols * cell, 3), 255, np.uint8)
    for k, (sq, t, top, crop) in enumerate(tiles):
        r, c = divmod(k, cols)
        sheet[r * (cell + 46):r * (cell + 46) + cell, c * cell:(c + 1) * cell] = cv2.resize(
            crop, (cell, cell), interpolation=cv2.INTER_NEAREST)
        cv2.putText(sheet, sq + ' L=' + t, (c * cell + 3, r * (cell + 46) + cell + 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 0, 0), 1, cv2.LINE_AA)
        cv2.putText(sheet, top, (c * cell + 3, r * (cell + 46) + cell + 33),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 200), 1, cv2.LINE_AA)
    cv2.imwrite('review/%s.png' % bid, sheet)


    print('%s  bbox=(%d,%d,%d)' % (rec['id'], rec['x'], rec['y'], rec['side']))

# --- board_013: overlay the grid it actually found -----------------------
x, y, s = bx[12]
b = img[y:y + s, x:x + s]
g = df.find_grid(b)
vis = b.copy()
ox, oy, sq = g['ox'], g['oy'], g['s']
for r in range(9):
    cv2.line(vis, (int(ox), int(oy + r * sq)), (int(ox + 8 * sq), int(oy + r * sq)), (0, 0, 255), 2)
for c in range(9):
    cv2.line(vis, (int(ox + c * sq), int(oy)), (int(ox + c * sq), int(oy + 8 * sq)), (0, 0, 255), 2)
cv2.imwrite('b013_grid.png', vis)
print('board_013 grid:', {k: round(v, 1) for k, v in g.items() if k in ('ox', 'oy', 's')},
      'crop', b.shape[1], 'grid extent', round(ox + 8 * sq, 1))

# --- dropped white pieces: what did the occupancy model say? -------------
model = rr.load_model()
occ, typ = model['occupancy'], model['type']
e = list(occ.classes_).index('empty')
import json
labels = json.load(open('real_labels.json'))['boards']
from build_dataset import fen_to_squares

# --- every mismatch between the corrected truth and what was read ---------
import numpy as np
from realscan_features import piece_vector
from build_dataset import fen_to_squares

labels = json.load(open('real_labels.json'))['boards']
occ, typ = model['occupancy'], model['type']
e = list(occ.classes_).index('empty')

tiles = []
for i, (x, y, s) in enumerate(bx, 1):
    bid = 'board_%03d' % i
    info = labels.get(bid, {})
    if not info.get('valid'):
        continue
    truth = fen_to_squares(info['fen'])
    board = img[y:y + s, x:x + s]
    grid = dict(rr.validate_crop(board)); grid['board'] = board
    res = rr.read_board(board, model, grid)
    for name in ['abcdefgh'[c] + str(8 - r) for r in range(8) for c in range(8)]:
        t = truth.get(name, 'empty')
        p = res['placed'].get(name, 'empty')
        if t == p:
            continue
        crop = dict(rr._squares(grid))[name]
        vec, meta = piece_vector(crop, model.get('view_weights'))
        if vec is None:
            why = 'VECTOR=None ink=%.4f' % meta.get('ink_frac', 0.0)
        else:
            pp = 1.0 - occ.predict_proba(vec.reshape(1, -1))[0][e]
            pr = typ.predict_proba(vec.reshape(1, -1))[0]
            j = int(np.argmax(pr))
            why = ('p_piece=%.3f -> %s (p=%.2f)' %
                   (pp, 'EMPTY' if pp < 0.5 else typ.classes_[j], pr[j]))
        print('%s %-3s truth=%-4s got=%-4s  %s' % (bid, name, t, p, why))
        tiles.append((bid, name, t, p, crop))

cell = 120
cols = 6
rows = (len(tiles) + cols - 1) // cols
if rows:
    sheet = np.full((rows * (cell + 24), cols * cell, 3), 255, np.uint8)
    for k, (bid, sq, t, p, crop) in enumerate(tiles):
        r, c = divmod(k, cols)
        sheet[r * (cell + 24):r * (cell + 24) + cell, c * cell:(c + 1) * cell] = cv2.resize(
            crop, (cell, cell), interpolation=cv2.INTER_NEAREST)
        cv2.putText(sheet, '%s %s T=%s G=%s' % (bid[-3:], sq, t, p),
                    (c * cell + 3, r * (cell + 24) + cell + 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.36, (0, 0, 200), 1, cv2.LINE_AA)
    cv2.imwrite('mismatch_sheet.png', sheet)
    print('wrote mismatch_sheet.png with', len(tiles), 'tiles')
