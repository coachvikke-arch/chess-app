import sys, os
import numpy as np
import cv2

VISION = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/vision
TESTS = os.path.join(VISION, 'tests')
for p in (VISION, TESTS):
    sys.path.insert(0, p)
import detect_fen as df
import make_board as mb

RANK_FILES = 'abcdefgh'

def cell_metrics(pre, gtf):
    """Print candidate luminance metrics per ground-truth occupied square."""
    img = cv2.imread(pre, cv2.IMREAD_COLOR)
    g = df.find_grid(img)
    ox, oy, s = g['ox'], g['oy'], g['s']
    base = img
    cell_colors = np.zeros((8, 8, 3), dtype=np.float32)
    for r in range(8):
        for c in range(8):
            win = base[oy + r*s: oy + (r+1)*s, ox + c*s: ox + (c+1)*s]
            cell_colors[r, c] = np.median(win.reshape(-1, 3), axis=0)
    light_ref, dark_ref, light_idx = df.square_references(cell_colors)
    light_ref = light_ref.astype(np.uint8); dark_ref = dark_ref.astype(np.uint8)
    sep = float(cv2.norm(light_ref - dark_ref, cv2.NORM_L2))
    l_lum = int(cv2.cvtColor(light_ref.reshape(1,1,3), cv2.COLOR_BGR2LAB)[0,0,0])
    d_lum = int(cv2.cvtColor(dark_ref.reshape(1,1,3), cv2.COLOR_BGR2LAB)[0,0,0])
    bg_by_parity = [light_ref, dark_ref]
    def parity_ref(r, c):
        even = (r + c) % 2 == 0
        return bg_by_parity[0] if (even == (light_idx == 0)) else bg_by_parity[1]
    thr = max(24, 0.16 * sep)
    print(f'light_lab={l_lum} dark_lab={d_lum} sep={sep:.0f}')
    rows = []
    for r in range(8):
        for c in range(8):
            sq = RANK_FILES[c] + str(8 - r)
            gt = gtf.get(sq)
            if not gt:
                continue
            bg = parity_ref(r, c)
            cell_full = df.split_square(base, r, c, ox, oy, s)
            cg = cv2.cvtColor(cell_full, cv2.COLOR_BGR2GRAY)
            full_mask = df.clean_mask(
                (np.linalg.norm(cell_full.astype(np.float32) - bg.astype(np.float32), axis=-1) > thr).astype(np.uint8))
            ys, xs = np.nonzero(full_mask)
            if len(xs) == 0:
                rows.append((sq, gt, -1, -1, -1)); continue
            r0, r1 = ys.min(), ys.max() + 1
            c0, c1 = xs.min(), xs.max() + 1
            bh, bw = r1 - r0, c1 - c0
            core = full_mask[r0 + bh//4: r1 - bh//4, c0 + bw//4: c1 - bw//4] > 0
            if core.sum():
                core_med = float(np.median(cg[r0 + bh//4: r1 - bh//4, c0 + bw//4: c1 - bw//4][core]))
            else:
                core_med = float(np.median(cg[full_mask > 0]))
            lum = float(np.median(cg[full_mask > 0]))
            p85 = float(np.percentile(cg[full_mask > 0], 85))
            rows.append((sq, gt, lum, core_med, p85))
    rows.sort(key=lambda t: t[2])
    for sq, gt, lum, cm, p85 in rows:
        print(f'  {sq:>2} gt={gt} lum={lum:6.0f} core={cm:6.0f} p85={p85:6.0f}')


def analyze(fen, gray, scale):
    occ = mb.fen_to_occupied(fen)
    img = mb.build_board(occ, sprites=True)
    if gray:
        img = cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe.png')
    cv2.imwrite(p, img)
    pre = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_pre.png')
    import detect_diagram as dd
    dd.preprocess(p, pre)
    gtf = {}
    ranks = fen.split('/')
    for r, row in enumerate(ranks):
        c = 0
        for ch in row:
            if ch.isdigit():
                c += int(ch)
            else:
                gtf[RANK_FILES[c] + str(8 - r)] = ('w' if ch.isupper() else 'b') + ch.upper()
                c += 1
    print(f'\n== {os.path.basename(pre)} {gray=} {scale=} ==')
    cell_metrics(pre, gtf)

if __name__ == '__main__':
    analyze('8/8/8/4N3/1K1kp3/3P4/7q/8', False, 0.8)
    analyze('8/8/8/4N3/1K1kp3/3P4/7q/8', False, 1.0)
    analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', False, 1.0)
    analyze('8/8/8/8/8/3k4/3Q4/3K4', False, 1.0)
    analyze('8/8/8/4N3/1K1kp3/3P4/7q/8', True, 1.0)
    analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', True, 1.0)