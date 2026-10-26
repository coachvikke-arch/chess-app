import sys, os, numpy as np, cv2
sys.path.insert(0, r'backend\vision')
import detect_fen as df
import detect_page as dp

img = cv2.imread(r'backend\vision\debug_import\latest_page.png')
h, w = img.shape[:2]
k = min(1.0, 1600.0 / max(h, w))
work = cv2.resize(img, (int(w * k), int(h * k))) if k < 1 else img
wh, ww = work.shape[:2]
win = int(0.5 * min(wh, ww))
stride = max(32, int(win * dp.STRIDE_FRAC))
pad = win
padded = np.full((wh + 2 * pad, ww + 2 * pad, 3), 255, np.uint8)
padded[pad:pad + wh, pad:pad + ww] = work

# window that previously hit at (816,816) padded coords
W = padded[816:816 + win, 816:816 + win]
g = cv2.cvtColor(W, cv2.COLOR_BGR2GRAY)
k2 = min(1.0, 224.0 / min(g.shape))
sg = cv2.resize(g, (int(g.shape[1] * k2), int(g.shape[0] * k2)))
print('window gray', g.shape, 'downscaled', sg.shape, 'k2', k2, 'MIN_CELL*k2', df.MIN_CELL * k2)

ii = df.integral_img(sg)

def scalar_best():
    best = None
    from_cell = max(12, int(df.MIN_CELL * k2))
    for s in range(from_cell, min(df.MAX_CELL, int(0.95 * min(sg.shape) / 8)) + 1):
        maxo = min(sg.shape) - 8 * s
        if maxo < 0:
            continue
        step = max(3, s // 4)
        for oy in range(0, maxo + 1, step):
            for ox in range(0, maxo + 1, step):
                c, sc = df.grid_score(ii, ox, oy, s)
                if best is None or sc > best[0]:
                    best = (sc, ox, oy, s)
    return best

def vec_best():
    best = None
    from_cell = max(12, int(df.MIN_CELL * k2))
    for s in range(from_cell, min(df.MAX_CELL, int(0.95 * min(sg.shape) / 8)) + 1):
        maxo = min(sg.shape) - 8 * s
        if maxo < 0:
            continue
        step = max(3, s // 4)
        m = df.grid_scores(ii, s, step)
        if m.size == 0:
            continue
        flat = int(np.argmax(m))
        sc = m.flat[flat]
        if best is None or sc > best[0]:
            best = (sc, (flat % m.shape[1]) * step, (flat // m.shape[1]) * step, s)
    return best

b_s = scalar_best()
b_v = vec_best()
print('scalar best:', b_s)
print('vec    best:', b_v)
print('match:', b_s == b_v)

# also compare full maps for one size
s = 34
maxo = min(sg.shape) - 8 * s
step = max(3, s // 4)
mv = df.grid_scores(ii, s, step)
print('vec map shape', mv.shape, 'max', mv.max())
mm = np.full((maxo + 1, maxo + 1), -np.inf)
for oy in range(0, maxo + 1, step):
    for ox in range(0, maxo + 1, step):
        c, sc = df.grid_score(ii, ox, oy, s)
        mm[oy, ox] = sc
print('scalar map slice matches vec:', np.allclose(mv, mm[::step, ::step]), 'maxdiff',
      np.abs(mv - mm[::step, ::step]).max() if mv.size else None)