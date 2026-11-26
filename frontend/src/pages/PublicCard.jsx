import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PlayerCard, { PlayerCardSkeleton, usePrefersReducedMotion } from '../components/PlayerCard';
import ShareCardSheet from '../components/ShareCardSheet';
import { useToast } from '../components/Toast';
import usePageTitle from '../hooks/usePageTitle';
import { cardUrl, fetchPublicCard } from '../utils/cardApi';

function setOgTag(property, content) {
  let el = document.head.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Public gold player card. Opened by a QR scan or a shared link — no auth, no
 * app chrome. The Vercel function in /api/card.js injects the same tags into
 * the served HTML so WhatsApp-style previews see them without running JS.
 */
export default function PublicCard() {
  const { token } = useParams();
  const { showToast } = useToast();
  const [state, setState] = useState({ loading: true, error: false, card: null });
  const [run, setRun] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const cardRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: false, card: null });
    fetchPublicCard(token)
      .then((card) => {
        if (alive) setState({ loading: false, error: !card, card: card || null });
      })
      .catch(() => {
        if (alive) setState({ loading: false, error: true, card: null });
      });
    return () => { alive = false; };
  }, [token]);

  const { card } = state;
  usePageTitle(card ? card.name : 'Player card');

  useEffect(() => {
    if (!card) return;
    setOgTag('og:title', `${card.name} · MateZone Chess Academy`);
    setOgTag('og:description', card.rating != null
      ? `Rapid ${card.rating} · ${card.subtitle} · MateZone Chess Academy`
      : `${card.subtitle || 'Player'} · MateZone Chess Academy`);
  }, [card]);

  const saveImage = async () => {
    if (!cardRef.current || !card) return;
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        // Skip the hover-only wash/glare/sweep layers so the export is the
        // card itself, not whatever interaction state it happened to be in.
        filter: (node) => !(node.classList
          && (node.classList.contains('pc-veil')
            || node.classList.contains('pc-glare')
            || node.classList.contains('pc-sweep'))),
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `matezone-card-${card.username || 'player'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('Card saved as an image.', { tone: 'success', title: 'Player card' });
    } catch {
      showToast('Could not save the card image.', { tone: 'error', title: 'Player card' });
    }
  };

  if (state.loading) {
    return (
      <div className="pc-page">
        <PlayerCardSkeleton />
      </div>
    );
  }

  if (state.error || !card) {
    return (
      <div className="pc-page">
        <div className="pc-error">
          <span className="pc-error-icon" aria-hidden="true">♚</span>
          <h1>Card not available</h1>
          <p>This player card was removed, or the link has changed.</p>
          <Link className="pc-open-link" to="/">Open app →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pc-page">
      <div className="pc-page-inner">
        <PlayerCard key={run} card={card} animate={!reduced} innerRef={cardRef} interactive />

        <div className="pc-actions">
          <button type="button" className="pc-primary-btn" onClick={() => setShareOpen(true)}>Share card</button>
          <button type="button" className="pc-ghost-btn" onClick={() => setRun((r) => r + 1)}>↻ Replay</button>
        </div>
        <Link className="pc-open-link" to="/">Open app →</Link>
      </div>

      <ShareCardSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        name={card.name}
        url={cardUrl(token)}
        onSaveImage={saveImage}
      />
    </div>
  );
}
