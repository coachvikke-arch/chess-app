import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { matchRequestKey } from '../utils/toastDedupe';
import { notificationTarget } from '../utils/notificationRoutes';
import api from '../services/api';
import { onNotification, on } from '../services/socket';
import StudentAvatar from './StudentAvatar';
import Button from './Button';

/* ── Notification feed helpers (style: "Notification Feed Animations with Dark Mode") ── */

/** Pick a coloured icon tile. Prefers the explicit `type`, and only falls back to
 *  title keywords — most existing rows were written by a bare notify() that never
 *  set `type` at all, so the keyword path still has to work. */
function notifMeta(n) {
  const type = String(n?.type || '');
  if (type === 'message' || type === 'group_message') return { icon: '💬', color: '#4f7dff' };
  if (type === 'chat_reaction') return { icon: '😀', color: '#ff9f43' };
  if (type === 'match_request') return { icon: '⚔️', color: '#4f7dff' };
  if (type === 'assignment') return { icon: '✏️', color: '#ff9f43' };
  if (type === 'puzzle') return { icon: '♞', color: '#93c5fd' };
  if (type === 'quiz') return { icon: '📝', color: '#a06bff' };
  if (type === 'tournament') return { icon: '🏆', color: '#a06bff' };
  if (type === 'announcement') return { icon: '📢', color: '#4f7dff' };

  const t = String(n?.title || '').toLowerCase();
  if (/(welcome|good to see|account|hello)/.test(t)) return { icon: '👋', color: '#93c5fd' };
  if (/(password|credential|sign-in|sign in|login|security)/.test(t)) return { icon: '🔐', color: '#ff7b7b' };
  if (/(class|meeting|live|join|reminder)/.test(t)) return { icon: '📹', color: '#4f7dff' };
  if (/(tournament|cup)/.test(t)) return { icon: '🏆', color: '#a06bff' };
  if (/(puzzle)/.test(t)) return { icon: '♞', color: '#93c5fd' };
  if (/(assignment|homework)/.test(t)) return { icon: '✏️', color: '#ff9f43' };
  if (/(rating|level|badge)/.test(t)) return { icon: '♔', color: '#93c5fd' };
  if (/(match request|request|invited|challeng)/.test(t)) return { icon: '⚔️', color: '#4f7dff' };
  if (/(game|review|analysis|result)/.test(t)) return { icon: '♟', color: '#ff7b7b' };
  return { icon: '🔔', color: '#a3a3a3' };
}

/** Map a notification title to a toast tone (success / error / warning / info). */
function notifTone(title = '') {
  const t = String(title).toLowerCase();
  if (/(welcome|good to see|account|hello|solved|completed|won|win)/.test(t)) return 'success';
  if (/(password|credential|invalid|failed|expired|cancelled|loss|lost|rejected)/.test(t)) return 'error';
  if (/(soon|reminder|upcoming|starting|warning|almost)/.test(t)) return 'warning';
  return 'info';
}

/** Compact relative timestamp, e.g. "Just now", "2h ago", "Yesterday". */
function timeAgo(createdAt) {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Day bucket used for the feed group headers. */
function groupKey(createdAt) {
  const d = new Date(createdAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  if (d.getTime() >= today) return 'today';
  if (d.getTime() >= yesterday) return 'yesterday';
  return 'earlier';
}

const FEED_GROUPS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'earlier', label: 'Earlier' },
];

/* ── Match-request card helpers ─────────────────────────────────────────── */

/** Initial letters for the sender avatar circle, e.g. "User A" → "UA". */
function initialsOf(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
}

/** Status chip label for a match-request card (differs for sender vs receiver). */
function reqStatusLabel(status, isSender) {
  switch (status) {
    case 'accepted': return '✓ Accepted';
    case 'declined': return '✕ Declined';
    case 'cancelled': return '— Cancelled';
    case 'pending':
    default:
      return isSender ? '⏳ Request sent • Pending' : 'Waiting for a decision';
  }
}

/** Tailwind classes for the status chip, coloured by request state. */
function reqStatusChip(status) {
  switch (status) {
    case 'accepted': return 'bg-emerald-500/15 text-emerald-700 border-emerald-400/30';
    case 'declined': return 'bg-red-500/15 text-red-600 border-red-400/30';
    case 'cancelled': return 'bg-ivory-500/10 text-ivory-500 border-ivory-500/20';
    default: return 'bg-gold-500/15 text-gold-400 border-gold-400/30';
  }
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);
  const lastFetched = useRef(0);
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  /* Where the board lives for this role. Accepting a match request navigates
     here, and it must match `notificationTarget`'s base so an admin and a
     student both
     land on the board that actually exists for them. */
  const boardBase = user?.role === 'admin' || user?.role === 'superadmin' ? '/admin' : '/student';

  /* Announce panel state so the floating Back button can hide while open. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chess-notif-panel', { detail: { open } }));
  }, [open]);

  // Track notification IDs we've already shown as toasts this session so a
  // notification is toasted exactly once. Keyed by user + survives re-mounts
  // (but not another student on the same tab).
  const seenStoreKey = `notif-seen-ids-${user?.id || 'anon'}`;
  const knownIds = useRef(null);
  const seenOwner = useRef(user?.id);
  if (knownIds.current === null || seenOwner.current !== user?.id) {
    try {
      knownIds.current = new Set(JSON.parse(sessionStorage.getItem(seenStoreKey) || '[]'));
    } catch {
      knownIds.current = new Set();
    }
    seenOwner.current = user?.id;
  }
  const persistSeen = () => {
    try { sessionStorage.setItem(seenStoreKey, JSON.stringify([...knownIds.current])); } catch { /* ignore */ }
  };

  /* Mark a notification row as surfaced WITHOUT toasting it. The rich popups
     below (match request with Accept/Decline) surface the row themselves, so
     without this the same row stays "fresh" and syncFeed → toastNew shows it
     AGAIN as a second, plain toast — the duplicate popup. */
  const claimSeen = useCallback((id) => {
    if (id == null || knownIds.current.has(id)) return;
    knownIds.current.add(id);
    persistSeen();
    // eslint-disable-next-line no-console
    console.log(`[toast-debug] CLAIM-SEEN notif-row id=${id} t=${new Date().toISOString()}`);
  }, []);

  /** Mark one notification read: optimistic locally, persisted server-side. */
  const markRead = useCallback((id) => {
    api.put(`/notifications/${id}/read`, {}).catch(() => { });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
  }, []);

  /** Tapping a popup: mark the notification read and open the page its type
   *  maps to (notificationRoutes.js holds the single type → route map). */
  const openFromPopup = useCallback((n) => {
    markRead(n.id);
    const target = notificationTarget(n, user);
    if (target?.to) navigate(target.to, target.state ? { state: target.state } : undefined);
  }, [markRead, navigate, user]);

  /** Every fresh notification (socket or fetched) surfaces as a clickable
   *  popup that marks it read and navigates to its page. */
  const toastNew = useCallback((arr) => {
    const fresh = arr.filter((n) => !knownIds.current.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => knownIds.current.add(n.id));
    persistSeen();

    if (fresh.length > 5) {
      // Too many at once — collapse into one summary instead of a wall of popups.
      showToast('Tap to see everything you missed.', {
        tone: 'info',
        title: `${fresh.length} new notifications`,
        placement: 'notification',
        duration: 6000,
        source: 'NotificationBell:notif_summary',
        onClick: () => navigate(`${boardBase}/notifications`),
      });
      return;
    }
    // Oldest → newest so the most recent notification lands at the bottom (by the edge).
    fresh.slice().reverse().forEach((n) => {
      showToast(n.message || 'Tap to open the details.', {
        tone: notifTone(n.title),
        title: n.title,
        placement: 'notification',
        duration: 6000,
        dedupeKey: `notif:${n.id}`,
        source: 'NotificationBell:notif_popup',
        onClick: () => openFromPopup(n),
      });
    });
  }, [showToast, openFromPopup, navigate, boardBase]);

  /** Fetch the feed, update the list + badge, and surface fresh items as toasts. */
  const syncFeed = useCallback(() => {
    api.get('/notifications', { cache: false }).then((res) => {
      const arr = Array.isArray(res.data) ? res.data : [];
      setItems(arr);
      setUnread(arr.filter((n) => !n.is_read).length);
      toastNew(arr.filter((n) => !n.is_read));
    }).catch(() => { });
  }, [toastNew]);

  useEffect(() => {
    if (!open) return;
    syncFeed();
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, syncFeed]);

  // Refresh the unread badge periodically (and after open) so upcoming-meeting
  // reminders appear on the bell even if the student never visits the bell.
  // When the unread count climbs, fetch the list and surface the new items as toasts.
  const unreadRef = useRef(0);
  useEffect(() => {
    const tick = () => {
      api.get('/notifications/unread-count', { cache: false })
        .then((res) => {
          const count = res.data?.count || 0;
          if (count > unreadRef.current) {
            api.get('/notifications', { cache: false }).then((r) => {
              const arr = Array.isArray(r.data) ? r.data : [];
              setItems(arr);
              setUnread(arr.filter((n) => !n.is_read).length);
              toastNew(arr.filter((n) => !n.is_read));
            }).catch(() => { });
          } else {
            setUnread(count);
          }
          unreadRef.current = count;
        })
        .catch(() => { });
      lastFetched.current = Date.now();
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [toastNew]);

  // Real-time: new notifications (e.g. an incoming match request) arrive over
  // the socket and instantly refresh the badge + feed — no 30s polling wait.
  useEffect(() => {
    if (!user) return undefined;
    return onNotification(() => { syncFeed(); });
  }, [user, syncFeed]);

  // Live-classroom invites: a coach taps "Add students" and picks this student —
  // surface an instant "Join now" toast that drops straight into the room.
  useEffect(() => {
    if (!user) return undefined;
    return on('live_class_invite', ({ classId, title }) => {
      showToast(`Your coach invited you to the live classroom — tap Join now.`, {
        tone: 'info',
        title: `📺 ${title || 'Live class'} invite`,
        duration: 20000,
        dedupeKey: `live_class_invite:${classId ?? '?'}:${user.id}`,
        source: 'NotificationBell:live_class_invite',
        action: {
          label: '🎮 Join now',
          onClick: () => navigate(`/live-class/${classId}`),
        },
      });
    });
  }, [user, showToast, navigate]);

  /** Tap a notification: mark it read, then go to the section it belongs to.
   *  Always closes the panel so the page underneath is actually visible. */
  const openNotification = useCallback((n) => {
    markRead(n.id);
    const target = notificationTarget(n, user);
    if (target) navigate(target.to, target.state ? { state: target.state } : undefined);
    setOpen(false);
  }, [markRead, navigate, user]);

  /** Accept or decline an incoming match request from its notification card. */
  const actOnRequest = useCallback((n, action) => {
    if (!n || !n.related_id) return;
    const url = action === 'accept' ? `/online/games/${n.related_id}/accept` : `/online/games/${n.related_id}/decline`;
    api.post(url, {}).then(() => {
      // Optimistically resolve the card: buttons are replaced by the status label.
      setItems((prev) => prev.map((x) => (x.id === n.id
        ? { ...x, request_status: action, is_read: true, message: action === 'accept' ? 'Match accepted - good luck!' : 'Match declined.' }
        : x)));
      setUnread((u) => Math.max(0, u - (n.is_read ? 0 : 1)));
      showToast(action === 'accept' ? 'Match request accepted - good luck!' : 'Match request declined.', {
        tone: action === 'accept' ? 'success' : 'info',
        title: action === 'accept' ? '✓ Accepted' : '✕ Declined',
      });
      /* ACCEPTING MUST TAKE YOU TO THE BOARD. Previously this only raised a
         toast, so accepting from the notification panel looked like it did
         nothing: the game was live but the user was still looking at whatever
         page they were on. `?game=<id>` is read by AnalysisBoard on mount, which
         fetches that game and renders it - so this lands on the actual position
         rather than an empty board. Declining stays put, which is correct. */
      if (action === 'accept') {
        navigate(`${boardBase}/analysis?game=${n.related_id}`);
      }
    }).catch((err) => {
      // Action failed - restore the server truth so buttons stay active/correct.
      showToast(err?.response?.data?.message || 'Could not update the match request.', {
        tone: 'error',
        title: 'Action failed',
      });
      syncFeed();
    });
  }, [showToast, syncFeed, navigate, boardBase]);

  /* ── Live match-request popup, on EVERY page ────────────────────────────────

     A match request used to surface as a popup only from AnalysisBoard's own
     `game-invite` listener, so it appeared solely when the student happened to
     already be sitting on the Play Arena page. Anywhere else - the dashboard,
     ratings, puzzles - the request existed only as an unread badge, which is
     easy to miss: no message, no sender, no Accept button.

     The bell is mounted in every app shell, so listening here covers the whole
     app. This mirrors the `live_class_invite` toast just above: an instant,
     dismissible prompt carrying the two actions that actually matter.

     Receiver-only: `emitToUser` delivers to the RECIPIENT's own room, but the
     sender also gets a `match_request` row for their own sent request, so the
     sender check is required to avoid prompting someone to accept their own
     challenge. */
  useEffect(() => {
    if (!user) return undefined;
    return onNotification((n) => {
      if (n?.type !== 'match_request' || !n.related_id) return;
      const isSender = n.sender_id === user.id;
      if (isSender) return;
      const fromName = n.sender_name || 'Someone';
      /* Same dedupe key as the Play Arena's game-invite toast for this game:
         whichever surface shows first wins; the other is suppressed, so one
         match request can never stack two popups. */
      showToast(`${fromName} sent you a match request.`, {
        title: '♞ Match request',
        tone: 'info',
        duration: 30000,
        dedupeKey: matchRequestKey(n.related_id, user.id),
        source: 'NotificationBell:match_request_popup',
        actions: [
          { label: '✓ Accept', onClick: () => actOnRequest(n, 'accept') },
          { label: '✕ Decline', onClick: () => actOnRequest(n, 'decline') },
        ],
      });
      /* Surfaced (or suppressed as already-surfaced): either way the feed sync
         must not plain-toast this row a second time. */
      claimSeen(n.id);
    });
  }, [user, showToast, actOnRequest, claimSeen]);

  const markAll = () => {
    api.put('/notifications/read-all', {});
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
  };

  const clearAll = () => {
    api.delete('/notifications')
      .then(() => {
        setItems([]);
        setUnread(0);
      })
      .catch(() => {
        // Refresh from server so the local feed stays truthful if the delete failed.
        api.get('/notifications', { cache: false }).then((res) => {
          setItems(Array.isArray(res.data) ? res.data : []);
        }).catch(() => { });
      });
  };

  // Flatten the feed into group headers + items (with a global stagger index).
  const grouped = [];
  let stagger = 0;
  for (const g of FEED_GROUPS) {
    const list = items.filter((n) => groupKey(n.created_at) === g.key);
    if (list.length === 0) continue;
    grouped.push({ type: 'header', label: g.label, key: g.key });
    list.forEach((n) => grouped.push({ type: 'item', n, index: stagger++ }));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1.5 sm:p-2 rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition"
        title="Notifications"
        aria-label="Notifications"
      >
        <span className="text-lg sm:text-xl">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-[1rem] sm:min-w-[1.1rem] sm:h-[1.1rem] px-1 rounded-full bg-red-600 text-white text-[0.58rem] sm:text-[0.6rem] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-panel fixed inset-x-0 top-[72px] mx-auto w-[min(88vw,360px)] md:absolute md:left-auto md:right-0 md:top-full md:mt-2 md:mx-0 md:w-96 md:max-w-[85vw] z-[var(--z-modal)] rounded-2xl border border-ivory-700/50 bg-ink-800 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)] overflow-hidden">
          {/* Panel header — title + actions */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-ivory-700/50">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ivory-300">Notifications</p>
              <p className="text-[0.65rem] text-ivory-500 mt-0.5">
                {items.length} total · <span className={unread > 0 ? 'text-gold-400 font-semibold' : ''}>{unread} unread</span>
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {unread > 0 && (
                <button
                  onClick={markAll}
                  title="Mark all as read"
                  className="rounded-lg px-2 py-1 text-[0.68rem] font-semibold text-gold-400 hover:bg-gold-700/10 transition"
                >
                  ✓ All read
                </button>
              )}
              {items.length > 0 && (
                <button
                  onClick={clearAll}
                  title="Clear all notifications"
                  className="rounded-lg px-2 py-1 text-[0.68rem] font-semibold text-red-600 hover:bg-red-500/10 transition"
                >
                  ✕ Clear
                </button>
              )}
            </div>
          </div>
          {/* Feed body */}
          <div className="notif-feed-scroll max-h-[26rem] overflow-y-auto overscroll-contain">
            {items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <div className="text-4xl mb-2 opacity-40">🔔</div>
                <p className="text-sm font-semibold text-ivory-500">You're all caught up</p>
                <p className="text-xs text-ivory-500 mt-0.5">New classes, tournaments and results land here.</p>
              </div>
            )}

            {grouped.map((row) =>
              row.type === 'header' ? (
                <div
                  key={row.key}
                  className="px-4 pt-3 pb-1.5 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ivory-500"
                >
                  {row.label}
                </div>
              ) : (
                (() => {
                  const n = row.n;
                  const meta = notifMeta(n);
                  const read = n.is_read;
                  /* Only advertise a jump when there is a real destination, so the chevron
                     never appears on an item that just marks itself read. */
                  const target = notificationTarget(n, user);

                  // ── Match request cards: avatar + sender name + Accept / Decline actions ──
                  if (n.type === 'match_request') {
                    const isSender = !!user && n.sender_id === user.id;
                    const status = n.request_status || 'pending';
                    // Only the RECEIVER sees the action buttons, and only while still pending.
                    const showActions = !isSender && status === 'pending';
                    const fallbackName = n.sender_name || (isSender ? 'You' : 'Match request');
                    const avatarSrc = n.sender_avatar && /^(https?:|data:)/.test(n.sender_avatar) ? n.sender_avatar : null;
                    const senderConfig = n.sender_avatar_config && typeof n.sender_avatar_config === 'object' ? n.sender_avatar_config : null;
                    return (
                      <div
                        key={n.id}
                        onClick={() => openNotification(n)}
                        className="notif-item group relative w-full text-left px-4 py-3 transition-colors duration-150 border-b border-ivory-700/40 hover:bg-black/[0.04]"
                        style={{ '--n': row.index }}
                      >
                        {!read && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gold-400 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />}
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 grid place-items-center w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 text-ink-950 font-bold overflow-hidden">
                            {senderConfig ? <StudentAvatar config={senderConfig} size={40} seed={String(n.sender_id || '')} /> : avatarSrc ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" /> : initialsOf(fallbackName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`flex items-start justify-between gap-2 text-sm font-semibold ${read ? 'text-ivory-500' : 'text-ivory-300'}`}>
                              <span className="min-w-0 truncate">{isSender ? 'Match request sent' : (n.sender_name || 'Match request')}</span>
                              {!read && <span className="mt-1.5 w-2 h-2 rounded-full bg-gold-400 shrink-0" />}
                            </span>
                            {n.message && (
                              <span className="block text-xs text-ivory-500 mt-0.5 whitespace-pre-line">{n.message}</span>
                            )}
                            <span className={`block text-[0.65rem] mt-1 uppercase tracking-wide ${read ? 'text-ivory-500' : 'text-gold-400/90'}`}>
                              {timeAgo(n.created_at)}
                            </span>
                            {showActions ? (
                              <span className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  fullWidth
                                  onClick={() => actOnRequest(n, 'accept')}
                                >
                                  ✓ Accept
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  fullWidth
                                  onClick={() => actOnRequest(n, 'decline')}
                                >
                                  ✕ Decline
                                </Button>
                              </span>
                            ) : (
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 mt-2 text-[0.65rem] font-semibold ${reqStatusChip(status)}`}>
                                {reqStatusLabel(status, isSender)}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  }

                  // ── Plain notifications: icon tile + title + message (click to mark read) ──
                  return (
                    <button
                      key={n.id}
                      onClick={() => openNotification(n)}
                      className="notif-item group relative flex items-start gap-3 w-full text-left px-4 py-3 transition-colors duration-150 border-b border-ivory-700/40 hover:bg-black/[0.04]"
                      style={{ '--n': row.index }}
                    >
                      {/* unread gold accent bar */}
                      {!read && (
                        <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gold-400 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                      )}

                      {/* icon tile */}
                      <span
                        className="mt-0.5 grid place-items-center w-10 h-10 shrink-0 rounded-xl text-lg transition-transform duration-200 group-hover:scale-110"
                        style={{ background: `${meta.color}1f`, color: meta.color }}
                      >
                        {meta.icon}
                      </span>

                      {/* content */}
                      <span className="min-w-0 flex-1">
                        <span className={`flex items-start justify-between gap-2 text-sm font-semibold ${read ? 'text-ivory-500' : 'text-ivory-300'}`}>
                          <span className="min-w-0">{n.title}</span>
                          {!read && <span className="mt-1.5 w-2 h-2 rounded-full bg-gold-400 shrink-0" />}
                        </span>
                        {n.message && (
                          <span className="block text-xs text-ivory-500 mt-0.5 whitespace-pre-line line-clamp-2">{n.message}</span>
                        )}
                        <span className="flex items-center gap-2 mt-1">
                          <span className={`text-[0.65rem] uppercase tracking-wide ${read ? 'text-ivory-500' : 'text-gold-400/90'}`}>
                            {timeAgo(n.created_at)}
                          </span>
                          {target && !target.fallback && (
                            <span className="ml-auto text-[0.65rem] uppercase tracking-wide text-ivory-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              Open →
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })()
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
