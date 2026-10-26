/** Full-page messenger, reachable from the sidebar ("Messages").
 *
 * One shared DM + group surface on top of the global ChatContext: the Inbox tab
 * merges 1:1 conversations with the group rooms the user belongs to, the People
 * tab finds somebody to start a DM with. Admins/superadmins can create groups
 * and manage members; any member can chat and attach images/files.
 * Rendered by BOTH shells (admin + student) — nothing here is shell-specific. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import usePageTitle from '../hooks/usePageTitle';
import { useFullHeight } from '../context/FullHeightContext';
import { listContacts, createGroup, addGroupMembers, removeGroupMember, updateGroupAvatar } from '../utils/chat';
import ChatRequestButton from '../components/ChatRequestButton';
import StudentAvatar from '../components/StudentAvatar';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import { formatTime12 } from '../utils/time';

function fmtTime(iso) {
  try { return formatTime12(new Date(iso)); } catch { return ''; }
}
function fmtDay(iso) {
  try {
    const d = new Date(iso); const now = new Date();
    if (d.toDateString() === now.toDateString()) return formatTime12(d);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}
function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' · ' + formatTime12(d);
  } catch { return ''; }
}

function isImageType(t) {
  return typeof t === 'string' && t.toLowerCase().startsWith('image/');
}

function PersonAvatar({ u, name, size = 40 }) {
  const initial = String(name || '?')[0]?.toUpperCase() || '?';
  if (u?.avatar_config) return <StudentAvatar config={u.avatar_config} seed={`user_${u.id || ''}`} size={size} />;
  if (u?.profile_image) return <img src={u.profile_image} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="rounded-full bg-gradient-to-br from-gold-500 to-gold-700 grid place-items-center font-bold text-white" style={{ width: size, height: size }}>
      {initial}
    </span>
  );
}

const GroupBadge = ({ src, size = 40 }) => (
  src ? (
    <img src={src} alt="" className={"shrink-0 rounded-full object-cover ring-1 ring-ivory-700/30 bg-ink-900"} style={{ width: size, height: size }} />
  ) : (
    <span className={"shrink-0 rounded-full bg-gradient-to-br from-ink-600 to-ink-800 ring-1 ring-ivory-700/30 grid place-items-center text-lg"} style={{ width: size, height: size }}>
      👥
    </span>
  )
);

function UnreadBadge({ n }) {
  if (!n) return null;
  return (
    <span className="shrink-0 min-w-[20px] h-[20px] px-1.5 grid place-items-center rounded-full bg-red-600 text-white text-[11px] font-bold">
      {n > 99 ? '99+' : n}
    </span>
  );
}

/* Attachment bubble inside a message: images render inline, everything else is
   a download card. */
function AttachmentBubble({ m }) {
  if (!m.attachment) return null;
  if (isImageType(m.attachment_type)) {
    return (
      <img
        src={m.attachment}
        alt={m.attachment_name || 'image'}
        className="mt-1.5 max-h-64 max-w-full rounded-lg border border-ivory-700/30 bg-ink-900"
        loading="lazy"
      />
    );
  }
  return (
    <a
      href={m.attachment}
      download={m.attachment_name}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 flex items-center gap-2 rounded-lg bg-ivory-700/30 px-3 py-2 hover:bg-ivory-700/50 transition"
    >
      <span className="text-lg">📎</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-ivory-100 truncate max-w-[220px]">{m.attachment_name || 'file'}</span>
        {m.attachment_size != null && (
          <span className="block text-[10px] text-ivory-500">{(m.attachment_size / 1024).toFixed(1)} KB</span>
        )}
      </span>
    </a>
  );
}

/* ── Emoji ──────────────────────────────────────────────────────────────
   Two lists on purpose: QUICK_REACTIONS is the hover bar on a message (one
   tap, no popover) and EMOJI_PALETTE is the full grid in the composer. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🔥', '👏'];

const EMOJI_PALETTE = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
  '😘', '😗', '😋', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '🤩', '🥺', '😢', '😭', '😤', '😡',
  '🤯', '😱', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮',
  '😲', '🥱', '😴', '🤤', '😪', '😵', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈',
  '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐',
  '🖖', '👋', '🤏', '💪', '👏', '🙌', '👐', '🤲', '🙏', '✍️', '💅', '💃', '🕺', '👀', '🧠', '👣',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
  '💯', '🔥', '✨', '⭐', '🌟', '💫', '🎉', '🎊', '🎁', '🏆', '🥇', '🎯', '✅', '❌', '❗', '❓',
  '💤', '💬', '🚀', '🍀', '🌈', '☕', '🍕', '⚽', '🏀', '🎮', '📌', '📎', '🔔', '⏰', '📈', '🧩',
];

/* Composer popover: picks an emoji straight into the text box. */
function EmojiPicker({ onPick, onClose }) {
  return (
    <div className="absolute bottom-full left-0 mb-2 z-30 w-[292px] rounded-xl border border-ivory-700/50 bg-ink-800 shadow-2xl p-2.5"
      onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-1.5 px-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-ivory-500">Emoji</span>
        <button type="button" onClick={onClose} className="text-ivory-500 hover:text-ivory-200 text-xs transition">✕</button>
      </div>
      <div className="chat-scroll grid grid-cols-8 gap-0.5 max-h-52 overflow-y-auto">
        {EMOJI_PALETTE.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)} title={e}
            className="w-7 h-7 grid place-items-center rounded-md text-lg hover:bg-slate-200 transition">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/* Reaction pills under a bubble. Clicking one toggles MY reaction for that
   emoji (adds it if I hadn't reacted, removes it if I had). */
function ReactionChips({ m, scope, onReact, meId }) {
  const list = m.reactions || [];
  if (list.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {list.map((r) => {
        const mine = (r.users || []).some((u) => Number(u) === Number(meId));
        return (
          <button key={r.emoji} type="button" onClick={() => onReact(scope, m.id, r.emoji)}
            title={mine ? 'Remove your reaction' : `React with ${r.emoji}`}
            className={"flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs transition " +
              (mine
                ? 'bg-gold-500/25 text-gold-400 ring-1 ring-gold-500/50 hover:bg-gold-500/35'
                : 'bg-slate-200 text-ivory-300 hover:bg-slate-300')}>
            <span>{r.emoji}</span>
            <span className="font-bold">{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/* Hover bar with one-tap reactions, revealed when the pointer is on the row.
   Anchored to the bubble's outer edge so it never spills out of a right-aligned
   (own) bubble and forces a horizontal scrollbar on the message list. */
function QuickReactions({ scope, messageId, onReact, alignRight = false }) {
  return (
    <div className={"absolute -top-3 z-20 flex items-center gap-0.5 rounded-full bg-white ring-1 ring-ink-600/20 px-1 py-0.5 shadow-md " +
                    (alignRight ? 'right-0 ' : 'left-0 ') +
                    "opacity-0 translate-y-0.5 pointer-events-none transition " +
                    "group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto"}>
      {QUICK_REACTIONS.map((e) => (
        <button key={e} type="button" onClick={() => onReact(scope, messageId, e)} title={`React ${e}`}
          className="w-6 h-6 grid place-items-center rounded-full text-sm hover:bg-ink-700/10 transition">
          {e}
        </button>
      ))}
    </div>
  );
}

/* ── Message actions sheet (long-press / right-click) ────────────────────
 *
 * The whole reason this is a centred modal instead of a popover anchored to the
 * bubble: the chat list is an `overflow-y-auto` scroll container, so any menu
 * rendered inside a bubble gets clipped by the container's edges — the one on
 * the first message rendered its options off the top of the list, and the one on
 * the last rendered them off the bottom, both unreadable. A `fixed` overlay in a
 * portal is positioned against the viewport, so it is always fully on screen no
 * matter where the message sits in the scroll.
 *
 * Opened by long-pressing a bubble (touch), right-clicking it (mouse), or the
 * 🗑 trigger, and carries BOTH reactions and the delete options so one gesture
 * covers everything the old hover bars did. */
const HOLD_MS = 450;
const HOLD_SLOP = 10; /* px of finger movement that still counts as a hold */

function MessageActionSheet({ target, onClose, onReact, onDelete, meId }) {
  const canDeleteForEveryone = target.mine || target.canModerate;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const react = (emoji) => { onReact(target.scope, target.messageId, emoji); onClose(); };
  const del = (mode) => { onClose(); onDelete(target.scope, target.messageId, mode); };

  const action = 'w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition';

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/70 px-4 backdrop-blur-sm chat-modal-backdrop"
      onClick={onClose}
      /* Long-pressing here (rather than on the list) would otherwise re-trigger
       * the browser's own callout menu on top of this one. */
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        role="dialog"
        aria-label="Message actions"
        className="w-full max-w-xs overflow-hidden rounded-2xl border border-ivory-700/50 bg-ink-800 shadow-2xl chat-modal-card"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {target.reactions?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-ivory-700/40 px-4 py-3">
            {target.reactions.map((r) => (
              <span key={r.emoji} className="flex items-center gap-1 rounded-full bg-ink-700/10 px-2 py-0.5 text-xs text-ivory-300">
                {r.emoji}<span className="font-bold text-gold-700">{r.count}</span>
                {r.users.includes(meId) && <span className="text-ivory-500">· you</span>}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-around px-3 py-3 border-b border-ivory-700/40">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} type="button" onClick={() => react(e)} title={`React ${e}`}
              className="w-10 h-10 grid place-items-center rounded-full text-xl hover:bg-ink-700/10 active:scale-110 transition">
              {e}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => del('me')}
          className={action + ' text-ivory-300 hover:bg-ink-700/10'}>
          <span aria-hidden>🗑️</span>
          <span>Delete for me</span>
        </button>
        {canDeleteForEveryone && (
          <button type="button" onClick={() => del('everyone')}
            className={action + ' text-red-600 hover:bg-red-500/15 border-t border-ivory-700/40'}>
            <span aria-hidden>🚫</span>
            <span>Delete for everyone</span>
          </button>
        )}
        <button type="button" onClick={onClose}
          className={action + ' text-ivory-500 hover:bg-ink-700/10 border-t border-ivory-700/40'}>
          <span aria-hidden>✕</span>
          <span>Cancel</span>
        </button>
      </div>
    </div>,
    document.body
  );
}

/* The 🗑 affordance on a bubble. It no longer owns a popover of its own — it
 * just opens the same centred sheet, so there is a single menu to reason about
 * and nothing can render off-screen. Revealed on row hover on desktop, always
 * visible on touch where hover doesn't exist. */
function MessageOptionsButton({ onOpen, label = 'Message options' }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onTouchStart={(e) => e.stopPropagation()}
      className="absolute -top-2.5 right-1.5 z-20 w-6 h-6 grid place-items-center rounded-full text-xs text-ivory-500 bg-white ring-1 ring-ink-600/20 hover:text-red-600 hover:bg-white shadow-md transition
                 md:opacity-0 md:translate-y-0.5 md:pointer-events-none
                 md:group-hover:opacity-100 md:group-hover:translate-y-0 md:group-hover:pointer-events-auto"
    >
      🗑
    </button>
  );
}

export default function MessagesPage() {
  usePageTitle('Messages');
  const { user } = useAuth();
  const meId = Number(user?.id ?? 0);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const chat = useChat();
  const location = useLocation();
  const navigate = useNavigate();
  /* The People directory used to be its own page at /admin/people. It lives here
     as a tab now, and the old route redirects here with ?tab=people, so the
     initial tab has to come from the query string rather than always 'inbox'. */
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTabState] = useState(searchParams.get('tab') === 'people' ? 'people' : 'inbox');

  /* The contact whose approval gate is open in the People tab. Set when a
     blocked row is clicked, so the request panel replaces the thread area
     instead of the row silently doing nothing. */
  const [requestTarget, setRequestTarget] = useState(null);
  const { showToast } = useToast();

  /* Open a conversation from a row tap. openThread() rejects when the server
     disagrees with the list (approval revoked since the list loaded) or the
     network drops — without this catch the tap silently does nothing, which
     reads as "the row is not clickable". A 403 drops into the request flow
     like the deep-link path does; anything else gets an error toast. */
  const openRowConversation = useCallback((id, name, stayOnTab) => {
    setTab('inbox');
    Promise.resolve(chat.openThread(Number(id))).catch((err) => {
      if (err?.response?.status === 403) {
        setTab(stayOnTab);
        setRequestTarget({ id: Number(id), name: err.response.data?.message || name || 'This user' });
        return;
      }
      showToast(err.response?.data?.message || 'Could not open this chat. Check your connection and try again.', {
        tone: 'error',
        title: 'Chat failed to open',
      });
    });
  }, [chat, showToast]);

  /* Keep the URL in step with the visible tab, so a reload — or a shared link —
     lands on the same panel, and Back returns to the inbox. */
  const setTab = useCallback(
    (next) => {
      setTabState(next);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'people') p.set('tab', 'people');
          else p.delete('tab');
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /* A tab arriving via the query string (e.g. the /admin/people redirect). */
  useEffect(() => {
    const wanted = searchParams.get('tab') === 'people' ? 'people' : 'inbox';
    setTabState((current) => (current === wanted ? current : wanted));
  }, [searchParams]);
  const [input, setInput] = useState('');
  const [attach, setAttach] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [showInfo, setShowInfo] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiScope, setEmojiScope] = useState(null); /* which composer is picking */
  const [sheetFor, setSheetFor] = useState(null); /* message shown in the actions sheet */
  const listRef = useRef(null);

  /* ── Long-press to open the message actions sheet ──
   *
   * Touch and mouse are handled separately on purpose. A hold is a timer that
   * starts on touchstart and is cancelled the moment the finger moves (so
   * scrolling the list still works) or lifts early. On desktop the same sheet
   * opens on right-click, which is the pointer-only equivalent — using the hold
   * timer for mouse too would fight text selection. */
  const holdRef = useRef(null);
  const clearHold = useCallback(() => {
    if (holdRef.current?.timer) clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  }, []);

  useEffect(() => clearHold, [clearHold]);

  const startHold = (m, scope, mine, canModerate) => (e) => {
    if (e.touches?.length > 1) return; /* pinch/second finger: not a hold */
    const startX = e.touches[0].clientX;
    const startY = e.touches[0].clientY;
    const target = () => setSheetFor({ messageId: m.id, scope, mine, canModerate, reactions: m.reactions || [] });
    clearHold();
    holdRef.current = {
      x: startX, y: startY,
      timer: setTimeout(() => {
        holdRef.current = null;
        /* Suppress the browser's own long-press callout so it can't race our
         * sheet on Android/iOS. */
        if (navigator.vibrate) navigator.vibrate(8);
        target();
      }, HOLD_MS),
    };
  };

  /* Movement past a few px is a scroll, not a hold — cancel it. */
  const moveHold = useCallback((e) => {
    const h = holdRef.current;
    if (!h?.timer || !e.touches?.length) return;
    if (Math.abs(e.touches[0].clientX - h.x) > HOLD_SLOP || Math.abs(e.touches[0].clientY - h.y) > HOLD_SLOP) clearHold();
  }, [clearHold]);

  const openSheet = useCallback((m, scope, mine, canModerate) =>
    setSheetFor({ messageId: m.id, scope, mine, canModerate, reactions: m.reactions || [] }), []);

  const contactById = useMemo(
    () => new Map((chat.contacts || []).map((u) => [Number(u.id), u])),
    [chat.contacts]
  );

  const {
    threadFor, messages, conversations, contacts, searchQuery,
    groups, groupUnreadByGroup, activeGroupId, groupMessages, activeGroup, activeGroupMembers,
    closeThread, openThread, send, searchContacts, isOnline, cancelledChats,
    openGroup, closeGroup, sendToGroup, react, deleteMessage,
  } = chat;

  const groupOpen = activeGroupId != null;
  const dmOpen = threadFor != null;
  /* The open 1:1 thread has just been cancelled. The messages stay on screen
     (they are the record of what was said, and a coach/admin can still review
     them) but the composer is gone and nothing new can be sent - the server
     refuses a cancelled chat regardless of what this UI does. */
  const dmCancelled = dmOpen ? cancelledChats?.[Number(threadFor)] || null : null;
  /* A thread is open when either kind of conversation is — OR the request
     prompt is showing. On phones the inbox rail gives way, so a blocked-row
     tap must count as "open" too: otherwise the prompt renders into a pane
     that stays hidden and the tap looks dead. */
  const threadOpen = groupOpen || dmOpen || requestTarget != null;

  /* A real thread supersedes the request prompt: opening one clears any
     stale target so closing the thread never resurrects yesterday's prompt. */
  useEffect(() => {
    if (groupOpen || dmOpen) setRequestTarget(null);
  }, [groupOpen, dmOpen]);

  /* Arriving from the People page with `state.openUserId`, or from a message
     toast with `state.openGroupId`: land straight in that conversation/group on
     the Inbox tab. Runs whenever either target changes, and the state is cleared
     afterwards so re-visiting Messages later doesn't re-open it. */
  const openUserId = location.state?.openUserId;
  const openGroupId = location.state?.openGroupId;
  useEffect(() => {
    if (!openUserId && !openGroupId) return;
    setTab('inbox');
    if (openGroupId) {
      openGroup(Number(openGroupId));
    } else {
      /* A deep link or an old bookmark can name a conversation the user is no
         longer allowed to open. The server rejects it with 403 carrying the
         current state, so instead of a dead thread we drop the user into the
         request flow. Without this the click appears to do nothing. */
      Promise.resolve(openThread(Number(openUserId))).catch((err) => {
        const status = err?.response?.status;
        if (status === 403) {
          setTab('people');
          setRequestTarget({
            id: Number(openUserId),
            name: err.response.data?.message || 'This user',
          });
        }
      });
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [openUserId, openGroupId]);

  /* Inbox = DMs + groups, newest activity first. Shown in two sections:
     "Groups" then "Individuals", each sorted by most recent activity. */
  const inboxItems = useMemo(() => {
    const dms = conversations.map((c) => ({
      kind: 'dm', key: `dm-${c.otherId}`, otherId: c.otherId,
      name: c.otherName, unread: c.unread, lastMessage: c.lastMessage, lastMessageAt: c.lastMessageAt,
    }));
    const grps = groups.map((g) => ({
      kind: 'group', key: `grp-${g.id}`, groupId: g.id,
      name: g.name, avatar: g.avatar || null,
      unread: (groupUnreadByGroup[Number(g.id)] ?? g.unread) || 0,
      lastMessage: g.lastMessage, lastMessageAt: g.lastMessageAt,
      memberCount: g.memberCount,
    }));
    const byRecent = (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0);
    return {
      groups: grps.sort(byRecent),
      dms: dms.sort(byRecent),
    };
  }, [conversations, groups, groupUnreadByGroup]);
  const groupItems = inboxItems.groups;
  const dmItems = inboxItems.dms;

  const renderInboxRow = (it) => {
    const unread = Number(it.unread || 0);
    return (
      <button key={it.key} type="button"
        onClick={() => it.kind === 'group' ? openGroup(it.groupId) : openRowConversation(Number(it.otherId), it.name, 'inbox')}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition hover:bg-slate-100">
        <span className="relative shrink-0">
          {it.kind === 'group' ? (
            <GroupBadge src={it.avatar} size={48} />
          ) : (
            <>
              <PersonAvatar u={contactById.get(Number(it.otherId))} name={it.name} size={48} />
              <span className={"online-dot absolute -bottom-0.5 -right-0.5 ring-2 ring-ink-800 " + (isOnline(it.otherId) ? 'online-dot-on' : '')} />
            </>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-base font-bold text-ivory-300 truncate">{it.name}</span>
            <UnreadBadge n={unread} />
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2 text-sm">
            <span className="text-ivory-600 truncate">
              {it.kind === 'group' && <span className="italic text-ivory-700">Group · </span>}
              {it.lastMessage || 'Say hi!'}
            </span>
            {it.lastMessageAt && <span className="shrink-0 text-xs text-ivory-700">{fmtDay(it.lastMessageAt)}</span>}
          </span>
        </span>
      </button>
    );
  };

  /* The thread header needs the other person's name + photo. A brand-new chat
     (opened from People) has no conversation row yet, so `conversations` has
     nothing for it — fall back to the contact list, which always carries every
     user with their avatar/profile image. */
  const otherContact =
    contactById.get(Number(threadFor)) ||
    contacts.find((c) => Number(c.id) === Number(threadFor)) || null;
  const otherName =
    conversations.find((c) => Number(c.otherId) === Number(threadFor))?.otherName ||
    otherContact?.name || 'Chat';
  const creatorName = activeGroup?.creator_name || contactById.get(Number(activeGroup?.created_by))?.name || 'Someone';
  const creatorRole = activeGroup?.creator_role || '';

  /* Keep the newest message pinned into view (threads render oldest→newest).

     Re-pinned after layout settles, not once. Opening a thread on a phone also
     re-fits the column to the visual viewport, and that resize shortens the list
     a moment AFTER these messages render: a single scrollTop assignment lands
     against the old height and leaves the newest message below the fold (and
     `.chat-scroll` scrolls smoothly, so the animation drifts too). Assigning
     scrollTop again cancels that animation and lands on the real bottom. */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const pin = () => { el.scrollTop = el.scrollHeight; };
    pin();
    const frame = requestAnimationFrame(pin);
    const settle = setTimeout(pin, 150);
    return () => { cancelAnimationFrame(frame); clearTimeout(settle); };
  }, [messages, groupMessages, threadFor, activeGroupId]);

  /* ── Size the chat column to the VISUAL viewport ───────────────────────
     The page owns the whole content area and must never scroll: the column is
     measured from the top of .chat-screen down to the bottom of the visual
     viewport, minus everything the document would otherwise have to scroll
     (shell padding below it). That leaves the conversation list as the only
     scrolling container and keeps the composer above the soft keyboard on
     iOS, where only visualViewport.height shrinks when the keyboard opens.

     Runs at every breakpoint: phones use the fitted height for the single
     full-screen panel, tablets/desktop use it to fill the shell. */
  const { isFullHeight, requestFullHeight } = useFullHeight();
  const screenRef = useRef(null);
  const [screenH, setScreenH] = useState(null);

  useLayoutEffect(() => {
    requestFullHeight(true);
    return () => requestFullHeight(false);
  }, [requestFullHeight]);

  useLayoutEffect(() => {
    const el = screenRef.current;
    if (!el) return undefined;
    const vv = window.visualViewport || null;

    const sync = () => {
      const rect = el.getBoundingClientRect();
      let gap = 0;
      let node = el;
      while (node && node.parentElement && node.parentElement !== document.body) {
        const parent = node.parentElement;
        gap += parseFloat(getComputedStyle(parent).paddingBottom) || 0;
        gap += parseFloat(getComputedStyle(node).marginBottom) || 0;
        let sib = node.nextElementSibling;
        while (sib) {
          /* Fixed chrome (toast rail, floating buttons) sits out of flow, so
             its height must not be reserved — counting it would shrink the
             chat column by hundreds of pixels. */
          if (getComputedStyle(sib).position !== 'fixed') {
            gap += sib.offsetHeight
              + (parseFloat(getComputedStyle(sib).marginTop) || 0)
              + (parseFloat(getComputedStyle(sib).marginBottom) || 0);
          }
          sib = sib.nextElementSibling;
        }
        node = parent;
      }
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const next = Math.round(bottom - rect.top - gap);
      setScreenH(Number.isFinite(next) && next >= 320 ? next : null);
    };

    /* The keyboard opening changes the visual viewport: re-fit the column and
       drop the thread back onto its newest message. */
    const onViewport = () => {
      sync();
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    };
    /* A rotation, a resize, or entering/leaving full-height mode re-fits the
       column too, so the list is re-pinned for the same reason as the keyboard. */
    const onResize = () => { onViewport(); };

    sync();
    vv?.addEventListener('resize', onViewport);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', sync, { passive: true });
    return () => {
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', sync);
    };
  }, [threadFor, activeGroupId, isFullHeight]);

  /* ── DM ── */
  const doSendDm = useCallback(async () => {
    const text = String(input || '').trim();
    if ((!text && !attach) || !threadFor) return;
    try { await send(threadFor, text, attach); setInput(''); setAttach(null); setEmojiOpen(false); }
    catch (e) { console.warn('[chat:send]', e.message); }
  }, [input, attach, threadFor, send]);

  /* ── Group thread ── */
  const doSendGroup = useCallback(async () => {
    const text = String(input || '').trim();
    if ((!text && !attach) || !activeGroupId) return;
    try {
      await sendToGroup(activeGroupId, { text, file: attach || undefined });
      setInput(''); setAttach(null); setEmojiOpen(false);
    } catch (e) { console.warn('[chat:group send]', e.message); }
  }, [input, attach, activeGroupId, sendToGroup]);

  const pickFile = (e) => {
    const f = e.target.files?.[0] || null;
    if (f) setAttach(f);
    e.target.value = '';
  };

  const attachUrl = useMemo(() => (attach ? URL.createObjectURL(attach) : null), [attach]);

  /* ── Emoji + reactions ── */
  const toggleEmoji = (scope) => {
    setEmojiScope((cur) => (cur === scope ? null : scope));
    setEmojiOpen((o) => (emojiScope === scope ? !o : true));
  };
  const insertEmoji = (e) => setInput((v) => v + e);

  const doReact = useCallback(async (scope, messageId, emoji) => {
    try { await react(scope, messageId, emoji); }
    catch (err) { console.warn('[chat:react]', err.message); }
  }, [react]);

  /* Delete from the message menu. 'me' is reversible-in-spirit (the row stays for
   * everyone else) so it needs no confirmation; 'everyone' wipes it for the other
   * people too, so it gets an explicit confirm naming the two outcomes. */
  const doDelete = useCallback(async (scope, messageId, mode) => {
    if (mode === 'everyone') {
      const ok = window.confirm('Delete this message for everyone?\n\nIt will be removed from the conversation for all participants. This cannot be undone.');
      if (!ok) return;
    }
    try { await deleteMessage(scope, messageId, mode); }
    catch (err) {
      console.warn('[chat:delete]', err.message);
      window.alert(err?.response?.data?.message || 'Could not delete that message.');
    }
  }, [deleteMessage]);

  /* Close a floating picker when the thread under it changes. */
  useEffect(() => {
    setEmojiOpen(false);
    setEmojiScope(null);
  }, [threadFor, activeGroupId]);

  /* ── Create group modal ── */
  const openCreate = () => {
    setNewName(''); setPicked(new Set()); setShowCreate(true);
  };
  const togglePick = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const doCreate = async () => {
    const name = String(newName || '').trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const d = await createGroup(name, [...picked]);
      setShowCreate(false);
      if (d?.group) openGroup(d.group.id);
    } catch (e) { console.warn('[chat:createGroup]', e.message); }
    finally { setCreating(false); }
  };

  /* ── Member management (admins) ── */
  const toggleInfo = () => { setShowInfo((s) => !s); setAddMode(false); };
  const doAddMembers = async () => {
    if (picked.size === 0) return;
    try {
      await addGroupMembers(activeGroupId, [...picked]);
      setPicked(new Set());
      setAddMode(false);
      openGroup(activeGroupId); /* reload members + messages */
    } catch (e) { console.warn('[chat:addMembers]', e.message); }
  };
  const doRemoveMember = async (uid) => {
    try {
      await removeGroupMember(activeGroupId, uid);
      openGroup(activeGroupId); /* reload members + messages */
    } catch (e) { console.warn('[chat:removeMember]', e.message); }
  };

  /* ── Group profile picture (admins) ── */
  const doSetGroupAvatar = async (e) => {
    const f = e.target.files?.[0] || null;
    e.target.value = '';
    if (!f || !activeGroupId || !isAdmin) return;
    try {
      if (f.size > 5 * 1024 * 1024) { alert('Image must be under 5 MB.'); return; }
      if (!f.type.startsWith('image/')) { alert('Please pick an image file.'); return; }
      await updateGroupAvatar(activeGroupId, f);
      openGroup(activeGroupId); /* reload group so the header badge updates */
    } catch (err) { console.warn('[chat:group avatar]', err.message); }
  };

  const everyone = contacts.filter((c) => Number(c.id) !== meId);
  const notYetInGroup = everyone.filter((c) => !activeGroupMembers.some((m) => Number(m.id) === Number(c.id)));

  return (
    <div ref={screenRef} style={screenH ? { height: `${screenH}px` } : undefined}
      className="chat-screen w-full">
      <div className="rounded-2xl border border-ivory-700/50 bg-ink-800 overflow-hidden chat-card">
        {/* ── Left: inbox / people ── */}
        <div className={"chat-rail flex-col min-h-0 border-b min-[769px]:border-b-0 min-[769px]:border-r border-ivory-700/40 " +
          (threadOpen ? 'hidden min-[769px]:flex' : 'flex')}>
          <div className="flex items-center gap-1.5 px-3 py-3 border-b border-ivory-700/40">
            {['inbox', 'people'].map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={"px-4 py-2 rounded-lg text-sm font-bold capitalize transition " +
                  (tab === t ? 'bg-gold-500 text-white' : 'bg-slate-100 text-ivory-500 hover:text-ivory-300')}>
                {t}
              </button>
            ))}
            {isAdmin && (
              <Button type="button" variant="primary" size="sm" className="ml-auto shrink-0" onClick={openCreate}>
                + Group
              </Button>
            )}
          </div>

          {tab === 'inbox' ? (
            <div className="flex-1 min-h-0 overflow-y-auto chat-scroll-thin">
              {groupItems.length === 0 && dmItems.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-ivory-500">
                  No conversations yet. Open the People tab to start a chat.
                </p>
              ) : (
                <>
                  {groupItems.length > 0 && (
                    <div>
                      <p className="px-4 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-ivory-500">
                        Groups · {groupItems.length}
                      </p>
                      {groupItems.map(renderInboxRow)}
                    </div>
                  )}
                  {dmItems.length > 0 && (
                    <div className={groupItems.length > 0 ? 'mt-1 border-t border-ivory-700/25' : ''}>
                      <p className="px-4 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-ivory-500">
                        Individuals · {dmItems.length}
                      </p>
                      {dmItems.map(renderInboxRow)}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="px-3 py-2.5 border-b border-ivory-700/40">
                <input value={searchQuery} onChange={(e) => searchContacts(e.target.value)}
                  placeholder="Find a coach or student…"
                  className="w-full bg-ink-900 border border-ivory-700/30 rounded-lg px-3.5 py-2.5 text-base text-ivory-300 placeholder:text-ivory-600 outline-none focus:border-gold-500/60 transition" />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto chat-scroll chat-scroll-thin">
                {contacts.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-ivory-500">No matches for "{searchQuery}".</p>
                ) : contacts.map((u) => {
                  const online = isOnline(u.id);
                  /* canMessage comes from the server's listContacts payload. When
                     it is false the row still exists (the user is real and
                     searchable) but it opens a request prompt instead of a
                     thread, so a blocked contact is visibly blocked rather than
                     silently failing after the click. */
                  const canMessage = u.canMessage !== false;
                  const blocked = !canMessage;
                  return (
                    <button key={u.id} type="button" onClick={() => {
                      if (blocked) { setRequestTarget(u); return; }
                      openRowConversation(Number(u.id), u.name, 'people');
                    }}
                      className={"w-full flex items-center gap-3 px-4 py-3.5 text-left transition " + (blocked ? 'opacity-70 hover:bg-slate-50' : 'hover:bg-slate-100')}>
                      <span className="relative shrink-0">
                        <PersonAvatar u={u} name={u.name} size={48} />
                        <span className={"online-dot absolute -bottom-0.5 -right-0.5 ring-2 ring-ink-800 " + (online ? 'online-dot-on' : '')} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-base font-bold text-ivory-300 truncate">{u.name}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {u.chatState === 'pending' && (
                              <span className="chess-chip chess-chip-amber text-[10px]">Pending</span>
                            )}
                            {u.chatState === 'rejected' && (
                              <span className="chess-chip chess-chip-red text-[10px]">Rejected</span>
                            )}
                            {u.chatState === 'cancelled' && (
                              <span className="chess-chip text-[10px]">Cancelled</span>
                            )}
                            {u.chatState === 'none' && (
                              <span className="chess-chip text-[10px]">Request</span>
                            )}
                            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-md bg-gold-500/15 text-gold-400 font-bold">{u.role}</span>
                          </span>
                        </span>
                        <span className="mt-0.5 block text-sm text-ivory-600">
                          {blocked
                            ? (u.chatState === 'pending' ? 'Chat request pending'
                              : u.chatState === 'rejected' ? 'Rejected by coach'
                              : u.chatState === 'cancelled' ? 'This chat was cancelled'
                              : 'Approval required to chat')
                            : (online ? 'Online now' : 'Offline')}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: thread ── */}
        <div className={"chat-pane flex-1 flex-col min-w-0 " + (threadOpen ? 'flex' : 'hidden min-[769px]:flex')}>
          {groupOpen ? (
            <>
              <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3.5 border-b border-ivory-700/40">
                <div className="flex items-center gap-3 min-w-0">
                  <button type="button" onClick={closeGroup} aria-label="Back to messages"
                    className="shrink-0 w-10 h-10 grid place-items-center rounded-lg bg-slate-100 text-ivory-300 hover:bg-slate-200 transition text-lg">
                    ←
                  </button>
                  <GroupBadge src={activeGroup?.avatar} size={48} />
                  <span className="min-w-0">
                    <span className="block text-[17px] font-bold text-ivory-100 truncate">{activeGroup?.name || 'Group'}</span>
                    <span className="block text-xs text-ivory-500">{activeGroupMembers.length} members</span>
                  </span>
                </div>
                <button type="button" onClick={toggleInfo} aria-label="Group info"
                  className="shrink-0 w-10 h-10 grid place-items-center rounded-lg bg-slate-100 text-ivory-300 hover:bg-slate-200 transition">
                  ℹ️
                </button>
              </div>

              {showInfo && (
                <div className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-black/70 px-4 chat-modal-backdrop" onClick={() => { setAddMode(false); setShowInfo(false); }}>
                  <div className="w-full max-w-md rounded-2xl border border-ivory-700/50 bg-ink-800 shadow-2xl flex flex-col max-h-[85vh] chat-modal-card" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-5 py-3 border-b border-ivory-700/40 shrink-0">
                      <h2 className="font-display text-lg font-bold text-ivory-100">Group info</h2>
                      <button type="button" onClick={() => { setAddMode(false); setShowInfo(false); }}
                        className="shrink-0 w-8 h-8 grid place-items-center rounded-lg bg-slate-100 text-ivory-300 hover:bg-slate-200 transition">
                        ✕
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 chat-scroll">
                      <div className="flex flex-col items-center text-center">
                        <span className="relative">
                          <GroupBadge src={activeGroup?.avatar} size={80} />
                          {isAdmin && (
                            <label title="Set group photo"
                              className="absolute -bottom-1 -right-1 w-7 h-7 grid place-items-center rounded-full bg-gold-500 text-white text-sm cursor-pointer hover:bg-gold-400 transition">
                              📸
                              <input type="file" className="hidden" onChange={doSetGroupAvatar}
                                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" />
                            </label>
                          )}
                        </span>
                        <p className="mt-3 text-base font-bold text-ivory-100">{activeGroup?.name || 'Group'}</p>
                        <p className="text-xs text-ivory-500">{activeGroupMembers.length} member{activeGroupMembers.length === 1 ? '' : 's'}</p>
                      </div>

                      <div className="mt-4 space-y-2 rounded-xl bg-ink-900/50 border border-ivory-700/30 px-4 py-3 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-ivory-500">Created</span>
                          <span className="text-ivory-200 text-right">{fmtDateTime(activeGroup?.created_at) || '…'}</span>
                        </div>
                        <div className="flex justify-between gap-3 items-center">
                          <span className="text-ivory-500">Created by</span>
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="text-ivory-200 truncate">{creatorName}</span>
                            {!!creatorRole && (
                              <span className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold-500/15 text-gold-400 font-bold">{creatorRole}</span>
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase tracking-wide text-ivory-500">Members · {activeGroupMembers.length}</p>
                          {isAdmin && (
                            <Button type="button" variant="secondary" size="sm" onClick={() => setAddMode((m) => !m)}>
                              {addMode ? 'Done' : '+ Add'}
                            </Button>
                          )}
                        </div>
                        {addMode && isAdmin ? (
                          <div className="max-h-44 overflow-y-auto rounded-lg border border-ivory-700/30 p-2 chat-scroll">
                            {notYetInGroup.length === 0 ? (
                              <p className="text-xs text-ivory-500 py-1 px-1">Everyone is in the group.</p>
                            ) : notYetInGroup.map((c) => (
                              <label key={c.id} className="flex items-center gap-2 py-1.5 px-1 text-sm text-ivory-300 cursor-pointer">
                                <input type="checkbox" checked={picked.has(Number(c.id))} onChange={() => togglePick(Number(c.id))} className="accent-gold-500" />
                                <span className="truncate">{c.name}</span>
                              </label>
                            ))}
                            {notYetInGroup.length > 0 && (
                              <Button type="button" variant="primary" size="sm" fullWidth className="mt-2" onClick={doAddMembers}>
                                Add selected
                              </Button>
                            )}
                          </div>
                        ) : (
                          <ul className="divide-y divide-ivory-700/20 rounded-lg border border-ivory-700/30 px-2 max-h-44 overflow-y-auto chat-scroll">
                            {activeGroupMembers.map((m, i) => (
                              <li key={m.id} className="flex items-center gap-2 py-1.5 chat-member-row chat-member-enter"
                                style={{ animationDelay: `${Math.min(i * 0.035, 0.35)}s` }}>
                                <span className="relative shrink-0">
                                  <PersonAvatar u={m} name={m.name} size={32} />
                                  <span className={"online-dot absolute -bottom-0.5 -right-0.5 ring-2 ring-ink-900 " + (isOnline(m.id) ? 'online-dot-on' : '')} />
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm text-ivory-300 truncate">{m.name}{Number(m.id) === meId && ' (you)'}</span>
                                    <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold-500/15 text-gold-400 font-bold">{m.role}</span>
                                  </span>
                                  <span className="block text-[10px] text-ivory-600">{isOnline(m.id) ? '● Online now' : 'Offline'}</span>
                                </span>
                                {isAdmin && Number(m.id) !== meId && (
                                  <button type="button" onClick={() => doRemoveMember(Number(m.id))} title="Remove from group"
                                    className="shrink-0 w-6 h-6 grid place-items-center rounded-md bg-slate-100 text-ivory-500 hover:text-red-500 hover:bg-red-500/10 transition text-xs">
                                    ✕
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={listRef} className="chat-list flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 chat-list-bg chat-scroll chat-scroll-thin">
                {groupMessages.length === 0 ? (
                  <p className="px-4 py-10 text-center text-base text-ivory-500">No messages yet — say hi!</p>
                ) : groupMessages.map((m) => {
                  const mine = Number(m.sender_id) === meId;
                  return (
                    <div key={m.id} className={"group flex " + (mine ? 'justify-end' : 'justify-start')}>
                      <div
                        onTouchStart={startHold(m, 'group', mine, isAdmin)}
                        onTouchMove={moveHold}
                        onTouchEnd={clearHold}
                        onTouchCancel={clearHold}
                        onContextMenu={(e) => { e.preventDefault(); openSheet(m, 'group', mine, isAdmin); }}
                        className={"relative max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed select-none " +
                        (mine
                          ? 'bg-gold-500 text-white rounded-br-sm'
                          : 'chat-bubble-in text-ivory-300 rounded-bl-sm')}>
                        <QuickReactions scope="group" messageId={m.id} onReact={doReact} alignRight={mine} />
                        <MessageOptionsButton onOpen={() => openSheet(m, 'group', mine, isAdmin)} />
                        {!mine && (
                          <div className="flex items-center gap-1.5 mb-1">
                            <PersonAvatar u={{ avatar_config: m.sender_avatar, profile_image: m.sender_image }} name={m.sender_name} size={28} />
                            <span className="text-[11px] font-bold text-gold-700">{m.sender_name}</span>
                          </div>
                        )}
                        {m.message && <div className="whitespace-pre-wrap break-words">{m.message}</div>}
                        <AttachmentBubble m={m} />
                        <div className={"text-[10px] mt-1 " + (mine ? 'text-white/70' : 'text-ivory-500')}>{fmtTime(m.created_at)}</div>
                        <ReactionChips m={m} scope="group" onReact={doReact} meId={meId} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={(e) => { e.preventDefault(); doSendGroup(); }} className="chat-composer shrink-0 px-3 min-[769px]:px-4 py-3.5 border-t border-ivory-700/40">
                {attach && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
                    {isImageType(attach.type) && attachUrl ? (
                      <img src={attachUrl} alt="" className="h-10 w-10 object-cover rounded" />
                    ) : <span className="text-lg">📎</span>}
                    <span className="flex-1 min-w-0 text-xs text-ivory-300 truncate">{attach.name}</span>
                    <button type="button" onClick={() => setAttach(null)} className="text-ivory-500 hover:text-red-500 transition text-xs">✕</button>
                  </div>
                )}
                <div className="flex gap-2">
                  <div className="relative shrink-0">
                    <button type="button" onClick={() => toggleEmoji('group')} title="Emoji"
                      className={"w-11 h-11 grid place-items-center rounded-lg text-lg transition " +
                        (emojiOpen && emojiScope === 'group'
                          ? 'bg-gold-500/25 text-gold-400'
                          : 'bg-slate-100 text-ivory-300 hover:bg-slate-200')}>
                      😊
                    </button>
                    {emojiOpen && emojiScope === 'group' && (
                      <EmojiPicker onPick={insertEmoji} onClose={() => { setEmojiOpen(false); setEmojiScope(null); }} />
                    )}
                  </div>
                  <label className="shrink-0 w-11 h-11 grid place-items-center rounded-lg bg-slate-100 text-ivory-300 hover:bg-slate-200 cursor-pointer transition text-lg" title="Attach image or file">
                    📎
                    <input type="file" className="hidden" onChange={pickFile}
                      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" />
                  </label>
                  <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEmojiOpen(false); }} placeholder="Type a message…"
                    className="flex-1 min-w-0 bg-ink-900 border border-ivory-700/30 rounded-lg px-4 py-3 text-[15px] text-ivory-300 placeholder:text-ivory-600 outline-none focus:border-gold-500/60 transition" />
                  <Button type="submit" variant="primary" size="lg" className="shrink-0" disabled={!input.trim() && !attach}>
                    Send
                  </Button>
                </div>
              </form>
            </>
          ) : dmOpen ? (
            <>
              <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3.5 border-b border-ivory-700/40">
                <div className="flex items-center gap-3 min-w-0">
                  <button type="button" onClick={closeThread} aria-label="Back to messages"
                    className="shrink-0 w-10 h-10 grid place-items-center rounded-lg bg-slate-100 text-ivory-300 hover:bg-slate-200 transition text-lg">
                    ←
                  </button>
                  <span className="relative shrink-0">
                    <PersonAvatar u={otherContact} name={otherName} size={48} />
                    <span className={"online-dot absolute -bottom-0.5 -right-0.5 ring-2 ring-ink-800 " + (isOnline(threadFor) ? 'online-dot-on' : '')} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[17px] font-bold text-ivory-100 truncate">{otherName}</span>
                    <span className="block text-xs text-ivory-500">
                      {otherContact?.role ? <>{otherContact.role} · </> : null}
                      {isOnline(threadFor) ? '● online' : 'offline'}
                    </span>
                  </span>
                </div>
              </div>

              <div ref={listRef} className="chat-list flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 chat-list-bg chat-scroll chat-scroll-thin">
                {messages.length === 0 ? (
                  <p className="px-4 py-10 text-center text-base text-ivory-500">No messages yet — say hi!</p>
                ) : messages.map((m) => {
                  const mine = Number(m.sender_id) === meId;
                  return (
                    <div key={m.id} className={"group flex " + (mine ? 'justify-end' : 'justify-start')}>
                      <div
                        onTouchStart={startHold(m, 'dm', mine, false)}
                        onTouchMove={moveHold}
                        onTouchEnd={clearHold}
                        onTouchCancel={clearHold}
                        onContextMenu={(e) => { e.preventDefault(); openSheet(m, 'dm', mine, false); }}
                        className={"relative max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed select-none " +
                        (mine
                          ? 'bg-gold-500 text-white rounded-br-sm'
                          : 'chat-bubble-in text-ivory-300 rounded-bl-sm')}>
                        <QuickReactions scope="dm" messageId={m.id} onReact={doReact} alignRight={mine} />
                        <MessageOptionsButton onOpen={() => openSheet(m, 'dm', mine, false)} />
                        {!mine && <div className="text-[11px] text-ivory-400 mb-0.5">{m.sender_name}</div>}
                        <div className="whitespace-pre-wrap break-words">{m.message || ''}</div>
                        {m.attachment && <AttachmentBubble m={m} />}
                        <div className={"text-[10px] mt-1 " + (mine ? 'text-white/70' : 'text-ivory-500')}>{fmtTime(m.created_at)}</div>
                        <ReactionChips m={m} scope="dm" onReact={doReact} meId={meId} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Read-only notice. Replaces the composer entirely rather than
                  disabling it, so there is no input left that looks sendable. */}
              {dmCancelled ? (
                <div role="status" className="shrink-0 border-t border-ivory-700/40 px-4 py-3">
                  <p className="rounded-lg border border-ivory-700/60 bg-slate-100 px-3 py-2 text-center text-base font-semibold text-ivory-200">
                    This chat was cancelled
                  </p>
                  <p className="mt-1.5 text-center text-sm text-ivory-500">
                    Cancelled by {dmCancelled.cancelledBy}
                    {dmCancelled.cancelledAt
                      ? ` on ${fmtDay(dmCancelled.cancelledAt)}`
                      : ''}
                    . Neither of you can send messages any more, and you can only
                    message again by sending a new chat request.
                  </p>
                </div>
              ) : (
              <form onSubmit={(e) => { e.preventDefault(); doSendDm(); }} className="chat-composer shrink-0 px-3 min-[769px]:px-4 py-3.5 border-t border-ivory-700/40">
                {attach && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
                    {isImageType(attach.type) && attachUrl ? (
                      <img src={attachUrl} alt="" className="h-10 w-10 object-cover rounded" />
                    ) : <span className="text-lg">📎</span>}
                    <span className="flex-1 min-w-0 text-xs text-ivory-300 truncate">{attach.name}</span>
                    <button type="button" onClick={() => setAttach(null)} className="text-ivory-500 hover:text-red-500 transition text-xs">✕</button>
                  </div>
                )}
                <div className="flex gap-2">
                  <div className="relative shrink-0">
                    <button type="button" onClick={() => toggleEmoji('dm')} title="Emoji"
                      className={"w-11 h-11 grid place-items-center rounded-lg text-lg transition " +
                        (emojiOpen && emojiScope === 'dm'
                          ? 'bg-gold-500/25 text-gold-400'
                          : 'bg-slate-100 text-ivory-300 hover:bg-slate-200')}>
                      😊
                    </button>
                    {emojiOpen && emojiScope === 'dm' && (
                      <EmojiPicker onPick={insertEmoji} onClose={() => { setEmojiOpen(false); setEmojiScope(null); }} />
                    )}
                  </div>
                  <label className="shrink-0 w-11 h-11 grid place-items-center rounded-lg bg-slate-100 text-ivory-300 hover:bg-slate-200 cursor-pointer transition text-lg" title="Attach image or file">
                    📎
                    <input type="file" className="hidden" onChange={pickFile}
                      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" />
                  </label>
                  <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEmojiOpen(false); }} placeholder="Type a message…"
                    className="flex-1 min-w-0 bg-ink-900 border border-ivory-700/30 rounded-lg px-4 py-3 text-[15px] text-ivory-300 placeholder:text-ivory-600 outline-none focus:border-gold-500/60 transition" />
                  <Button type="submit" variant="primary" size="lg" className="shrink-0" disabled={!input.trim() && !attach}>
                    Send
                  </Button>
                </div>
              </form>
              )}
            </>
          ) : (
            /* A blocked contact was picked in the People tab, or arrived here via
               a stale deep link. Show the approval flow rather than a dead
               thread or a silent no-op. */
            requestTarget ? (
              <div className="flex-1 grid place-items-center px-6 relative">
                <button
                  type="button"
                  onClick={() => setRequestTarget(null)}
                  aria-label="Back to messages"
                  className="min-[769px]:hidden absolute top-3 left-3 shrink-0 w-10 h-10 grid place-items-center rounded-lg bg-slate-100 text-ivory-300 hover:bg-slate-200 transition text-lg"
                >
                  ←
                </button>
                <div className="text-center max-w-sm">
                  <p className="text-3xl mb-2">🔒</p>
                  <h2 className="font-display text-xl font-bold text-ivory-100 mb-1">
                    Chat with {requestTarget.name}
                  </h2>
                  <p className="text-base text-ivory-500 mb-4">
                    You need your coach&apos;s approval before you can start chatting with this user.
                  </p>
                  <div className="flex justify-center">
                    <ChatRequestButton targetUserId={requestTarget.id} targetName={requestTarget.name} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 grid place-items-center px-6">
                <div className="text-center">
                  <p className="text-3xl mb-2">💬</p>
                  <p className="text-base text-ivory-500 max-w-xs mx-auto">
                    Pick a conversation on the left to start messaging.
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* ── New group modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-ivory-700/50 bg-ink-800 p-5 shadow-2xl">
            <h2 className="font-display text-lg font-bold text-ivory-100 mb-3">New group</h2>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name"
              autoFocus
              className="w-full bg-ink-900 border border-ivory-700/30 rounded-lg px-3 py-2.5 text-sm text-ivory-300 placeholder:text-ivory-600 outline-none focus:border-gold-500/60 transition mb-3" />
            <p className="text-xs font-bold uppercase tracking-wide text-ivory-500 mb-2">Add members</p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-ivory-700/30 mb-3">
              {everyone.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-ivory-500">No users to add.</p>
              ) : everyone.map((c) => (
                <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm text-ivory-300 cursor-pointer hover:bg-slate-100 transition">
                  <input type="checkbox" checked={picked.has(Number(c.id))} onChange={() => togglePick(Number(c.id))} className="accent-gold-500" />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto text-[9px] uppercase px-1.5 py-0.5 rounded bg-gold-500/15 text-gold-400 font-bold">{c.role}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="md" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" size="md" onClick={doCreate} disabled={!newName.trim() || creating}>
                {creating ? 'Creating…' : 'Create group'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reactions + delete, in one viewport-centred sheet (see MessageActionSheet
          for why this can't be an in-bubble popover). */}
      {sheetFor && (
        <MessageActionSheet
          target={sheetFor}
          meId={meId}
          onClose={() => setSheetFor(null)}
          onReact={doReact}
          onDelete={doDelete}
        />
      )}
    </div>
  );
}