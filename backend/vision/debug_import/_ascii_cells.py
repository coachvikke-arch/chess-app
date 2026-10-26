import cv2, numpy as np, sys
sys.path.insert(0, r'backend\vision')

# The crop that produced the garbage read
img = cv2.imread(r'backend\vision\debug_import\manual-run\dbg_24_412_487.png')
print('crop', img.shape)

# detect_fen.detect preprocesses; emulate minimal: flip? just read raw grayscale
g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
s = g.shape[0] // 8
print('cell', s)

def show(cell, name):
    cell = cv2.resize(cell, (24, 24), interpolation=cv2.INTER_AREA)
    rows = []
    for r in range(24):
        lines = []
        for c2 in range(24):
            v = cell[r, c2]
            lines.append('#' if v < 100 else '+' if v < 160 else '.' if v < 210 else ' ')
        rows.append(''.join(lines))
    print(f'--- {name} ---')
    print('\n'.join(rows))

# white king expected around b2 in the misread... b2 was wQ. Also f2 was bK (a black king) — check a1 area
for (r, c, name) in [(7, 1, 'rank8-fileB (expect?)'), (6, 1, 'rank7-fileB'), (0, 1, 'rank1-fileB (a2/b2 row)')]:
    show(g[r*s:(r+1)*s, c*s:(c+1)*s], name)