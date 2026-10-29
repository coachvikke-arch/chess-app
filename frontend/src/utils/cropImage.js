/* Canvas helpers for the 1:1 profile-photo crop.
 *
 * The crop area comes from react-easy-crop in SOURCE-image pixels
 * (`croppedAreaPixels`), so drawing it straight onto a square canvas is a
 * 1:1 copy of what the user positioned — no re-deriving zoom/offset here,
 * which is what keeps the saved photo identical to the preview. */

/** Decode `src` (object URL / data URL / remote URL) into an HTMLImageElement. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

/** Draw the selected crop square onto a fresh `size`×`size` canvas. */
function drawCrop(image, area, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  /* Clamp so a rounding overshoot at the image edge cannot sample transparent
     pixels into the saved portrait. */
  const maxX = Math.max(0, image.naturalWidth - 1);
  const maxY = Math.max(0, image.naturalHeight - 1);
  const x = Math.min(Math.max(0, area.x), maxX);
  const y = Math.min(Math.max(0, area.y), maxY);
  const width = Math.min(Math.max(1, area.width), image.naturalWidth - x);
  const height = Math.min(Math.max(1, area.height), image.naturalHeight - y);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x, y, width, height, 0, 0, size, size);
  return canvas;
}

/**
 * Export the crop as a square image Blob.
 * JPEG by default: it is what the upload endpoint and every avatar renderer
 * already expect, and 512px sits well below the server's 5MB limit.
 */
export async function cropImageToBlob(src, area, size = 512, type = 'image/jpeg', quality = 0.92) {
  if (!area || !(area.width > 0) || !(area.height > 0)) {
    throw new Error('Pick an area to crop first.');
  }
  const image = await loadImage(src);
  const canvas = drawCrop(image, area, size);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not export the photo.'))),
      type,
      quality,
    );
  });
}

/** Small data-URL version of the same crop, for the modal's live previews. */
export async function cropImageToDataUrl(src, area, size = 128) {
  if (!area || !(area.width > 0) || !(area.height > 0)) return null;
  const image = await loadImage(src);
  return drawCrop(image, area, size).toDataURL('image/jpeg', 0.85);
}
