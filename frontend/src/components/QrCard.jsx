import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import api from '../services/api';
import { useToast } from './Toast';
import Modal from './Modal';
import PlayerCard, { PlayerCardSkeleton } from './PlayerCard';
import ShareCardSheet from './ShareCardSheet';
import { cardUrl, fetchPublicCard } from '../utils/cardApi';

/* Gold king badge stamped into the middle of the QR. Drawn as an inline SVG
   data URI so the download canvas can bake it in without a network fetch. */
const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#0a1626"/><rect x="1" y="1" width="38" height="38" rx="8" fill="none" stroke="#c99a2e" stroke-width="1.5"/><text x="20" y="28.5" font-size="23" text-anchor="middle" fill="#f7e08a" font-family="Georgia, 'Times New Roman', serif">&#9818;</text></svg>`;
const BADGE_URI = `data:image/svg+xml;utf8,${encodeURIComponent(BADGE_SVG)}`;
const BADGE_SETTINGS = { src: BADGE_URI, height: 38, width: 38, excavate: true };

/**
 * "My QR card" — one QR per account, on both the student and coach profile.
 * The QR encodes {origin}/card/{public_token}; everything it shows comes from
 * the same public endpoint a scan hits, so the preview cannot drift.
 */
export default function QrCard({ user, onUserUpdate }) {
  const { showToast } = useToast();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [preview, setPreview] = useState({ loading: false, error: false, card: null });
  const [toggling, setToggling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const downloadRef = useRef(null);

  const token = user?.public_token || null;
  const url = token ? cardUrl(token) : null;
  const isPublic = user?.card_public !== false;

  const loadPreview = useCallback(() => {
    if (!token) return;
    setPreview({ loading: true, error: false, card: null });
    fetchPublicCard(token)
      .then((card) => setPreview({ loading: false, error: !card, card }))
      .catch(() => setPreview({ loading: false, error: true, card: null }));
  }, [token]);

  useEffect(() => {
    if (previewOpen) loadPreview();
  }, [previewOpen, loadPreview]);

  const publish = (nextUser) => {
    if (nextUser) onUserUpdate?.(nextUser);
  };

  const togglePublic = async () => {
    setToggling(true);
    try {
      const res = await api.patch('/profile/card', { cardPublic: !isPublic });
      publish(res.data.user);
      showToast(
        !isPublic ? 'Your card is public — the QR works again.' : 'Your card is private — scans will show "Card not available".',
        { tone: 'success', title: 'QR card' }
      );
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not update the card.', { tone: 'error', title: 'QR card' });
    } finally {
      setToggling(false);
    }
  };

  const regenerate = async () => {
    if (!window.confirm('Regenerate your QR? The current QR code and every shared link will stop working.')) return;
    setRegenerating(true);
    try {
      const res = await api.post('/profile/card/regenerate');
      publish(res.data.user);
      showToast('New QR generated — the old one no longer works.', { tone: 'success', title: 'QR card' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not regenerate the QR.', { tone: 'error', title: 'QR card' });
    } finally {
      setRegenerating(false);
    }
  };

  const saveQr = () => {
    const canvas = downloadRef.current?.querySelector('canvas');
    if (!canvas) return;
    try {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `matezone-qr-${user?.username || 'card'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('QR saved as a PNG.', { tone: 'success', title: 'QR card' });
    } catch {
      showToast('Could not save the QR image.', { tone: 'error', title: 'QR card' });
    }
  };

  return (
    <section className="myqr-card" aria-label="My QR card">
      <div className="myqr-head">
        <span className="myqr-piece" aria-hidden="true">♚</span>
        <h2>My QR card</h2>
      </div>

      {url ? (
        <>
          <div className="myqr-qr">
            <QRCodeSVG
              value={url}
              size={196}
              level="H"
              bgColor="#ffffff"
              fgColor="#0e2338"
              marginSize={1}
              imageSettings={BADGE_SETTINGS}
              title="Scan to open my MateZone player card"
            />
          </div>
          <div ref={downloadRef} className="myqr-hidden" aria-hidden="true">
            <QRCodeCanvas
              value={url}
              size={1024}
              level="H"
              bgColor="#ffffff"
              fgColor="#0e2338"
              marginSize={2}
              imageSettings={{ ...BADGE_SETTINGS, height: 200, width: 200 }}
            />
          </div>
          <p className="myqr-hint">Anyone who scans this opens your player card</p>

          <div className="myqr-actions">
            <button type="button" className="myqr-btn myqr-btn--primary" onClick={() => setPreviewOpen(true)}>
              Preview scan
            </button>
            <button type="button" className="myqr-btn" onClick={() => setShareOpen(true)}>Share card</button>
            <button type="button" className="myqr-btn" onClick={saveQr}>Save QR</button>
          </div>
        </>
      ) : (
        <p className="myqr-hint myqr-hint--empty">
          Your QR is not ready yet. Generate one to let anyone open your player card.
        </p>
      )}

      <div className="myqr-switch-row">
        <span>Show my card publicly</span>
        <button
          type="button"
          role="switch"
          aria-checked={isPublic}
          aria-label="Show my card publicly"
          className={`myqr-switch ${isPublic ? 'is-on' : ''}`}
          onClick={togglePublic}
          disabled={toggling}
        >
          <span className="myqr-knob" aria-hidden="true" />
        </button>
      </div>

      <button type="button" className="myqr-regen" onClick={regenerate} disabled={regenerating}>
        {regenerating ? 'Generating…' : token ? 'Regenerate QR' : 'Generate QR'}
      </button>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview scan"
        size="md"
        modalClass="pc-modal"
        layerClass="pc-modal-layer"
      >
        <div className="pc-preview-body">
          {preview.loading && <PlayerCardSkeleton />}
          {!preview.loading && preview.error && (
            <div className="pc-preview-error">
              <p>Card not available</p>
              <span>Turn “Show my card publicly” back on, or regenerate the QR.</span>
            </div>
          )}
          {!preview.loading && preview.card && (
            <PlayerCard
              card={preview.card}
              animate
              interactive
              onShare={() => { setPreviewOpen(false); setShareOpen(true); }}
            />
          )}
        </div>
      </Modal>

      <ShareCardSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        name={user?.name}
        url={url || ''}
      />
    </section>
  );
}
