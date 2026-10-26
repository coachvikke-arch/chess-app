import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, encodePng, toRgb } from './lib/png.mjs';

/**
 * Prepare the certificate template artwork.
 *
 * THE PROBLEM
 * The supplied template is a "blank" certificate, but the sample name "Student
 * Name" is baked into the artwork in a calligraphic face. A generated certificate
 * has to show the REAL student's name, so that placeholder has to go — and it
 * cannot simply be painted over with a flat colour, because the background there
 * is a smooth blue-white glow that would show the patch as a visible rectangle.
 *
 * THE FIX
 * Reconstruct the background from real pixels instead. The area around the name
 * is empty artwork immediately above and below the text (the underline and its
 * diamond sit lower down and are part of the design, so they are not touched), so
 * for every erased pixel we interpolate vertically between the genuine pixel at
 * the same x above the text and the genuine pixel at the same x below it. The
 * background varies smoothly in both axes, so the reconstruction is
 * indistinguishable from the surrounding artwork.
 *
 * This runs as a build step rather than at certificate-generation time so the
 * PDF renderer and the on-screen preview both use one identical, pre-cleaned
 * image, and so the cost is paid once rather than per certificate.
 *
 *   node scripts/prepare-certificate-template.mjs
 *
 * Re-run it if the source artwork is ever replaced. The bounds below are
 * verified against the pixels, so a different source fails loudly instead of
 * quietly erasing the wrong thing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src', 'assets', 'certificate-template-source.png');
const OUT = path.join(here, '..', 'src', 'assets', 'certificate-template.png');

/* ── The erase region, measured from the artwork ──────────────────────────
   All values are TEMPLATE PIXELS of the 1490x1055 source.

   The placeholder script occupies x 490..995, y 437..522, and its trailing
   flourish (the tail of the capital "N") carries on down to y 528 around
   x 755..866. So the removal is two boxes, not one:

     A  the main body of the script
     B  the tail below it, starting to the RIGHT of the diamond

   The second box has to begin after the diamond, which occupies x 739..752 on
   exactly those rows — hence the notch rather than one tall rectangle. Rows
   530-531 are the underline and are left alone. */
const ERASE_BOXES = [
  { name: 'script body', x0: 478, y0: 432, x1: 1008, y1: 522 },
  { name: 'script tail', x0: 756, y0: 523, x1: 1008, y1: 529 },
];

/* Rows used to reconstruct the background, chosen because they are clean across
   the full width of the erase box: above the text, and below it but still above
   the underline and the "for successfully completing" line. */
const CLEAN_ABOVE = 420;
const CLEAN_BELOW = 545;

/* "Ink" = anything clearly darker than the pale background. */
function isInk(p) {
  return (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) < 170;
}

const img = readPng(SRC);
console.log(`source : ${path.basename(SRC)}  ${img.width}x${img.height}`);

if (img.width !== 1490 || img.height !== 1055) {
  console.error(
    `\nThe layout coordinates in certificateLayout.json assume a 1490x1055 template.\n`
    + `This source is ${img.width}x${img.height}. Either re-measure the layout or\n`
    + `resize the artwork — do not continue, or every field will be misplaced.`
  );
  process.exit(1);
}

/* ── Verify the region before touching it ────────────────────────────────── */

/* 1. There must be something to erase, or the bounds are stale. */
const countInk = ({ x0, y0, x1, y1 }) => {
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) if (isInk(img.at(x, y))) n += 1;
  }
  return n;
};

let inkInside = 0;
for (const box of ERASE_BOXES) inkInside += countInk(box);
if (inkInside < 2000) {
  console.error(
    `\nOnly ${inkInside} ink pixels inside the erase boxes — expected the placeholder name.\n`
    + 'The source artwork has probably changed. Re-measure before re-running.'
  );
  process.exit(1);
}

/* 2. The rows the background is reconstructed from must be clean across the full
      width of the widest box, or the fill would interpolate from the placeholder. */
for (const [label, row] of [['above', CLEAN_ABOVE], ['below', CLEAN_BELOW]]) {
  const widest = ERASE_BOXES.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
  let dirty = 0;
  for (let x = widest.x0; x <= widest.x1; x += 1) if (isInk(img.at(x, row))) dirty += 1;
  if (dirty > 0) {
    console.error(
      `\nReconstruction row ${row} (${label}) is not clean: ${dirty} ink pixels across the\n`
      + 'erase width. Pick different clean rows, or the placeholder will smear.'
    );
    process.exit(1);
  }
}

/* 3. The design elements around the erase boxes — the diamond sitting on the
      underline — must survive. Rather than guess at their extent, snapshot them
      now and require the counts to be identical after the erase. Ink immediately
      below the box is EXPECTED (that is the diamond); ink inside it is not. */
const DESIGN_BANDS = {
  diamond: { x0: 728, y0: 523, x1: 754, y1: 548 },
  underline: { x0: 300, y0: 530, x1: 1200, y1: 531 },
  subheading: { x0: 300, y0: 548, x1: 1200, y1: 590 },
};

const designBefore = Object.fromEntries(
  Object.entries(DESIGN_BANDS).map(([k, b]) => [k, countInk(b)])
);
console.log(
  `keep   : diamond ${designBefore.diamond}px, underline ${designBefore.underline}px, `
  + `subheading ${designBefore.subheading}px (must be unchanged)`
);

console.log(
  'erase  : '
  + ERASE_BOXES.map((b) => `${b.name} x ${b.x0}..${b.x1}, y ${b.y0}..${b.y1}`).join('  |  ')
);
console.log(`rebuild: interpolated from rows ${CLEAN_ABOVE} and ${CLEAN_BELOW}`);

/* ── Erase by vertical interpolation from the clean rows ─────────────────── */
const span = CLEAN_BELOW - CLEAN_ABOVE;
for (const box of ERASE_BOXES) {
  for (let y = box.y0; y <= box.y1; y += 1) {
    const t = (y - CLEAN_ABOVE) / span;
    for (let x = box.x0; x <= box.x1; x += 1) {
      const top = img.at(x, CLEAN_ABOVE);
      const bottom = img.at(x, CLEAN_BELOW);
      img.set(
        x, y,
        Math.round(top.r + (bottom.r - top.r) * t),
        Math.round(top.g + (bottom.g - top.g) * t),
        Math.round(top.b + (bottom.b - top.b) * t)
      );
    }
  }
}

/* ── Confirm the placeholder is gone and the design survived ─────────────── */
const remaining = ERASE_BOXES.reduce((n, b) => n + countInk(b), 0);
console.log(`\nafter  : ${remaining} ink px remaining in the erase boxes`);

if (remaining > 40) {
  console.error('\nPlaceholder not fully removed — check the bounds.');
  process.exit(1);
}

/* The design elements must be untouched. */
let damaged = 0;
for (const [name, band] of Object.entries(DESIGN_BANDS)) {
  const now = countInk(band);
  if (now !== designBefore[name]) {
    console.error(`\nThe "${name}" changed: ${designBefore[name]} -> ${now} ink px. An erase box overlaps it.`);
    damaged += 1;
  }
}
if (damaged) process.exit(1);
console.log('         diamond, underline and subheading are unchanged');

fs.writeFileSync(OUT, encodePng(toRgb(img), img.width, img.height));
console.log(`\nwritten: ${path.relative(process.cwd(), OUT)}  ${fs.statSync(OUT).size} bytes`);