import sys, os, numpy as np, cv2
sys.path.insert(0, r'backend\vision')
import detect_fen as df
import detect_page as dp

img = cv2.imread(r'backend\vision\debug_import\latest_page.png')
h, w = img.shape[:2]
k = min(1.0, 1600.0 / max(h, w))
work = cv2.resize(img, (int(w * k), int(h * k))) if k < 1 else img
wh, ww = work.shape[:2]
print('work', wh, ww)
win = int(0.5 * min(wh, ww))
stride = max(32, int(win * dp.STRIDE_FRAC))
pad = win
padded = np.full((wh + 2 * pad, ww + 2 * pad, 3), 255, np.uint8)
padded[pad:pad + wh, pad:pad + ww] = work

for coarse in (224, 160):
    hits = []
    y = 0
    while y + win <= wh + 2 * pad:
        x = 0
        while x + win <= ww + 2 * pad:
            g = df.find_grid(padded[y:y + win, x:x + win], coarse=coarse)
            if g is not None and g['score'] >= dp.MIN_WIN_SCORE:
                hits.append((round(g['score'], 0), g['ox'], g['oy'], 8 * g['s'], x, y))
            x += stride
        y += stride
    hits.sort(key=lambda t: -t[0])
    print(f'coarse={coarse}: {len(hits)} hits; top:')
    for hh in hits[:8]:
        print('   ', hh)