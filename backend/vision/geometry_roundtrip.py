#!/usr/bin/env python3
"""Round-trip: page -> crop -> geometry -> 64 squares -> reconstruct."""
import os
import sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import board_geometry as bg


def roundtrip_board(crop, geo):
    """Rebuild the board region from the 64 extracted squares.

    Returns (recon_region, mae, boundary_error_x, boundary_error_y).
    recon is tiled at native square size then resized to 8s x 8s.
    mae compares against the original crop region [oy:oy+8s, ox:ox+8s].
    boundary errors are the subpixel remainders of ox/oy.
    """
    ox, oy, s = float(geo['ox']), float(geo['oy']), float(geo['s'])
    sq = bg.extract_all_squares(crop, geo)
    side = max(4, int(round(s)))
    rows = []
    for r in range(bg.N):
        row = np.hstack([sq[bg.square_name(r, c)] for c in range(bg.N)])
        rows.append(row)
    tiled = np.vstack(rows)
    target = (int(round(8 * s)), int(round(8 * s)))
    recon = cv2.resize(tiled, target, interpolation=cv2.INTER_AREA)
    x0, y0 = int(round(ox)), int(round(oy))
    x1, y1 = x0 + target[0], y0 + target[1]
    cx0, cy0 = max(x0, 0), max(y0, 0)
    cx1, cy1 = min(x1, crop.shape[1]), min(y1, crop.shape[0])
    rx0, ry0 = cx0 - x0, cy0 - y0
    orig = crop[cy0:cy1, cx0:cx1].astype(np.float32)
    rec = recon[ry0:ry0 + (cy1 - cy0), rx0:rx0 + (cx1 - cx0)].astype(np.float32)
    if orig.size == 0:
        mae = float('nan')
    else:
        if orig.ndim == 3:
            mae = float(np.mean(np.abs(orig - rec)))
        else:
            mae = float(np.mean(np.abs(orig - rec)))
    return recon, mae, float(ox - round(ox)), float(oy - round(oy))


def save_roundtrip_figure(crop, recon, geo, mae, path):
    """Side-by-side original | reconstructed | abs-diff figure."""
    ox, oy, s = float(geo['ox']), float(geo['oy']), float(geo['s'])
    x0, y0 = int(round(ox)), int(round(oy))
    H = max(crop.shape[0], recon.shape[0])
    def pad(im):
        out = np.full((H, im.shape[1], 3), 200, np.uint8)
        c = im if im.ndim == 3 else cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
        out[:c.shape[0], :c.shape[1]] = c
        return out
    left = pad(crop)
    mid = pad(recon)
    x1, y1 = x0 + recon.shape[1], y0 + recon.shape[0]
    cx0, cy0 = max(x0, 0), max(y0, 0)
    cx1, cy1 = min(x1, crop.shape[1]), min(y1, crop.shape[0])
    diff = np.full((H, crop.shape[1], 3), 200, np.uint8)
    if cy1 > cy0 and cx1 > cx0:
        o = crop[cy0:cy1, cx0:cx1].astype(np.float32)
        r = recon[cy0 - y0:cy0 - y0 + (cy1 - cy0),
                  cx0 - x0:cx0 - x0 + (cx1 - cx0)].astype(np.float32)
        d = np.mean(np.abs(o - r), axis=2) if o.ndim == 3 else np.abs(o - r)
        d = np.clip(d * 3.0, 0, 255).astype(np.uint8)
        d = cv2.cvtColor(d, cv2.COLOR_GRAY2BGR)
        diff[:d.shape[0], :d.shape[1]] = d
    fig = np.hstack([left, mid, diff])
    banner = ('recon mae=%.2f bx=%.3f by=%.3f s=%.2f conf=%.3f' % (
        mae, ox - round(ox), oy - round(oy), s,
        float(geo.get('confidence', 0))))
    cv2.putText(fig, banner, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(fig, banner, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (0, 0, 0), 1, cv2.LINE_AA)
    cv2.imwrite(path, fig)
    return path
