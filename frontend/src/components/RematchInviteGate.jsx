import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { on, onSocketConnect } from '../services/socket';
import { fetchPendingRematches, respondRematch } from '../utils/online';
import { useToast } from './Toast';
import Button from './Button';
import Portal from './Portal';
import './rematch-gate.css';

/* Answer a rematch request from ANYWHERE in the app.

   The Accept / Reject card used to exist only inside the Play Arena, which made
   the whole feature depend on the other player already standing at that board:
   click Rematch after a finished match, go back to the dashboard, and the
   opponent — who is on the dashboard too — never learns a request exists. The
   push had nowhere to land and the click looked like it did nothing.

   Mounted once in the app shell, so it covers every route. The arena keeps its own
   card because it is the only surface that can put the new game on a board without
   a navigation, so this one steps down while the arena is open — and takes the
   request back over the moment the arena closes, from the server rather than from
   memory.

   Two channels, one card:
     socket — `rematch-request`, instant, the fast path.
     REST   — GET /api/online/rematch-pending, the rows the server already holds.
              Read on mount, on every reconnect, when the tab comes back to the
              foreground, and on a slow interval, so a missed push — an asleep
              phone tab, a reconnect, a request sent while the page was closed —
              still reaches the player while the window is open. It also takes the
              card down when the server no longer holds the request, which is how a
              decline or a withdrawal made on another device clears this screen.

   `rematch-started` is handled here too, for the player who asked and then walked
   away: on the arena the game is entered in place, so off the arena this is the
   only thing that can put them at the board. */

/* The window the server enforces in `respondRematch`. The card dies on the client
   at the plain window — the same point the requester's own countdown reaches — and
   the server's extra grace only covers a request already in flight. */
const REMATCH_WINDOW_MS = 30000;
/* Slow enough to be free, fast enough that a missed push is not noticed. The
   socket is the delivery mechanism; this is the net under it. */
const POLL_MS = 15000;

export default function RematchInviteGate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);

  /* Both subscriptions live for the life of the shell, so every handler reads live
     values through refs instead of closing over the first render — where `user`
     had not arrived yet. */
  const userRef = useRef(user);
  userRef.current = user;
  const inviteRef = useRef(null);
  inviteRef.current = invite;
  const busyRef = useRef(false);
  busyRef.current = busy;
  const locationRef = useRef(location);
  locationRef.current = location;
  const inviteTimer = useRef(null);
  /* New game ids this gate already opened, so the accept request and the socket
     push describing the same match produce one navigation, not a re-keyed route. */
  const openedRef = useRef(new Set());

  /* The arena owns the rematch UI while it is open — including an invite for a
     different finished match, which its own card answers correctly. */
  const onArena = /\/analysis$/.test(location.pathname);
  const active = Boolean(user?.id) && !onArena;

  /* Read live, because the socket handlers below are subscribed once and must not
     keep the route from whichever render first ran them. */
  function onArenaRoute() {
    return /\/analysis$/.test(locationRef.current.pathname);
  }

  function boardBase() {
    const role = userRef.current?.role;
    return role === 'admin' || role === 'superadmin' ? '/admin' : '/student';
  }

  function closeInvite() {
    window.clearTimeout(inviteTimer.current);
    inviteTimer.current = null;
    setInvite(null);
  }

  /* One card at a time, and it expires on its own: a request the other player has
     given up on must not sit here looking answerable. */
  function openInvite({ gameId, fromName, at }) {
    if (!gameId || inviteRef.current) return;
    window.clearTimeout(inviteTimer.current);
    setInvite({ gameId, fromName: fromName || 'Your opponent' });
    const left = REMATCH_WINDOW_MS - Math.max(0, Date.now() - (Number(at) || Date.now()));
    inviteTimer.current = window.setTimeout(() => {
      closeInvite();
      showToast('No response — the rematch request expired.', {
        tone: 'info', title: '♞ Rematch', source: 'RematchInviteGate:expire',
        dedupeKey: `rematch-gate-expire-${gameId}`,
      });
    }, Math.max(500, left));
  }

  /* Move the player to the board that was just created for them. */
  function openNewGame(row) {
    if (!row?.id) return;
    if (Number(row.meId) !== Number(userRef.current?.id)) return;
    /* On the arena the page itself puts the new match on the board without a
       navigation; a route change here would reset it. */
    if (onArenaRoute()) return;
    const key = String(row.id);
    if (openedRef.current.has(key)) return;
    openedRef.current.add(key);
    closeInvite();
    /* Off the arena nothing can enter the game in place, so the route carries it —
       the same shape an accepted match challenge uses. */
    window.dispatchEvent(new CustomEvent('chess-close-panels'));
    navigate(`${boardBase()}/analysis?game=${encodeURIComponent(key)}`);
  }

  /* ── socket: the instant path ── */
  useEffect(() => {
    if (!user?.id) return undefined;
    const offs = [
      on('rematch-request', (p) => {
        if (!p?.gameId) return;
        if (Number(p.requesterId) === Number(userRef.current?.id)) return;
        /* The arena is showing this request on its own card, and it draws the
           match the request is about — leave it there. */
        if (onArenaRoute()) return;
        openInvite({ gameId: p.gameId, fromName: p.requesterName, at: Date.now() });
      }),
      on('rematch-started', (p) => openNewGame(p?.game)),
      /* These three describe a request ending. This gate only ever holds the
         invitee's card, so a match other than that one is not its business. */
      on('rematch-declined', (p) => {
        if (String(inviteRef.current?.gameId) === String(p?.gameId)) closeInvite();
      }),
      on('rematch-cancelled', (p) => {
        if (String(inviteRef.current?.gameId) === String(p?.gameId)) closeInvite();
      }),
      on('rematch-expired', (p) => {
        if (String(inviteRef.current?.gameId) === String(p?.gameId)) closeInvite();
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      closeInvite();
    };
    // Refs and stable setters only: re-subscribing per render would stack a
    // duplicate listener for every render of the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* ── REST: the net under the socket ── */
  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;

    async function sync() {
      let games = [];
      try {
        games = await fetchPendingRematches();
      } catch {
        /* A background read. Failing here costs a few seconds of net, not a lost
           request — and a device with no connection would toast once per poll
           forever. */
        return;
      }
      if (cancelled) return;
      const live = games.find((g) => g?.rematchRequest && !g.rematchRequest.mine);
      if (live) {
        openInvite({
          gameId: live.id,
          fromName: live.rematchRequest.byName || live.opponentName,
          at: live.rematchRequest.at,
        });
        return;
      }
      /* The server no longer holds what this card is showing: it was answered,
         withdrawn, or it ran out of time — somewhere other than this screen. */
      if (inviteRef.current) closeInvite();
    }

    sync();
    const poll = window.setInterval(sync, POLL_MS);
    /* A reconnect hands the socket a new id and every push sent to the old one is
       gone, so the first thing after a reconnect is a read of what was missed. */
    const offConnect = onSocketConnect(() => { sync(); });
    const onVisible = () => { if (!document.hidden) sync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      offConnect();
      document.removeEventListener('visibilitychange', onVisible);
    };
    // openInvite / closeInvite touch refs and setters only, so `sync` is safe to
    // keep for the life of this subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, user?.id]);

  /* Leaving the arena hands the request back to this gate, and arriving at the
     arena takes it away: exactly one card for one request, on exactly one screen. */
  useEffect(() => {
    if (onArena && inviteRef.current) closeInvite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onArena]);

  async function answer(accept) {
    const current = inviteRef.current;
    if (!current || busyRef.current) return;
    setBusy(true);
    try {
      const row = await respondRematch(current.gameId, accept);
      closeInvite();
      if (accept) {
        openNewGame(row);
      } else {
        showToast(`You declined ${current.fromName}'s rematch. They have been told.`, {
          tone: 'info', title: '♞ Rematch', source: 'RematchInviteGate:declined',
          dedupeKey: `rematch-gate-declined-${current.gameId}`,
        });
      }
    } catch (e) {
      closeInvite();
      showToast(e.response?.data?.message || 'Could not answer the rematch request.', {
        tone: 'danger', title: '♞ Rematch', source: 'RematchInviteGate:answer-failed',
        dedupeKey: `rematch-gate-answer-${current.gameId}`,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!invite || onArena) return null;

  return (
    <Portal>
      <div className="rg-layer">
        <div className="rg-card" role="alertdialog" aria-label="Rematch request" aria-live="assertive">
          <span className="rg-body">
            <span className="rg-title">♞ {invite.fromName} wants a rematch</span>
            <span className="rg-sub">Same clock, your colours swapped.</span>
          </span>
          <span className="rg-actions">
            <Button type="button" variant="primary" size="sm" disabled={busy}
              onClick={() => answer(true)} className="!py-1.5 !px-3 text-xs">
              ✓ Accept
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy}
              onClick={() => answer(false)} className="!py-1.5 !px-3 text-xs">
              ✕ Reject
            </Button>
          </span>
        </div>
      </div>
    </Portal>
  );
}
