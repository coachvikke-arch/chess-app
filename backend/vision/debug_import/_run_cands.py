import sys, os, numpy as np, cv2, json
sys.path.insert(0, r'backend\vision')
import detect_fen as df
import detect_diagram as dd
import detect_page as dp

img = cv2.imread(r'backend\vision\debug_import\latest_page.png')
h, w = img.shape[:2]
k = min(1.0, 1600.0 / max(h, w))
work = cv2.resize(img, (int(w * k), int(h * k))) if k < 1 else img
wh, ww = work.shape[:2]
cands = dp.find_all_boards(work)
print('candidates:', len(cands))
for cx, cy, cs in cands[:12]:
    x0 = max(0, min(int(round(cx)), ww - cs)) if cs < ww else int(round(cx))
    y0 = max(0, min(int(round(cy)), wh - cs)) if cs < wh else int(round(cy))
    side = int(round(cs))
    crop = work[y0:y0 + side, x0:x0 + side]
    if crop.shape[0] < 64 or crop.shape[1] < 64:
        print('  SKIP tiny', x0, y0, side); continue
    pad = max(6, int(round(cs * 0.06)))
    border_px = int(np.median(crop[:2, :, :].reshape(-1, 3), axis=0).mean())
    padded = np.full((crop.shape[0] + 2 * pad, crop.shape[1] + 2 * pad, 3), border_px, np.uint8)
    padded[pad:pad + int(cs), pad:pad + int(cs)] = crop
    bp = os.path.join(r'backend\vision\debug_import\manual-run', f'dbg_{len(cands)}_{int(cx)}_{int(cy)}.png')
    cv2.imwrite(bp, padded)
    r = dd.run_scan(bp, None)
    print(f'  ({cx:.0f},{cy:.0f}) side={side} -> fen={r.get("fen")!r} err={r.get("error")!r} occ={r.get("occupied")} score={r.get("score")} meth={r.get("method")}')