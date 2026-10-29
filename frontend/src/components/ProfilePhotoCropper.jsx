/* ProfilePhotoCropper — the 1:1 crop step before a profile photo is uploaded.
 *
 * WHY THE CROP LIVES HERE, NOT IN CSS
 * `object-fit: cover` centres the IMAGE, not the person in it: a photo with the
 * face off to one side stays off to one side in every circular avatar. The
 * stored file itself has to be the square the user chose, so this dialog is the
 * only place the subject gets centred — and every surface then shows a square
 * image with nothing to re-crop.
 *
 * The previews use the same crop rectangle as the export, so what the user sees
 * in the circle and the square is exactly the 512px file that gets uploaded. */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import Button from './Button';
import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { cropImageToBlob, cropImageToDataUrl } from '../utils/cropImage';

const PREVIEW_STYLE = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
  display: 'block',
};

export default function ProfilePhotoCropper({
  open,
  src,
  saving = false,
  onCancel,
  onSave,
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState(null);
  const [preview, setPreview] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  /* Back closes the crop instead of leaving My Profile. */
  useOverlayHistory('profile-photo-crop', open, onCancel);

  /* A new file means a new crop: reset the position and zoom so the previous
     photo's framing cannot leak into the next one. */
  useEffect(() => {
    if (!open) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setPreview(null);
    setError('');
  }, [open, src]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  /* Live previews, redrawn from the SAME rectangle the Save exports. */
  useEffect(() => {
    if (!open || !src || !area) return undefined;
    let alive = true;
    cropImageToDataUrl(src, area, 144)
      .then((url) => { if (alive) setPreview(url); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [open, src, area]);

  const handleComplete = useCallback((_croppedArea, pixels) => {
    setArea((prev) => (
      prev
      && prev.x === pixels.x && prev.y === pixels.y
      && prev.width === pixels.width && prev.height === pixels.height
        ? prev
        : pixels
    ));
  }, []);

  const save = async () => {
    if (!area || !src) return;
    setExporting(true);
    setError('');
    try {
      const blob = await cropImageToBlob(src, area, 512);
      await onSave(blob);
    } catch (err) {
      setError(err?.message || 'Could not crop the photo.');
    } finally {
      setExporting(false);
    }
  };

  if (!open || !src) return null;
  const busy = exporting || saving;

  /* Portalled to <body>: the routed page sits in an animated wrapper that makes
     its own stacking context, which would paint the sticky app bar over this
     dialog and hide its title on short screens. */
  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] overflow-y-auto bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-crop-title"
      onClick={busy ? undefined : onCancel}
    >
      {/* A flex column with justify-center keeps the dialog centred when it
          fits and lets it scroll from the top when it doesn't — a grid
          `place-items-center` overflows upward and hides the title. */}
      <div className="flex min-h-full flex-col justify-center p-3 sm:p-6">
        <div
          className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-ivory-700/50 bg-ink-800 p-4 sm:p-5"
          style={{ animation: 'board-pop .3s both' }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="photo-crop-title" className="text-lg font-semibold text-ivory-100">
            Crop your photo
          </h2>
          <p className="mt-1 text-xs text-ivory-500">
            Drag the photo and use the slider so your face sits in the middle. The saved photo is
            square, so it looks the same in your round profile avatar and the square leaderboard tile.
          </p>

          <div className="photo-crop-stage relative mt-4 w-full overflow-hidden rounded-xl">
            <Cropper
              key={src}
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              objectFit="cover"
              showGrid={false}
              minZoom={1}
              maxZoom={3}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleComplete}
            />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-ivory-500">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="photo-crop-zoom flex-1"
              aria-label="Zoom"
            />
          </div>

          <div className="mt-4 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="photo-crop-preview photo-crop-preview--circle">
                {preview && <img src={preview} alt="" style={PREVIEW_STYLE} />}
              </span>
              <span className="text-[0.7rem] text-ivory-500">Profile</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="photo-crop-preview photo-crop-preview--square">
                {preview && <img src={preview} alt="" style={PREVIEW_STYLE} />}
              </span>
              <span className="text-[0.7rem] text-ivory-500">Leaderboard</span>
            </div>
          </div>

          {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" size="md" className="!px-4 !py-2 text-sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              className="!px-4 !py-2 text-sm"
              onClick={save}
              disabled={busy || !area}
            >
              {busy ? 'Saving…' : 'Save photo'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
