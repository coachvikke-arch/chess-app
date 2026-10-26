import sys, os, numpy as np, cv2
sys.path.insert(0, r'backend\vision')
import detect_fen as df
import detect_page as dp

img = cv2.imread(r'backend\vision\tests\_page.png')
h, w = img.shape[:2]
k = min(1.0, 1600.0 / max(h, w))
work = cv2.resize(img, (int(w * k), int(h * k))) if k < 1 else img
wh, ww = work.shape[:2]
win = int(dp.WIN_FRAC * min(wh, ww))
stride = max(32, int(win * dp.STRIDE_FRAC))
pad = win
padded = np.full((wh + 2 * pad, ww + 2 * pad, 3), 255, np.uint8)
padded[pad:pad + wh, pad:pad + ww] = work

cands = []
y = 0
while y + win <= wh + 2 * pad:
    x = 0
    while x + win <= ww + 2 * pad:
        g = df.find_grid(padded[y:y + win, x:x + win])
        if g is not None and g['score'] >= dp.MIN_WIN_SCORE:
            cands.append((round(g['score'], 1), x + g['ox'] - pad, y + g['oy'] - pad, 8 * g['s']))
        x += stride
    y += stride
cands.sort(key=lambda t: -t[0])
for c in cands:
    print('cand', c)
print('--- decisions ---')
kept = []
for score, cx, cy, cs in cands:
    if cs < 96 or cs > 0.75 * min(wh, ww):
        continue
    cxx, cyy = cx + cs / 2.0, cy + cs / 2.0
    nested = any(kx <= cxx <= kx + ks and ky <= cyy <= ky + ks for kx, ky, ks in kept)
    if nested:
        print('  NESTED skip', (cx, cy, cs), 'vs', kept); continue
    cov = kept and max((dp.iou((cx, cy, cs, cs), (kx, ky, ks, ks)) for kx, ky, ks in kept), default=0)
    cov = cov or 0
    if cov > 0.55:
        print('  IOU   skip', (cx, cy, cs), 'cov', round(cov, 2), 'vs', kept); continue
    kept.append((cx, cy, cs))
    print('  KEEP', (cx, cy, cs))
print('final', kept)