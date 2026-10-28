#!/usr/bin/env python3
import sys
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from fontTools.ttLib import TTFont as TTFontFile, newTable
from fontTools.ttLib.tables._c_m_a_p import cmap_format_4
from fontTools.ttLib.tables.O_S_2f_2 import Panose

PAGE_W, PAGE_H = 841.89, 595.28
IMAGE_BOX = (0.0, -0.411661, 841.89, 596.103322)

NAVY = (0.043137254901960784, 0.1803921568627451, 0.2901960784313726)
GREY_BODY = (0.28627450980392155, 0.41568627450980394, 0.47843137254901963)
GREY_FIELD = (0.24313725490196078, 0.3843137254901961, 0.4549019607843137)
WHITE = (1.0, 1.0, 1.0)

GID_TO_CHAR = {1: "N", 2: "a", 3: "g", 4: "v", 5: "e", 6: "l", 7: " ", 8: "k"}

def build_name_font(assets_dir):
    src = Path(assets_dir) / "FrenchScriptMT-subset.ttf"
    if not src.exists():
        raise FileNotFoundError(f"Missing font subset: {src}")
    dst = Path(assets_dir) / "FrenchScriptMT-patched.ttf"
    if dst.exists():
        return str(dst)
    f = TTFontFile(str(src))
    order = f.getGlyphOrder()
    cmap = newTable("cmap")
    cmap.tableVersion = 0
    sub = cmap_format_4(4)
    sub.platformID, sub.platEncID, sub.language = 3, 1, 0
    sub.cmap = {ord(ch): order[gid] for gid, ch in GID_TO_CHAR.items()}
    cmap.tables = [sub]
    f["cmap"] = cmap
    name = newTable("name")
    name.names = []
    for nid, s in ((1, "French Script MT Subset"), (2, "Regular"), (4, "French Script MT Subset"), (6, "FrenchScriptMT-Subset")):
        try:
            name.setName(s, nid, 3, 1, 0x409)
        except Exception:
            pass
    f["name"] = name
    upem = f["head"].unitsPerEm
    os2 = newTable("OS/2")
    try:
        for k, v in dict(
            version=3, xAvgCharWidth=int(upem * 0.3), usWeightClass=400,
            usWidthClass=5, fsType=0, ySubscriptXSize=0, ySubscriptYSize=0,
            ySubscriptXOffset=0, ySubscriptYOffset=0, ySuperscriptXSize=0,
            ySuperscriptYSize=0, ySuperscriptXOffset=0, ySuperscriptYOffset=0,
            yStrikeoutSize=0, yStrikeoutPosition=0, sFamilyClass=0,
            fsSelection=0x40, usFirstCharIndex=32, usLastCharIndex=ord("v"),
            sTypoAscender=f["hhea"].ascent, sTypoDescender=f["hhea"].descent,
            sTypoLineGap=0, usWinAscent=max(f["hhea"].ascent, 0),
            usWinDescent=abs(f["hhea"].descent), ulCodePageRange1=1,
            ulCodePageRange2=0, ulUnicodeRange1=0, ulUnicodeRange2=0,
            ulUnicodeRange3=0, ulUnicodeRange4=0, sxHeight=0, sCapHeight=0,
            usDefaultChar=0, usBreakChar=32, usMaxContext=1, achVendID="NONE",
        ).items():
            setattr(os2, k, v)
        os2.panose = Panose()
        f["OS/2"] = os2
    except Exception:
        pass
    post = newTable("post")
    post.formatType = 3.0
    post.italicAngle = 0
    post.underlinePosition = -100
    post.underlineThickness = 50
    post.isFixedPitch = 0
    post.minMemType42 = post.maxMemType42 = 0
    post.minMemType1 = post.maxMemType1 = 0
    f["post"] = post
    f.save(str(dst))
    return str(dst)

def draw_tj(c, x, y, font, size, parts, rgb, tc):
    c.setFillColorRGB(*rgb)
    for part in parts:
        if isinstance(part, str):
            t = c.beginText(x, y)
            t.setFont(font, size)
            t.setCharSpace(tc)
            t.textOut(part)
            c.drawText(t)
            x += pdfmetrics.stringWidth(part, font, size) + tc * len(part)
        else:
            x -= part / 1000.0 * size

def main():
    if len(sys.argv) < 4:
        print("Usage: generate_certificate.py <assets_dir> <bg.png> <output.pdf> <name> <level> <date>", file=sys.stderr)
        sys.exit(1)
    assets_dir = sys.argv[1]
    bg_path = sys.argv[2]
    out_path = sys.argv[3]
    name = sys.argv[4] if len(sys.argv) > 4 else "Student"
    level = sys.argv[5] if len(sys.argv) > 5 else "1"
    date_str = sys.argv[6] if len(sys.argv) > 6 else "9 October 2026"
    
    try:
        font_path = build_name_font(assets_dir)
        pdfmetrics.registerFont(TTFont("FrenchScript", font_path))
    except Exception as e:
        print(f"Font error: {e}", file=sys.stderr)
        sys.exit(1)
    
    c = canvas.Canvas(out_path, pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle(f"Level {level} completed — {name}")
    c.setAuthor("Knight Path Chess Academy")
    c.setSubject(f"Level {level} completed")
    c.setCreator("ReportLab")
    
    x, y, w, h = IMAGE_BOX
    c.drawImage(bg_path, x, y, w, h, mask=None)
    
    # Name
    draw_tj(c, 329.310055, 316.880804, "FrenchScript", 56.424645, [name], NAVY, 0.0)
    # Level ribbon
    draw_tj(c, 366.687062, 226.853026, "Times-Bold", 21.441365, [f"LEVEL {level}"], WHITE, 2.821232)
    # Level badge
    draw_tj(c, 710.581446, 419.118874, "Helvetica-Bold", 9.59219, [f"LEVEL {level}"], WHITE, 0.677096)
    # Description
    draw_tj(c, 239.433125, 189.224559, "Helvetica", 10.720682,
            ["This cer", -40, "tificate recogniz", 15, "es the successful completion of the required tr", 10, "aining,"],
            GREY_BODY, 0.0)
    draw_tj(c, 255.079961, 171.168673, "Helvetica", 10.720682,
            ["pr", 10, "actice", 15, ", and assessment f", 30, "or "], GREY_BODY, 0.0)
    draw_tj(c, 394.513157, 171.168673, "Helvetica-Bold", 10.720682,
            [f"Le", 15, f"vel {level} at Mate Zone Chess Academ", 30, "y", 80, "."],
            GREY_BODY, 0.0)
    # Info
    draw_tj(c, 293.98955, 114.3389, "Helvetica", 11.284929,
            ["Le", 30, "v", 25, "el :", 50, f" Le", 30, "v", 25, f"el {level}"],
            GREY_FIELD, 0.0)
    draw_tj(c, 446.33609, 114.3389, "Helvetica", 11.284929,
            ["Date :", 50, f" {date_str}"], GREY_FIELD, 0.0)
    
    c.showPage()
    c.save()

if __name__ == '__main__':
    main()
