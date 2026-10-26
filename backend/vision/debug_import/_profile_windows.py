import sys, os, time, numpy as np, cv2
sys.path.insert(0, r'backend\vision')
import detect_fen as df

img = cv2.imread(r'backend\vision\debug_import\latest_page.png')
h, w = img.shape[:2]
win = int(0.5 * min(h, w))
print('dims', h, w, 'win', win)
stride = max(32, int(win * 0.25))
pad = win
padded = np.full((h + 2 * pad, w + 2 * pad, 3), 255, np.uint8)
padded[pad:pad + h, pad:pad + w] = img

# time find_grid on a sampling of windows
n = 0
t_total = 0.0
windows = sum(1 for y in range(0, h + 2 * pad - win + 1, stride) for x in range(0, w + 2 * pad - win + 1, stride))
print('total windows:', windows)
for y in range(0, h + 2 * pad - win + 1, stride * 3):
    for x in range(0, w + 2 * pad - win + 1, stride * 3):
        t0 = time.time()
        g = df.find_grid(padded[y:y + win, x:x + win])
        t_total += time.time() - t0
        n += 1
        if g is not None and g['score'] >= 150:
            print(f'  hit at ({x},{y}) score={g["score"]} side={8*g["s"]}')
print(f'sampled {n} windows, total {t_total:.1f}s, avg {t_total / max(1, n):.3f}s/window -> est full scan {windows * t_total / max(1, n):.1f}s')