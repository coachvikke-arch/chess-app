import cv2, numpy as np, json, time

im = cv2.imread('debug_import/page-1790629424084/page.png')
man = json.load(open('../debug_dataset/boards.json'))


def integral(gray):
    ii = np.zeros((gray.shape[0] + 1, gray.shape[1] + 1), np.float64)
    np.cumsum(gray, axis=0, out=ii[1:, 1:])
    np.cumsum(ii[1:, 1:], axis=1, out=ii[1:, 1:])
    return ii


def score_at(ii, ox, oy, s):
    h, w = ii.shape[0] - 1, ii.shape[1] - 1
    xs = np.rint(ox + np.arange(9) * s).astype(int)
    ys = np.rint(oy + np.arange(9) * s).astype(int)
    if xs[0] < 0 or ys[0] < 0 or xs[8] > w or ys[8] > h:
        return -np.inf, None
    dx = np.diff(xs).astype(float)
    dy = np.diff(ys).astype(float)
    if (dx <= 0).any() or (dy <= 0).any():
        return -np.inf, None
    A = ii[ys[:-1][:, None], xs[:-1][None, :]]
    B = ii[ys[:-1][:, None], xs[1:][None, :]]
    C = ii[ys[1:][:, None], xs[:-1][None, :]]
    D = ii[ys[1:][:, None], xs[1:][None, :]]
    cells = (D - B - C + A) / (dy[:, None] * dx[None, :])
    nh = np.abs(cells[:, 1:] - cells[:, :-1]).sum() + np.abs(cells[1:] - cells[:-1]).sum()
    far = np.abs(cells[:, 2:] - cells[:, :-2]).sum() + np.abs(cells[2:] - cells[:-2]).sum()
    return nh - 1.7 * far, cells


def find(img, coarse_dim=240):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float64)
    h, w = gray.shape
    k = min(1.0, coarse_dim / float(min(h, w)))
    sgray = cv2.resize(gray, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA) if k < 1 else gray
    sh, sw = sgray.shape
    ii = integral(sgray)
    smax = int(min(sh, sw) / 8.0)
    smin = max(3, int(8 * k))
    best = None
    for s in range(smin, smax + 1):
        maxo = min(sh, sw) - 8 * s
        if maxo < 0:
            continue
        step = max(1, s // 4)
        oy = 0
        while oy <= maxo:
            ox = 0
            while ox <= maxo:
                v, _ = score_at(ii, ox, oy, s)
                if best is None or v > best[0]:
                    best = (v, float(ox), float(oy), float(s))
                ox += step
            oy += step
    if best is None:
        return None
    v, ox, oy, s = best
    ox, oy, s = ox / k, oy / k, s / k
    ii2 = integral(gray)
    H, W = gray.shape
    # local refine
    cur = score_at(ii2, ox, oy, s)
    bestcfg = (cur[0], ox, oy, s)
    ws = max(2, int(round(s / 4)) + 3)
    for s2 in np.arange(s - 1.5, s + 1.51, 0.25):
        for ox2 in np.arange(ox - ws, ox + ws + 0.01, 1.0):
            for oy2 in np.arange(oy - ws, oy + ws + 0.01, 1.0):
                vv, _ = score_at(ii2, ox2, oy2, s2)
                if vv > bestcfg[0]:
                    bestcfg = (vv, float(ox2), float(oy2), float(s2))
    v, ox, oy, s = bestcfg
    for ox2 in np.arange(ox - 1.0, ox + 1.01, 0.25):
        for oy2 in np.arange(oy - 1.0, oy + 1.01, 0.25):
            for s2 in np.arange(s - 0.6, s + 0.61, 0.15):
                vv, _ = score_at(ii2, ox2, oy2, s2)
                if vv > v:
                    bestcfg = (vv, float(ox2), float(oy2), float(s2))
    return bestcfg


t0 = time.time()
for bb in man['boards']:
    x, y, side = bb['x'], bb['y'], bb['side']
    patch = im[y:y + side, x:x + side]
    r = find(patch)
    print(bb['id'], 'new', round(r[1], 2), round(r[2], 2), round(r[3], 2), round(r[0], 1))
print('elapsed', round(time.time() - t0, 2))
