#!/usr/bin/env python3
"""Generate the 30 bot portrait avatars + default.png.

WHAT THIS IS

Real, unique PNG portraits for every bot in the Play vs Bots catalogue, drawn
procedurally. They replace the two-letter monogram (`Pip` -> "PI") that every
bot currently shows, because the 30 placeholder art files in src/assets/bots/
are all zero bytes.

HONEST SCOPE

These are stylised flat-vector portraits drawn from primitives - NOT AI-painted
semi-realistic illustration. They are consistent, legible at 28px, and every
bot is individually recognisable, which is what the UI needs. To replace them
with painted art later, drop same-named PNGs into the output directory; no code
changes are required.

DESIGN RULES

  - one art style for all 30, with difficulty conveyed by palette, silhouette,
    expression and accessories rather than by changing the style
  - head-and-shoulders, centred, framed so nothing important sits near an edge
    (the UI crops to a rounded square at 28-72px and may crop to a circle)
  - transparent corners with an opaque circular backdrop: safe under
    object-cover in a rounded box AND in a circle, on light and dark cards
  - difficulty ramps: friendly/soft at the bottom, dark/sharp/glowing at the top

Rendered at 4x and downsampled for clean antialiased edges.

Usage:
    python backend/scripts/gen_bot_avatars.py
    python backend/scripts/gen_bot_avatars.py --size 512 --out <dir>
"""

import argparse
import math
import os

from PIL import Image, ImageDraw

S = 4  # supersample factor

# ── palette per tier ─────────────────────────────────────────────────────
TIER_STYLE = {
    'Beginner':     dict(bg=(0xE8, 0xF4, 0xFF), bg2=(0xC9, 0xE6, 0xFF), accent=(0x5A, 0xC8, 0xFA), line=(0x33, 0x4A, 0x5C)),
    'Casual':       dict(bg=(0xE6, 0xF7, 0xF0), bg2=(0xC4, 0xE9, 0xDD), accent=(0x4C, 0xC7, 0xA1), line=(0x2E, 0x4A, 0x42)),
    'Intermediate': dict(bg=(0xEF, 0xEC, 0xFB), bg2=(0xD5, 0xCD, 0xF4), accent=(0x8B, 0x7A, 0xE0), line=(0x3A, 0x33, 0x55)),
    'Advanced':     dict(bg=(0xE9, 0xEC, 0xF2), bg2=(0xC6, 0xCC, 0xD8), accent=(0x6C, 0x7A, 0x93), line=(0x2A, 0x2F, 0x3A)),
    'Expert':       dict(bg=(0xEC, 0xE7, 0xF3), bg2=(0xC6, 0xB6, 0xDC), accent=(0x9B, 0x6F, 0xD9), line=(0x30, 0x22, 0x47)),
    'Master':       dict(bg=(0x1E, 0x22, 0x30), bg2=(0x0E, 0x11, 0x1A), accent=(0xF2, 0xC2, 0x5C), line=(0x08, 0x0A, 0x10)),
}

SKIN = {
    'light': (0xF6, 0xD5, 0xBC), 'warm': (0xE8, 0xBE, 0x9B), 'tan': (0xD3, 0xA0, 0x78),
    'olive': (0xB4, 0x82, 0x5D), 'brown': (0x8A, 0x5A, 0x3B), 'deep': (0x5E, 0x3A, 0x28),
}
HAIR = {
    'black': (0x20, 0x1C, 0x22), 'dark': (0x36, 0x28, 0x22), 'brown': (0x5E, 0x3A, 0x24),
    'auburn': (0x8C, 0x3F, 0x1E), 'blonde': (0xE0, 0xB4, 0x62), 'silver': (0xC6, 0xCC, 0xD6),
    'white': (0xEC, 0xEF, 0xF4), 'red': (0xA8, 0x33, 0x1E), 'teal': (0x2E, 0x8C, 0x8C),
    'violet': (0x6B, 0x4C, 0xA8),
}
CLOTH = {
    'navy': (0x2C, 0x3E, 0x5C), 'teal': (0x1F, 0x6B, 0x6B), 'plum': (0x5B, 0x2F, 0x55),
    'rust': (0x8A, 0x3E, 0x24), 'olive': (0x4A, 0x54, 0x2E), 'slate': (0x3A, 0x42, 0x4C),
    'crimson': (0x7A, 0x1F, 0x2E), 'gold': (0x8A, 0x6A, 0x1E), 'indigo': (0x2A, 0x2C, 0x60),
    'charcoal': (0x24, 0x26, 0x2C),
}
EYE_COLOR = {
    'warm': (0x6B, 0x4A, 0x2E), 'bright': (0x2E, 0x5E, 0x8C), 'violet': (0x6B, 0x3E, 0x8C),
    'green': (0x2E, 0x6B, 0x45), 'silver': (0x8C, 0x96, 0xA6), 'teal': (0x1E, 0x8C, 0x8C),
    'dark': (0x24, 0x28, 0x30), 'amber': (0xB8, 0x7A, 0x1E), 'steel': (0x5E, 0x74, 0x8C),
    'red': (0xC0, 0x2A, 0x1E), 'gold': (0xE0, 0xB4, 0x2E),
}

# ── bot design table ─────────────────────────────────────────────────────
BOTS = {
    'pip':      dict(t='Beginner', skin='light',  hair='blonde', hs='short',    cloth='teal',     face='bigsmile', acc='none',     eye='warm'),
    'mia':      dict(t='Beginner', skin='warm',   hair='brown',  hs='bob',      cloth='plum',     face='smile',   acc='none',     eye='warm'),
    'leo':      dict(t='Beginner', skin='tan',    hair='black',  hs='spiky',    cloth='rust',     face='grin',    acc='none',     eye='bright'),
    'nova':     dict(t='Beginner', skin='olive',  hair='violet', hs='wavy',     cloth='teal',     face='wink',    acc='none',     eye='violet'),
    'toby':     dict(t='Beginner', skin='light',  hair='dark',   hs='bowl',     cloth='olive',    face='calm',    acc='glasses',  eye='warm'),
    'aria':     dict(t='Casual', skin='light',   hair='dark',   hs='long',     cloth='slate',    face='calm',    acc='none',     eye='warm'),
    'finn':     dict(t='Casual', skin='tan',    hair='red',    hs='crop',     cloth='crimson',  face='smirk',   acc='none',     eye='green'),
    'luna':     dict(t='Casual', skin='deep',   hair='black',  hs='moon',     cloth='indigo',   face='calm',    acc='moon',     eye='silver'),
    'kai':      dict(t='Casual', skin='light',  hair='teal',   hs='undercut', cloth='charcoal', face='cool',    acc='visor',    eye='teal'),
    'milo':     dict(t='Casual', skin='olive',  hair='brown',  hs='side',     cloth='navy',     face='think',   acc='glasses',  eye='warm'),
    'zara':     dict(t='Intermediate', skin='tan',   hair='black', hs='wrap',    cloth='plum',     face='focus',   acc='none',     eye='dark'),
    'orion':    dict(t='Intermediate', skin='light', hair='auburn', hs='sweep',  cloth='navy',     face='focus',   acc='none',     eye='green'),
    'theo':     dict(t='Intermediate', skin='warm', hair='dark',  hs='crop',    cloth='olive',    face='think',   acc='scarf',    eye='warm'),
    'maya':     dict(t='Intermediate', skin='brown', hair='black', hs='braid',  cloth='rust',     face='smirk',   acc='none',     eye='amber'),
    'atlas':    dict(t='Intermediate', skin='deep', hair='black', hs='wide',    cloth='slate',    face='stern',   acc='none',     eye='dark'),
    'raven':    dict(t='Advanced', skin='light', hair='black', hs='long',      cloth='charcoal', face='stern',   acc='hood',     eye='violet'),
    'viktor':   dict(t='Advanced', skin='light', hair='silver', hs='crop',     cloth='crimson',  face='stern',   acc='none',     eye='steel'),
    'iris':     dict(t='Advanced', skin='light', hair='white', hs='pony',     cloth='indigo',   face='focus',   acc='none',     eye='teal'),
    'magnuson': dict(t='Advanced', skin='warm',  hair='silver', hs='sweep',    cloth='navy',     face='stern',   acc='glasses',  eye='steel'),
    'serena':   dict(t='Advanced', skin='tan',   hair='black', hs='bun',       cloth='gold',     face='focus',   acc='none',     eye='amber'),
    'cipher':   dict(t='Expert', skin='olive', hair='black', hs='hood',     cloth='charcoal', face='masked', acc='mask',     eye='teal'),
    'phoenix':  dict(t='Expert', skin='tan',   hair='red',    hs='flame',    cloth='rust',     face='fierce',  acc='none',     eye='amber'),
    'titan':    dict(t='Expert', skin='brown', hair='black',  hs='bald',     cloth='charcoal', face='stern',  acc='jaw',      eye='amber'),
    'akira':    dict(t='Expert', skin='light', hair='black',  hs='topknot',  cloth='indigo',   face='focus',   acc='headband', eye='dark'),
    'draco':    dict(t='Expert', skin='deep',  hair='black',  hs='spiky',    cloth='crimson',  face='fierce',  acc='none',     eye='red'),
    'shadow':   dict(t='Master', skin='deep',  hair='black', hs='hood',      cloth='charcoal', face='masked', acc='hood',     eye='violet'),
    'aurora':   dict(t='Master', skin='light', hair='white', hs='long',      cloth='gold',     face='calm',    acc='aura',     eye='teal'),
    'nexus':    dict(t='Master', skin='olive', hair='teal',  hs='undercut',  cloth='charcoal', face='cool',    acc='visor',    eye='teal'),
    'zenith':   dict(t='Master', skin='tan',   hair='silver', hs='sweep',     cloth='indigo',   face='stern',   acc='aura',     eye='gold'),
    'omega':    dict(t='Master', skin='deep',  hair='black', hs='horns',     cloth='charcoal', face='fierce',  acc='horns',    eye='red'),
}

# ── facial landmarks ─────────────────────────────────────────────────────
# Positions are expressed in head-radius units relative to the head centre.
# The first pass used free-floating numbers per feature, which put the hairline
# over the eyes and left the neck visually detached from the shoulders. These
# ratios are the single layout reference and every feature obeys them.
LAND = {
    'skull_top':   -1.16,
    'hairline':    -0.46,   # hair must stop above this or it covers the eyes
    'brow':        -0.30,
    'eye':         -0.04,
    'eye_rx':       0.23,
    'eye_ry':       0.17,
    'nose':         0.34,
    'mouth':        0.60,
    'chin':         1.06,
    'ear':          0.06,
    'neck_top':     0.82,
    'shoulder_top': 1.66,
    'shoulder_hw':  1.62,
}


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def draw_backdrop(img, style, size):
    """Radial gradient disc; corners stay transparent."""
    d = ImageDraw.Draw(img, 'RGBA')
    c = size / 2
    steps = 56
    for i in range(steps, 0, -1):
        t = i / steps
        col = lerp(style['bg2'], style['bg'], t)
        a = int(255 * min(1, (1 - t) * 2.4))
        rad = c * t
        d.ellipse([c - rad, c - rad, c + rad, c + rad], fill=col + (a,))
    d.ellipse([0, 0, size - 1, size - 1], outline=style['line'] + (70,),
              width=max(2, size // 160))


def draw_torso(d, cx, cy, hr, style, cfg):
    """A bust silhouette: ONE wide ellipse whose upper arc forms the shoulder
    line and which runs past the bottom edge of the frame. An earlier version
    used a slab plus separate deltoid circles and the circles read as detached
    blobs beside the head - a single continuous shape avoids that entirely."""
    cloth = CLOTH[cfg['cloth']]
    top = cy + hr * LAND['shoulder_top']
    hw = hr * LAND['shoulder_hw']
    d.ellipse([cx - hw, top, cx + hw, top + hr * 3.0],
              fill=cloth + (255,), outline=style['line'] + (255,),
              width=max(2, int(hr * 0.07)))
    # neckline, clipped visually by sitting inside the ellipse
    d.polygon([(cx - hr * 0.52, top + hr * 0.30), (cx + hr * 0.52, top + hr * 0.30),
               (cx, top + hr * 0.92)],
              fill=lerp(cloth, (0, 0, 0), 0.34) + (255,))


def draw_head(d, cx, cy, hr, style, cfg):
    skin = SKIN[cfg['skin']]
    line_w = max(3, int(hr * 0.075))
    # neck first, started inside the jaw so there is no seam
    d.rectangle([cx - hr * 0.34, cy + hr * (LAND['neck_top'] - 0.4),
                 cx + hr * 0.34, cy + hr * LAND['shoulder_top']],
                fill=lerp(skin, (0, 0, 0), 0.16) + (255,))
    for sign in (-1, 1):
        ex = cx + sign * hr * 0.92
        ey = cy + hr * LAND['ear']
        d.ellipse([ex - hr * 0.15, ey - hr * 0.2, ex + hr * 0.15, ey + hr * 0.24],
                  fill=lerp(skin, (0, 0, 0), 0.12) + (255,),
                  outline=style['line'] + (255,), width=max(2, int(hr * 0.05)))
    d.ellipse([cx - hr * 0.95, cy - hr * 1.1, cx + hr * 0.95, cy + hr * LAND['chin']],
              fill=skin + (255,), outline=style['line'] + (255,), width=line_w)


def draw_eyes(d, cx, cy, gap, rx, ry, style, cfg):
    eye = EYE_COLOR[cfg['eye']]
    sharp = {'focus', 'stern', 'fierce', 'cool', 'masked', 'think'}
    pr = rx * (0.58 if cfg['face'] in sharp else 0.46)
    for sign in (-1, 1):
        ex = cx + sign * gap
        d.ellipse([ex - rx, cy - ry, ex + rx, cy + ry],
                  fill=(0xFB, 0xFB, 0xFD, 255), outline=style['line'] + (90,),
                  width=max(1, int(ry * 0.16)))
        if cfg['face'] == 'wink' and sign > 0:
            d.line([ex - rx * 0.9, cy, ex + rx * 0.9, cy],
                   fill=style['line'] + (255,), width=max(2, int(ry * 0.42)))
            continue
        px = ex + (rx * 0.2 if cfg['face'] in ('focus', 'stern', 'fierce') else 0)
        d.ellipse([px - pr, cy - pr * 1.12, px + pr, cy + pr * 1.12], fill=eye + (255,))
        d.ellipse([px - pr * 0.44, cy - pr * 0.98, px - pr * 0.04, cy - pr * 0.5],
                  fill=(255, 255, 255, 225))


def draw_brows(d, cx, cy, gap, span, style, cfg):
    tilt = {'fierce': 1, 'stern': 0.7, 'focus': 0.35, 'cool': 0.2,
            'smirk': 0.5, 'grin': 0.3, 'bigsmile': 0.2}.get(cfg['face'], 0.12)
    w = max(2, int(span * 0.2))
    for sign in (-1, 1):
        bx = cx + sign * gap
        inner_y = cy - sign * span * 0.5 * tilt
        outer_y = cy + sign * span * 0.5 * tilt + sign * span * 0.18
        d.line([bx - sign * span * 0.55, inner_y, bx + sign * span * 0.62, outer_y],
               fill=style['line'] + (255,), width=w)


def draw_mouth(d, cx, cy, hr, style, cfg):
    w = max(2, int(hr * 0.09))
    f = cfg['face']
    col = style['line'] + (255,)
    if f in ('bigsmile', 'grin'):
        d.pieslice([cx - hr * 0.44, cy - hr * 0.26, cx + hr * 0.44, cy + hr * 0.34],
                    8, 172, fill=(0x7A, 0x2C, 0x38, 255), outline=col, width=w)
        d.pieslice([cx - hr * 0.38, cy - hr * 0.24, cx + hr * 0.38, cy + hr * 0.2],
                   10, 170, fill=(0xFA, 0xF6, 0xF0, 235))
    elif f == 'smile':
        d.arc([cx - hr * 0.38, cy - hr * 0.3, cx + hr * 0.38, cy + hr * 0.32],
              20, 160, fill=col, width=w)
    elif f == 'smirk':
        d.arc([cx - hr * 0.3, cy - hr * 0.24, cx + hr * 0.56, cy + hr * 0.36],
              22, 148, fill=col, width=w)
    elif f in ('stern', 'fierce'):
        d.line([cx - hr * 0.32, cy, cx + hr * 0.32, cy], fill=col, width=w)
        if f == 'fierce':
            d.line([cx - hr * 0.4, cy - hr * 0.14, cx + hr * 0.4, cy - hr * 0.14],
                   fill=col, width=max(2, int(w * 0.6)))
    elif f == 'think':
        d.arc([cx - hr * 0.3, cy - hr * 0.18, cx + hr * 0.3, cy + hr * 0.3],
              195, 345, fill=col, width=w)
    else:
        d.line([cx - hr * 0.26, cy, cx + hr * 0.26, cy], fill=style['line'] + (205,), width=w)


def draw_face(d, cx, cy, hr, style, cfg):
    eye_y = cy + hr * LAND['eye']
    if cfg['face'] != 'masked':
        draw_brows(d, cx, cy + hr * LAND['brow'], hr * 0.40, hr * 0.60, style, cfg)
    draw_eyes(d, cx, eye_y, hr * 0.40, hr * LAND['eye_rx'], hr * LAND['eye_ry'], style, cfg)
    d.line([cx + hr * 0.03, eye_y + hr * 0.20, cx - hr * 0.07, cy + hr * LAND['nose']],
           fill=lerp(SKIN[cfg['skin']], (0, 0, 0), 0.34) + (200,),
           width=max(2, int(hr * 0.07)))
    if cfg['face'] != 'masked':
        draw_mouth(d, cx, cy + hr * LAND['mouth'], hr, style, cfg)


def draw_hair(d, cx, cy, hr, style, cfg):
    """Hair occupies the band between skull_top and hairline. Styles that hang
    lower add pieces to the SIDES, never across the eyes."""
    c = HAIR[cfg['hair']]
    hs = cfg['hs']
    top = cy + hr * LAND['skull_top']
    bot = cy + hr * (LAND['hairline'] + 0.06)
    hw = hr * 1.06

    def cap(extra=0.0, drop=0.0):
        d.pieslice([cx - hw - extra, top, cx + hw + extra, bot + (bot - top) + drop],
                   180, 360, fill=c + (255,))

    def side(sign, w=0.34, down=1.5):
        x0 = cx + sign * hw
        x1 = x0 + sign * hr * w
        d.rounded_rectangle([min(x0, x1), bot - hr * 0.35, max(x0, x1), cy + hr * down],
                            radius=hr * 0.16, fill=c + (255,))

    if hs == 'bald':
        d.arc([cx - hw, top, cx + hw, cy + hr * 0.1], 200, 340,
              fill=c + (255,), width=max(2, int(hr * 0.1)))
    elif hs == 'hood':
        d.pieslice([cx - hr * 1.5, top - hr * 0.4, cx + hr * 1.5, cy + hr * 1.1],
                   180, 360, fill=c + (255,))
        d.ellipse([cx - hr * 1.02, cy - hr * 0.3, cx + hr * 1.02, cy + hr * 1.5], fill=(0, 0, 0, 0))
    elif hs == 'crop':
        cap()
    elif hs == 'undercut':
        cap()
        for sign in (-1, 1):
            x0, x1 = sorted([cx + sign * hr * 0.72, cx + sign * hr * 1.06])
            d.rectangle([x0, bot - hr * 0.2, x1, bot + hr * 0.16],
                        fill=lerp(c, (255, 255, 255), 0.18) + (255,))
    elif hs == 'short':
        cap()
    elif hs == 'bowl':
        d.pieslice([cx - hr * 1.12, top - hr * 0.05, cx + hr * 1.12, bot + hr * 0.42],
                   180, 360, fill=c + (255,))
        d.rectangle([cx - hr * 1.12, bot - hr * 0.1, cx + hr * 1.12, bot + hr * 0.1],
                    fill=c + (255,))
    elif hs == 'wavy':
        cap()
        side(-1, 0.3, 0.9)
        side(1, 0.3, 0.9)
        for i in range(3):
            r = hr * (0.9 - i * 0.16)
            d.arc([cx - r, bot - hr * 0.5, cx + r, bot + hr * 0.5],
                  200 + i * 10, 340 - i * 10, fill=c + (255,), width=max(2, int(hr * 0.11)))
    elif hs == 'long':
        cap()
        side(-1, 0.42, 1.85)
        side(1, 0.42, 1.85)
    elif hs == 'bob':
        cap()
        side(-1, 0.36, 0.98)
        side(1, 0.36, 0.98)
    elif hs == 'spiky':
        cap()
        for i in range(7):
            bx = cx - hr * 0.95 + i * hr * 0.32
            d.polygon([(bx, top + hr * 0.34), (bx - hr * 0.15, top - hr * 0.24),
                       (bx + hr * 0.17, top + hr * 0.34)], fill=c + (255,))
    elif hs == 'flame':
        cap()
        for i in range(5):
            bx = cx - hr * 0.86 + i * hr * 0.43
            h = hr * (0.42 + 0.3 * math.sin(i * 1.9))
            d.polygon([(bx, top + hr * 0.5), (bx - hr * 0.16, top + hr * 0.5 - h),
                       (bx + hr * 0.17, top + hr * 0.5 - h * 0.75)], fill=c + (255,))
    elif hs == 'topknot':
        cap()
        d.ellipse([cx - hr * 0.3, top - hr * 0.44, cx + hr * 0.3, top + hr * 0.08],
                  fill=c + (255,), outline=style['accent'] + (255,), width=max(2, int(hr * 0.07)))
    elif hs == 'pony':
        cap()
        d.rounded_rectangle([cx + hr * 0.86, bot - hr * 0.3, cx + hr * 1.42, cy + hr * 1.35],
                            radius=hr * 0.22, fill=c + (255,))
    elif hs == 'braid':
        cap()
        for i in range(4):
            yy = cy + hr * (0.86 + i * 0.26)
            xo = cx - hr * 1.02 - i * hr * 0.05
            d.ellipse([xo - hr * 0.17, yy, xo + hr * 0.17, yy + hr * 0.3],
                      fill=c + (255,), outline=style['bg2'] + (220,), width=max(1, int(hr * 0.045)))
    elif hs == 'side':
        cap()
        side(-1, 0.4, 1.15)
        d.polygon([(cx - hr * 1.1, bot - hr * 0.5), (cx + hr * 0.7, top + hr * 0.06),
                   (cx + hr * 1.1, bot - hr * 0.6), (cx - hr * 0.3, bot - hr * 0.1)],
                  fill=c + (255,))
    elif hs == 'sweep':
        cap()
        d.polygon([(cx - hr * 1.06, bot - hr * 0.42), (cx + hr * 0.62, top + hr * 0.04),
                   (cx + hr * 1.08, bot - hr * 0.5), (cx - hr * 0.3, bot - hr * 0.06)],
                  fill=c + (255,))
    elif hs == 'moon':
        cap()
        d.ellipse([cx - hr * 0.26, top - hr * 0.52, cx + hr * 0.26, top + hr * 0.06], fill=c + (255,))
    elif hs == 'wrap':
        cap()
        lite = lerp(c, (255, 255, 255), 0.2) + (255,)
        d.rectangle([cx - hr * 1.12, bot - hr * 0.42, cx + hr * 1.12, bot + hr * 0.02], fill=lite)
        d.polygon([(cx + hr * 1.12, bot - hr * 0.42), (cx + hr * 1.5, bot + hr * 0.2),
                   (cx + hr * 1.1, bot + hr * 0.02)], fill=lite)
    elif hs == 'wide':
        cap()
        side(-1, 0.3, 1.0)
        side(1, 0.3, 1.0)
    elif hs == 'horns':
        cap()
        for sign in (-1, 1):
            d.polygon([(cx + sign * hr * 0.72, top + hr * 0.42),
                       (cx + sign * hr * 1.26, top - hr * 0.66),
                       (cx + sign * hr * 1.02, top + hr * 0.5)],
                      fill=lerp(c, (255, 255, 255), 0.1) + (255,))
    else:  # masked
        cap()


def draw_accessory(d, cx, cy, hr, style, cfg):
    acc = cfg['acc']
    accent = style['accent']
    lw = max(2, int(hr * 0.07))
    brow_y = cy + hr * LAND['brow']
    eye_y = cy + hr * LAND['eye']
    mouth_y = cy + hr * LAND['mouth']

    if acc == 'glasses':
        for sign in (-1, 1):
            ex = cx + sign * hr * 0.40
            d.rounded_rectangle([ex - hr * LAND['eye_rx'] - hr * 0.07, eye_y - hr * 0.25,
                                 ex + hr * LAND['eye_rx'] + hr * 0.07, eye_y + hr * 0.25],
                                radius=hr * 0.09, outline=accent + (255,), width=lw)
        d.line([cx - hr * 0.12, eye_y, cx + hr * 0.12, eye_y], fill=accent + (255,), width=lw)
    elif acc == 'visor':
        d.rounded_rectangle([cx - hr * 1.0, eye_y - hr * 0.26, cx + hr * 1.0, eye_y + hr * 0.14],
                            radius=hr * 0.14, fill=accent + (225,))
        d.line([cx - hr * 0.5, eye_y - hr * 0.06, cx + hr * 0.5, eye_y - hr * 0.06],
               fill=(255, 255, 255, 175), width=max(1, int(hr * 0.05)))
    elif acc == 'headband':
        d.rectangle([cx - hr * 1.06, brow_y - hr * 0.34, cx + hr * 1.06, brow_y - hr * 0.08],
                    fill=accent + (255,))
    elif acc == 'hood':
        d.pieslice([cx - hr * 1.5, cy + hr * (LAND['skull_top'] - 0.4),
                    cx + hr * 1.5, cy + hr * 1.5], 180, 358,
                   fill=lerp(HAIR[cfg['hair']], (0, 0, 0), 0.18) + (255,))
        d.ellipse([cx - hr * 1.0, cy - hr * 0.34, cx + hr * 1.0, cy + hr * 1.55], fill=(0, 0, 0, 0))
    elif acc == 'mask':
        d.rounded_rectangle([cx - hr * 0.9, mouth_y - hr * 0.34, cx + hr * 0.9, cy + hr * 0.98],
                            radius=hr * 0.24, fill=(0x16, 0x1A, 0x22, 248),
                            outline=accent + (200,), width=max(1, int(hr * 0.05)))
        for sign in (-1, 1):
            d.line([cx + sign * hr * 0.46, mouth_y - hr * 0.04,
                    cx + sign * hr * 0.74, mouth_y - hr * 0.04],
                   fill=accent + (225,), width=max(1, int(hr * 0.06)))
    elif acc == 'moon':
        d.ellipse([cx + hr * 0.66, cy + hr * (LAND['skull_top'] - 0.16),
                   cx + hr * 1.14, cy + hr * (LAND['skull_top'] + 0.34)],
                  fill=accent + (225,))
    elif acc == 'aura':
        for i, rad in enumerate((1.44, 1.62)):
            d.ellipse([cx - hr * rad, cy + hr * LAND['skull_top'] - hr * 0.2,
                       cx + hr * rad, cy + hr * 1.62],
                      outline=accent + (125 - i * 55,), width=max(2, int(hr * 0.055)))
    elif acc == 'scarf':
        d.rounded_rectangle([cx - hr * 1.0, cy + hr * 1.62, cx + hr * 1.0, cy + hr * 2.1],
                            radius=hr * 0.18, fill=accent + (255,))
    elif acc == 'jaw':
        d.arc([cx - hr * 0.8, mouth_y - hr * 0.1, cx + hr * 0.8, cy + hr * 1.14],
              22, 158, fill=style['line'] + (165,), width=lw)
    elif acc == 'horns':
        for sign in (-1, 1):
            d.polygon([(cx + sign * hr * 0.68, cy + hr * (LAND['skull_top'] + 0.5)),
                       (cx + sign * hr * 1.34, cy + hr * (LAND['skull_top'] - 0.9)),
                       (cx + sign * hr * 1.0, cy + hr * (LAND['skull_top'] + 0.62))],
                      fill=accent + (255,))


def render_bot(cfg, size):
    style = TIER_STYLE[cfg['t']]
    big = size * S
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw_backdrop(img, style, big)
    d = ImageDraw.Draw(img, 'RGBA')

    cx = big / 2
    hr = big * 0.163
    cy = big * 0.395

    draw_torso(d, cx, cy, hr, style, cfg)
    draw_head(d, cx, cy, hr, style, cfg)
    draw_hair(d, cx, cy, hr, style, cfg)
    draw_face(d, cx, cy, hr, style, cfg)
    draw_accessory(d, cx, cy, hr, style, cfg)
    return img.resize((size, size), Image.LANCZOS)


def render_default(size):
    """Neutral pawn silhouette, used when a portrait fails to load."""
    style = dict(bg=(0xE6, 0xEA, 0xF0), bg2=(0xC4, 0xCC, 0xD8),
                 accent=(0x7A, 0x88, 0x9C), line=(0x3A, 0x42, 0x4C))
    big = size * S
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw_backdrop(img, style, big)
    d = ImageDraw.Draw(img, 'RGBA')
    cx, cy, u = big / 2, big * 0.5, big * 0.29
    fill = style['accent'] + (255,)
    d.ellipse([cx - u * 0.40, cy - u * 1.0, cx + u * 0.40, cy - u * 0.2], fill=fill)
    d.polygon([(cx - u * 0.32, cy - u * 0.12), (cx + u * 0.32, cy - u * 0.12),
               (cx + u * 0.54, cy + u * 0.28), (cx - u * 0.54, cy + u * 0.28)], fill=fill)
    d.rounded_rectangle([cx - u * 0.84, cy + u * 0.24, cx + u * 0.84, cy + u * 0.48],
                        radius=u * 0.12, fill=fill)
    d.rounded_rectangle([cx - u * 0.68, cy + u * 0.44, cx + u * 0.68, cy + u * 0.64],
                        radius=u * 0.1, fill=style['line'] + (255,))
    return img.resize((size, size), Image.LANCZOS)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.normpath(os.path.join(here, '..', '..', 'frontend', 'public', 'assets', 'bots'))
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=512)
    ap.add_argument('--out', default=default_out)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    for bot_id, cfg in BOTS.items():
        render_bot(cfg, args.size).save(os.path.join(args.out, f'{bot_id}.png'), 'PNG', optimize=True)
    render_default(args.size).save(os.path.join(args.out, 'default.png'), 'PNG', optimize=True)

    files = sorted(os.listdir(args.out))
    total = sum(os.path.getsize(os.path.join(args.out, f)) for f in files)
    largest = max(os.path.getsize(os.path.join(args.out, f)) for f in files)
    print(f'wrote {len(files)} images to {args.out} at {args.size}x{args.size}')
    print(f'total {total / 1024:.0f} KB, largest {largest / 1024:.0f} KB')


if __name__ == '__main__':
    main()