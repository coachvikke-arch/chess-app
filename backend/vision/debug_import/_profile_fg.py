import sys, os, time, numpy as np, cv2
sys.path.insert(0, r'backend\vision')
import detect_fen as df

img = cv2.imread(r'backend\vision\debug_import\latest_page.png')
h, w = img.shape[:2]
k = min(1.0, 1600.0 / max(h, w))  # same resize the scanner applies
work = cv2.resize(img, (int(w * k), int(h * k))) if k < 1 else img
wh, ww = work.shape[:2]
win = int(0.5 * min(wh, ww))
gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)

win_img = work[int(wh * 0.4):int(wh * 0.4) + win, int(ww * 0.4):int(ww * 0.4) + win]
g = cv2.cvtColor(win_img, cv2.COLOR_BGR2GRAY)
k2 = min(1.0, 224.0 / min(g.shape))
sgray = cv2.resize(g, (int(g.shape[1] * k2), int(g.shape[0] * k2))) if k2 < 1 else g
print('work dims', wh, ww, 'win', win, 'inner coarse dim', sgray.shape)

ii = df.integral_img(sgray)
t0 = time.time()
from_cell = max(12, int(df.MIN_CELL * k2))
count = 0
for s in range(from_cell, min(df.MAX_CELL, int(0.95 * min(sgray.shape) / 8)) + 1):
    maxo = min(sgray.shape) - 8 * s
    if maxo < 0:
        continue
    step = max(3, s // 4)
    for oy in range(0, maxo + 1, step):
        for ox in range(0, maxo + 1, step):
            df.grid_score(ii, ox, oy, s)
            count += 1
print(f'coarse sweep: {count} grid_score calls in {time.time()-t0:.2f}s')

t0 = time.time()
full_gray = cv2.cvtColor(win_img, cv2.COLOR_BGR2GRAY)
s = 46
ox = oy = 0
ii = df.integral_img(full_gray)
ws = s // 4 + 4
n = 0
for oy2 in range(max(0, oy - ws), min(full_gray.shape[0] - 8 * s, oy + ws) + 1, 2):
    for ox2 in range(max(0, ox - ws), min(full_gray.shape[1] - 8 * s, ox + ws) + 1, 2):
        df.grid_score(ii, ox2, oy2, s); n += 1
for s2 in range(max(df.MIN_CELL, s - 3), min(df.MAX_CELL, s + 4)):
    for oy2 in range(max(0, oy - 3), min(full_gray.shape[0] - 8 * s2, oy + 3) + 1):
        for ox2 in range(max(0, ox - 3), min(full_gray.shape[1] - 8 * s2, ox + 3) + 1):
            df.grid_score(ii, ox2, oy2, s2); n += 1
print(f'refinement: {n} grid_score calls in {time.time()-t0:.2f}s')