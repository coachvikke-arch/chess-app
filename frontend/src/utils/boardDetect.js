/* In-browser chessboard position detection.
   Finds an 8x8 grid in the image, detects occupied vs empty squares and
   piece color (white/black) via pixel analysis. Piece *type* can't be told
   from a photo without ML, so detected pieces default to pawns — the user can
   tap squares afterwards to fix types. */

const N = 320; // working canvas size

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

export function integral(N, g) {
  const W = N + 1;
  const ii = new Float64Array(W * W);
  for (let y = 0; y < N; y++) {
    let row = 0;
    for (let x = 0; x < N; x++) {
      row += g[y * N + x];
      ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + row;
    }
  }
  return ii;
}

export function area(ii, W, x, y, w, h) {
  const a = ii[y * W + x];
  const b = ii[y * W + x + w];
  const c = ii[(y + h) * W + x];
  const d = ii[(y + h) * W + x + w];
  return (a - b - c + d) / (w * h);
}

/* checkered-grid fit: strong contrast between neighbours, weak between every-2nd */
export function gridCells(ii, W, ox, oy, s) {
  const cells = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) row.push(area(ii, W, ox + c * s, oy + r * s, s, s));
    cells.push(row);
  }
  let neigh = 0, far = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) neigh += Math.abs(cells[r][c] - cells[r][c + 1]);
  for (let r = 0; r < 7; r++) for (let c = 0; c < 8; c++) neigh += Math.abs(cells[r][c] - cells[r + 1][c]);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) far += Math.abs(cells[r][c] - cells[r][c + 2]);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) far += Math.abs(cells[r][c] - cells[r + 2][c]);
  return { cells, score: neigh - 1.7 * far };
}

export function findBestGrid(ii, W) {
  let best = null;
  for (let s = 16; s <= 44; s++) {
    const max = N - 8 * s;
    if (max < 0) continue;
    const step = Math.max(2, Math.floor(s / 4));
    for (let oy = 0; oy <= max; oy += step) {
      for (let ox = 0; ox <= max; ox += step) {
        const g = gridCells(ii, W, ox, oy, s);
        if (!best || g.score > best.score) best = { ox, oy, s, ...g };
      }
    }
  }
  if (!best) return null;
  /* refine with 1px offsets around the best */
  for (let oy = best.oy - 3; oy <= best.oy + 3; oy++) {
    if (oy < 0 || oy + 8 * best.s > N) continue;
    for (let ox = best.ox - 3; ox <= best.ox + 3; ox++) {
      if (ox < 0 || ox + 8 * best.s > N) continue;
      const g = gridCells(ii, W, ox, oy, best.s);
      if (g.score > best.score) best = { ox, oy, s: best.s, ...g };
    }
  }
  return best;
}

/**
 * Detect the board from an image URL.
 * Returns { placed, fen, occupied, score } where placed maps square → 'wP'|'bP'.
 */
export async function detectBoard(src) {
  const img = await loadImage(src);
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  /* cover-fit, centered */
  const scale = Math.max(N / img.width, N / img.height);
  const w = Math.min(N, img.width * scale);
  const h = Math.min(N, img.height * scale);
  const dx = (N - w) / 2, dy = (N - h) / 2;
  ctx.drawImage(img, dx, dy, w, h);
  const data = ctx.getImageData(0, 0, N, N).data;

  const g = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    g[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }

  const W = N + 1;
  const ii = integral(N, g);
  const best = findBestGrid(ii, W);
  if (!best) return { placed: {}, occupied: 0, score: 0 };

  /* light/dark square references by parity */
  let evenSum = 0, evenN = 0, oddSum = 0, oddN = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if ((r + c) % 2 === 0) { evenSum += best.cells[r][c]; evenN++; }
    else { oddSum += best.cells[r][c]; oddN++; }
  }
  const a = evenSum / evenN, b = oddSum / oddN;
  const lightRef = Math.max(a, b), darkRef = Math.min(a, b);
  const sep = Math.max(1, lightRef - darkRef);
  const mid = (lightRef + darkRef) / 2;
  const thr = Math.max(0.35 * sep, 6);

  const placed = {};
  let occupied = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const v = best.cells[r][c];
      const parityRef = (r + c) % 2 === 0 ? (evenSum / evenN) : (oddSum / oddN);
      const dist = Math.abs(v - parityRef);
      if (dist > thr) {
        occupied++;
        const sq = 'abcdefgh'[c] + (8 - r);
        placed[sq] = v > mid ? 'wP' : 'bP';
      }
    }
  }

  return { placed, occupied, score: Math.round(best.score) };
}