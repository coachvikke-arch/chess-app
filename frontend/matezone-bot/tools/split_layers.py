#!/usr/bin/env python3
"""One-time splitter for bot-happy.png (341x360).

Produces transparent, same-canvas layers so the floating helper can animate
the head and both arms independently:

    body.png head.png sleeveL.png handL.png sleeveR.png handR.png
    coverL.png coverR.png

Run from anywhere:

    "C:/Users/MANIVEL M/AppData/Local/Programs/Python/Python311/python.exe" \
        frontend/matezone-bot/tools/split_layers.py

The script also writes qa_composite.png and qa_diff.png to the system temp
folder and prints the pixel difference against the original below y=175.
"""

from pathlib import Path
import tempfile

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "bot" / "img" / "bot-happy.png"
OUT = ROOT / "bot" / "img" / "layers"
QA = Path(tempfile.gettempdir()) / "mz-bot-layers-qa"

W, H = 341, 360

SEEDS = {
    "head": [(170, 100), (55, 110), (300, 95), (250, 150), (320, 90), (285, 115), (70, 60)],
    "armL": [(22, 165), (70, 195), (40, 150), (86, 164)],
    "armR": [(255, 225), (285, 270), (240, 215), (222, 249)],
}

# Regions the seeds cannot reach because a glare band or an ink line encloses
# them: the screen segment below its painted reflection, the right ear fin and
# cup, and the two light-blue highlight bands on the arms.
EXTRA = {
    "head": [16, 126, 164],
    "armL": [],
    "armR": [],
}

# Glove regions. Everything else in an arm group is sleeve, so a wrist
# rotation never drags a forearm highlight along.
GLOVE = {"armL": [206], "armR": [419]}

PIVOT = {
    "head": (170, 198),
    "shoulderL": (110, 206),
    "wristL": (55, 172),
    "shoulderR": (232, 208),
    "wristR": (270, 253),
}

NAVY = (43, 15, 90)
MIN_REGION = 40


def load():
    img = Image.open(SRC).convert("RGBA")
    assert img.size == (W, H), f"expected {W}x{H}, got {img.size}"
    return np.array(img)


def colour_cut(a):
    """Split the drawing into outline ink and flat interior regions."""
    rgb, alpha = a[..., :3].astype(np.int16), a[..., 3]
    opaque = alpha > 40
    # Faint antialias pixels still belong to the silhouette; keeping them (with
    # their own alpha) is what stops a hairline from showing at every seam.
    solid = alpha > 8
    outline = (rgb[..., 0] < 100) & (rgb[..., 1] < 80) & (rgb[..., 2] < 150) & opaque
    labels, count = ndi.label(solid & ~outline)
    # Antialias flecks along the silhouette (1-4 px arcs) otherwise win whole
    # outline strips away from the part they belong to, which leaves a ghost
    # ring behind when that part moves. Fold them into the nearest real region.
    sizes = ndi.sum(np.ones_like(labels), labels, range(1, count + 1))
    keep = np.isin(labels, [i + 1 for i, n in enumerate(sizes) if n >= MIN_REGION])
    fragments = (labels > 0) & ~keep
    # Distance to the nearest kept region, restricted to solid pixels so the
    # transparent background is never folded into a part.
    _, (fy, fx) = ndi.distance_transform_edt(~keep, return_indices=True)
    labels = np.where(fragments, labels[fy, fx], labels)
    merged = int(fragments.sum())
    # Every outline pixel joins the interior region it is closest to, so each
    # pixel ends up bounded by the character's own ink lines.
    _, (iy, ix) = ndi.distance_transform_edt(labels == 0, return_indices=True)
    full = np.where(outline, labels[iy, ix], labels).astype(np.int32)
    print(f"regions: {count} (folded {merged} px of fragments)")
    return solid, outline, full


def grouped_masks(full, solid, outline, seeds):
    masks = {}
    for name, points in seeds.items():
        ids = set(EXTRA.get(name, []))
        for x, y in points:
            label = int(full[y, x])
            print(f"  seed {name} ({x},{y}) -> region {label} ({(full == label).sum()} px)")
            if label > 0:
                ids.add(label)
        mask = np.isin(full, list(ids))
        masks[name] = ndi.binary_fill_holes(mask) & solid

    assigned = masks["head"] | masks["armL"] | masks["armR"]
    masks["body"] = solid & ~assigned
    return masks


def overlap_outline(mask, outline, px):
    """Duplicate a couple of outline pixels onto a moving layer so the seam
    never opens when it rotates. Floating outline slivers that the distance
    test picks up are dropped, or they travel as detached hairs."""
    distance = ndi.distance_transform_edt(~mask)
    grown = mask | (outline & (distance <= px))
    lab, _ = ndi.label(grown, structure=np.ones((3, 3), np.uint8))
    keep = np.unique(lab[mask])
    keep = keep[keep > 0]
    return np.isin(lab, keep)


def clean_body(masks, outline):
    """Drop the thin anti-alias frontier left on the body and hand it to the
    nearest moving layer, otherwise it peeks out as a hairline ghost."""
    kernel = np.ones((3, 3), np.uint8)
    body = masks["body"].astype(np.uint8)
    opened = cv2.dilate(cv2.morphologyEx(body, cv2.MORPH_OPEN, kernel), kernel, iterations=1) > 0
    removed = (body > 0) & ~opened

    candidates = masks["head"] | masks["armL"] | masks["armR"]
    distance, (iy, ix) = ndi.distance_transform_edt(~candidates, return_indices=True)
    head_at = masks["head"][iy, ix]
    arm_l_at = masks["armL"][iy, ix]
    arm_r_at = masks["armR"][iy, ix]

    to_head = removed & (distance <= 3) & head_at
    to_arm_l = removed & (distance <= 3) & ~to_head & arm_l_at
    to_arm_r = removed & (distance <= 3) & ~to_head & ~to_arm_l & arm_r_at
    handed = to_head | to_arm_l | to_arm_r

    masks["body"] = masks["body"] & ~handed
    masks["head"] = masks["head"] | to_head
    masks["armL"] = masks["armL"] | to_arm_l
    masks["armR"] = masks["armR"] | to_arm_r
    print(f"body opening: removed {int(removed.sum())} px, reassigned {int(handed.sum())} px")
    return masks


def clean_face(a, head_mask, opaque):
    """Erase the painted eyes, brows, mouth and glare so the animated SVG face
    owns the screen."""
    rgb = a[..., :3]
    cyan = (
        (rgb[..., 1] > 140) & (rgb[..., 2] > 140) & (rgb[..., 0] < 190) & opaque
    ) & head_mask
    count, labels, stats, _ = cv2.connectedComponentsWithStats(cyan.astype(np.uint8), 8)
    if count < 2:
        raise SystemExit("no cyan screen found")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    screen = labels == largest

    # The screen outline wraps the eyes and mouth, so the filled outer contour
    # is the whole glass panel. Erode it to stay clear of the bevel.
    contours, _ = cv2.findContours(screen.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    panel = np.zeros((H, W), np.uint8)
    cv2.drawContours(panel, contours, -1, 255, -1)
    interior = cv2.erode(panel, np.ones((9, 9), np.uint8)) > 0
    features = head_mask & interior & ~screen
    mask = cv2.dilate(features.astype(np.uint8), np.ones((7, 7), np.uint8)) * 255
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    painted = cv2.cvtColor(cv2.inpaint(bgr, mask, 7, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB)

    cleaned = rgb.copy()
    cleaned[mask > 0] = painted[mask > 0]
    print(f"face: cleaned {int((mask > 0).sum())} px inside the screen")
    return cleaned


def fill_under_head(a, rgb, masks):
    """The helmet hides part of the chest. Paint that area into the body layer
    so a head tilt never reveals a hole."""
    body = masks["body"].astype(np.uint8)
    distance = ndi.distance_transform_edt(body == 0)
    ys = np.arange(H)[:, None]
    hidden = masks["head"] & (distance <= 26) & (ys > 160)
    # Snap the ragged antialias edge to a smooth surface and borrow two pixels
    # of the helmet's own feathered alpha, otherwise the smear shows as a grey
    # stair-stepped fringe the moment the helmet lifts.
    hidden = cv2.morphologyEx(
        hidden.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)
    )
    hidden = cv2.dilate(hidden, np.ones((3, 3), np.uint8), iterations=2) > 0
    hidden &= masks["body"] | masks["head"]
    hidden &= a[..., 3] > 8

    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    filled = cv2.cvtColor(
        cv2.inpaint(bgr, hidden.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA),
        cv2.COLOR_BGR2RGB,
    )
    lum = filled.astype(np.float32).mean(axis=2)
    smudge = hidden & (lum < 215)
    filled[smudge] = (213, 234, 249)

    out = rgb.copy()
    out[hidden] = filled[hidden]
    masks["body"] = masks["body"] | hidden
    print(f"under-head fill: {int(hidden.sum())} px ({int(smudge.sum())} brightened)")
    return out


def layer_rgba(rgb, alpha, mask, solid_alpha=255):
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = np.where(mask[..., None], rgb, 0)
    out[..., 3] = np.where(mask, np.where(alpha > 0, alpha, solid_alpha), 0)
    return out


def draw_cap(canvas, cx, cy, radius, fill):
    cv2.circle(canvas, (cx, cy), radius, fill, -1, cv2.LINE_AA)
    cv2.circle(canvas, (cx, cy), radius, NAVY, 3, cv2.LINE_AA)
    disc = np.zeros((H, W), np.uint8)
    cv2.circle(disc, (cx, cy), radius, 255, -1)
    canvas[..., 3] = np.where(disc > 0, 255, canvas[..., 3])


def paste(canvas, rgba, mask):
    canvas[mask] = rgba[mask]


def arm_colour(rgb, mask, outline):
    pixels = rgb[mask & ~outline]
    if not len(pixels):
        return (111, 176, 255)
    return tuple(int(v) for v in np.median(pixels, axis=0))


def main():
    a = load()
    rgb = a[..., :3].copy()
    opaque, outline, full = colour_cut(a)
    masks = grouped_masks(full, opaque, outline, SEEDS)
    masks = clean_body(masks, outline)

    masks["head"] = overlap_outline(masks["head"], outline, 1)
    masks["armL"] = overlap_outline(masks["armL"], outline, 2)
    masks["armR"] = overlap_outline(masks["armR"], outline, 2)
    # The body owns whatever the moving layers no longer own.
    masks["body"] = opaque & ~(masks["head"] | masks["armL"] | masks["armR"])

    head_rgb = clean_face(a, masks["head"], opaque)
    body_rgb = fill_under_head(a, rgb, masks)

    # Gloves are separate ink-bounded regions, so split by region membership
    # instead of a hard row cut: the highlight bands sit above the wrist in
    # canvas space but belong to the forearm.
    hand_l = masks["armL"] & np.isin(full, GLOVE["armL"])
    sleeve_l = masks["armL"] & ~hand_l
    hand_r = masks["armR"] & np.isin(full, GLOVE["armR"])
    sleeve_r = masks["armR"] & ~hand_r

    blue = arm_colour(rgb, masks["armL"] | masks["armR"], outline)

    layer_head = layer_rgba(head_rgb, a[..., 3], masks["head"])
    layer_body = layer_rgba(body_rgb, a[..., 3], masks["body"])

    layer_hand_l = np.zeros((H, W, 4), np.uint8)
    draw_cap(layer_hand_l, *PIVOT["wristL"], 11, blue)
    paste(layer_hand_l, layer_rgba(rgb, a[..., 3], hand_l), hand_l)

    layer_sleeve_l = np.zeros((H, W, 4), np.uint8)
    draw_cap(layer_sleeve_l, *PIVOT["shoulderL"], 16, blue)
    paste(layer_sleeve_l, layer_rgba(rgb, a[..., 3], sleeve_l), sleeve_l)

    layer_hand_r = np.zeros((H, W, 4), np.uint8)
    draw_cap(layer_hand_r, *PIVOT["wristR"], 13, blue)
    paste(layer_hand_r, layer_rgba(rgb, a[..., 3], hand_r), hand_r)

    layer_sleeve_r = np.zeros((H, W, 4), np.uint8)
    draw_cap(layer_sleeve_r, *PIVOT["shoulderR"], 16, blue)
    paste(layer_sleeve_r, layer_rgba(rgb, a[..., 3], sleeve_r), sleeve_r)

    covers = {}
    for side, key in (("L", "shoulderL"), ("R", "shoulderR")):
        cx, cy = PIVOT[key]
        yy, xx = np.mgrid[0:H, 0:W]
        within = (xx - cx) ** 2 + (yy - cy) ** 2 <= 28 ** 2
        covers[side] = masks["body"] & within
    layer_cover_l = layer_rgba(body_rgb, a[..., 3], covers["L"])
    layer_cover_r = layer_rgba(body_rgb, a[..., 3], covers["R"])

    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "body.png": layer_body,
        "head.png": layer_head,
        "sleeveL.png": layer_sleeve_l,
        "handL.png": layer_hand_l,
        "sleeveR.png": layer_sleeve_r,
        "handR.png": layer_hand_r,
        "coverL.png": layer_cover_l,
        "coverR.png": layer_cover_r,
    }
    total = 0
    for name, arr in files.items():
        path = OUT / name
        Image.fromarray(arr, "RGBA").save(path, optimize=True)
        size = path.stat().st_size
        total += size
        print(f"  {name:12s} {size / 1024:6.1f} KB")
    print(f"total {total / 1024:.1f} KB")

    # Visual proof: reassemble in the resting order over white.
    canvas = np.full((H, W, 3), 255, np.uint8)
    stack = [layer_body, layer_head, layer_hand_l, layer_sleeve_l,
             layer_hand_r, layer_sleeve_r, layer_cover_l, layer_cover_r]
    for layer in stack:
        alpha = (layer[..., 3:4].astype(np.float32)) / 255.0
        canvas = (layer[..., :3].astype(np.float32) * alpha
                  + canvas.astype(np.float32) * (1 - alpha)).astype(np.uint8)

    QA.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, "RGB").save(QA / "qa_composite.png")

    original = np.full((H, W, 3), 255, np.uint8)
    mask_a = (a[..., 3:4].astype(np.float32)) / 255.0
    original = (a[..., :3].astype(np.float32) * mask_a
                + original.astype(np.float32) * (1 - mask_a)).astype(np.uint8)

    delta = np.abs(canvas.astype(np.int16) - original.astype(np.int16)).max(axis=2)
    delta[:175] = 0
    differing = int((delta > 8).sum())
    diff_img = original.copy()
    diff_img[delta > 8] = (255, 0, 0)
    Image.fromarray(diff_img, "RGB").save(QA / "qa_diff.png")
    print(f"layer diff below y=175: {differing} px (limit 200)")
    print(f"qa images: {QA}")


if __name__ == "__main__":
    main()
