import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../Button';
import { useLiveClass } from '../../context/LiveClassContext';
import { useAuth } from '../../context/AuthContext';
import { emit, on } from '../../services/socket';
import { clearChat } from '../../services/liveClassApi';
/* The course browser (and the Library page it pulls in) is the heaviest thing
   in the rail, so it rides a separate chunk. The tab opens to a skeleton
   instantly; the chunk loads behind it. Hovering or focusing the chip — or an
   idle moment after boot — warms the chunk so the first real open is free. */
const CourseFilesPanel = lazy(() => import('./CourseFilesPanel'));
function prefetchCourseFiles() {
  import('./CourseFilesPanel').catch(() => {});
}
import LiveMoveHistory from './LiveMoveHistory';
import ClassroomLeaderboard from './ClassroomLeaderboard';
import ClassAssignmentsPanel from './ClassAssignmentsPanel';
import { formatTime } from '../../utils/formatTime';

/* A stable, client-generated id for a message that has not reached the server
   yet. It is echoed back on the saved copy so the optimistic bubble can be
   matched and confirmed instead of duplicating. */
function makeClientId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through to the timestamp id */ }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* A small unread-count badge. Counts above 99 collapse to "99+" so a busy
   thread cannot stretch the tab. Shared with the room header (the rail toggle
   shows the total when the panel is collapsed). */
export function UnreadBadge({ count }) {
  if (!count) return null;
  return <span className="live-unread-badge">{count > 99 ? '99+' : count}</span>;
}

export default function ChatPanel({ asMobilePanel = false, panelVisible = true, onUnreadChange = null }) {
  const { classMeta, setClassMeta, isInstructor, permissions, chat, appendChat, setChat, privateChat, appendPrivateChat, setPrivateChat, participants, upsertParticipant, removeParticipant, replaceParticipants, activityByStudent, setStudentActivity, bulkSetActivity, clearStudentActivity } = useLiveClass();
  const { user } = useAuth();
  const me = user ? Number(user.id) : null;
  /* Which student thread the instructor last had open, remembered per class so a
     refresh restores the selection without ever auto-opening a new one. */
  const dmStoreKey = classMeta?.id != null ? `liveChatDm:${classMeta.id}` : null;
  const [text, setText] = useState('');
  const [dmText, setDmText] = useState('');
  const [sending, setSending] = useState(false);
  const [chatMode, setChatMode] = useState(classMeta?.chatMode || 'open');
  const [error, setError] = useState('');
  const [moveGrants, setMoveGrants] = useState(classMeta?.moveGrants || []);
  const [tab, setTab] = useState(() => {
    try {
      const t = localStorage.getItem('liveChatTab');
      /* The Course and Assignments tabs are coach-only, so a student must never
         restore them from a value a coach left behind on a shared browser/profile
         — otherwise the class's course folders, or other students' statuses,
         would open on their side unprompted. */
      if ((t === 'files' || t === 'assignments') && !isInstructor) return 'chat';
      return t === 'files' || t === 'moves' || t === 'leaderboard' || t === 'participants' || t === 'assignments' ? t : 'chat';
    } catch { return 'chat'; }
  }); // 'chat' | 'files' | 'moves' | 'leaderboard' | 'participants' | 'assignments' (persisted across refresh; 'files'/'assignments' are coach-only)
  const listRef = useRef(null);
  /* Private thread state. `selectedPeer` changes ONLY on an instructor click (or
     a click restored from the last visit) — NEVER as a side effect of a new
     message. That is what stops an incoming DM from another student from yanking
     the open thread, its scroll position, or a half-typed reply out from under
     the instructor. */
  const dmListRef = useRef(null);
  const [selectedPeer, setSelectedPeer] = useState(() => {
    try {
      const raw = dmStoreKey ? localStorage.getItem(dmStoreKey) : null;
      return raw != null && raw !== '' ? Number(raw) : null;
    } catch { return null; }
  });
  const [replyText, setReplyText] = useState('');
  const [dmBusy, setDmBusy] = useState(false);
  /* Whether the open thread is scrolled to its newest message, and whether a
     message arrived while the instructor was scrolled up (drives the
     "New messages ↓" pill instead of a forced jump). */
  const [dmPinned, setDmPinned] = useState(true);
  const [dmHasNew, setDmHasNew] = useState(false);
  /* A stable handle the socket listener reads at event time, so it never needs
     re-registering (which would drop messages mid-session) and always sees the
     current selection / visibility. */
  const liveRef = useRef({});

  /* Warm the course chunk when the browser is idle, so the first open never
     pays for the download. One shot — the import itself is cached. */
  useEffect(() => {
    if (!isInstructor) return undefined;
    let cancelled = false;
    const warm = () => { if (!cancelled) prefetchCourseFiles(); };
    let idleId = null;
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(warm, { timeout: 4000 });
    } else {
      idleId = window.setTimeout(warm, 2500);
    }
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === 'function' && idleId != null) window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, [isInstructor]);

  /* Sticky tabs: a chip always SHOWS its panel (no toggling back to chat when
     the chip is already active). The Chat chip is the explicit way home, so the
     old toggle-on-second-click just read as "the panel I'm holding keeps
     disappearing". Picking a tab also remembers it for the next visit, so a
     live move never changes which panel is open. */
  function openTab(t) {
    setTab(t);
    try { localStorage.setItem('liveChatTab', t); } catch (_) {}
  }

  useEffect(() => {
    const offs = [
      on('chat_message_broadcast', (msg) => {
        if (msg) appendChat(msg);
      }),
      on('chat_mode_changed', ({ mode }) => {
        setChatMode(mode);
      }),
      on('chat_cleared', () => {
        setChat([]);
      }),
      on('chat_dm', (msg) => {
        if (!msg) return;
        appendPrivateChat(msg);
        /* Instructor inbox: a message from a student becomes unread (a badge on
           that student's tab) UNLESS that exact thread is open AND the panel is
           showing the chat tab — then it is read at once and no badge appears.
           A message for a non-open thread never touches the open one, and a
           message for the open thread only auto-scrolls when the instructor was
           already at the bottom; otherwise the "New messages ↓" pill shows. */
        const s = liveRef.current;
        if (!s.isInstructor || s.me == null) return;
        const fromPeer = Number(msg.senderId);
        if (fromPeer === s.me || Number(msg.recipientId) !== s.me) return;
        const visible = s.panelVisible && s.tab === 'chat';
        if (visible && fromPeer === s.selectedPeer) {
          s.markPeerRead(fromPeer);
          if (s.dmPinned) {
            requestAnimationFrame(() => {
              const el = dmListRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          } else {
            setDmHasNew(true);
          }
        }
      }),
      on('participant_joined', (p) => {
        if (p && p.userId != null) upsertParticipant({
          userId: p.userId,
          name: p.name,
          roleInClass: p.role,
          status: 'active',
          joinedAt: new Date().toISOString(),
        });
      }),
      on('participant_left', ({ userId }) => {
        if (userId != null) {
          removeParticipant(userId);
          clearStudentActivity(userId);
        }
      }),
      on('class_kicked', () => {
        setError('You were removed from this class.');
      }),
      on('request_mute', () => {
        // Native audio already muted on toggle; rely on the video participant's mute request.
      }),
      on('move_grant_changed', ({ userId: gUserId, side }) => {
        setMoveGrants((prev) => {
          const rest = (prev || []).filter((g) => g.userId !== gUserId);
          return side ? [...rest, { userId: gUserId, moveSide: side }] : rest;
        });
      }),
      on('pvp-pairing', (payload) => {
        if (!isInstructor) return;
        const games = payload?.games || [];
        for (const g of games) {
          const gameId = Number(g.gameId);
          const whiteId = Number(g.whiteId);
          const blackId = Number(g.blackId);
          if (whiteId) setStudentActivity(whiteId, { status: 'in-game', gameId });
          if (blackId) setStudentActivity(blackId, { status: 'in-game', gameId });
        }
      }),
      on('pvp-finished', (payload) => {
        if (!isInstructor) return;
        const gameId = Number(payload?.gameId);
        if (!gameId) return;
        bulkSetActivity((prev) => {
          const next = { ...prev };
          for (const [uid, info] of Object.entries(next)) {
            if (Number(info.gameId) === gameId) {
              next[uid] = { ...info, status: 'finished', result: payload.result || null, reason: payload.reason || null };
            }
          }
          return next;
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [appendChat, setChat, upsertParticipant, removeParticipant, clearStudentActivity, isInstructor, setStudentActivity, bulkSetActivity]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chat]);

  /* ── Private student ⇄ coach conversation ──────────────────────────────────
     One thread per student, shared by both ends. The server stores every DM with
     live_class_id + sender_id + recipient_id + is_private and loads history for
     (sender = me OR recipient = me), so `privateChat` already holds exactly this
     viewer's conversation: a student's single thread, or — for a coach — every
     student's thread, grouped by the student id below. */
  const studentThread = useMemo(
    () => [...privateChat].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    [privateChat]
  );

  /* Coach side: one thread per student. The peer of a message is always the
     student — whether they wrote it or the coach replied — so a student who
     addressed one host still lands in exactly one thread. */
  const dmThreads = useMemo(() => {
    if (!isInstructor || me == null) return [];
    const map = new Map();
    for (const m of privateChat) {
      const sender = Number(m.senderId);
      const recipient = Number(m.recipientId);
      const peer = sender === me ? recipient : sender;
      if (peer == null || Number.isNaN(peer) || peer === me) continue;
      let entry = map.get(peer);
      if (!entry) { entry = { peerId: peer, name: '', messages: [] }; map.set(peer, entry); }
      entry.messages.push(m);
      if (sender !== me && m.userName) entry.name = m.userName;
    }
    const list = [...map.values()];
    for (const t of list) {
      t.messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      if (!t.name) t.name = `Student ${t.peerId}`;
    }
    list.sort((a, b) => {
      const la = a.messages[a.messages.length - 1]?.createdAt || 0;
      const lb = b.messages[b.messages.length - 1]?.createdAt || 0;
      return new Date(lb) - new Date(la);
    });
    return list;
  }, [privateChat, isInstructor, me]);

  const selectedThread = dmThreads.find((t) => t.peerId === selectedPeer) || null;

  /* Unread = inbound rows (a student writing to me) that have no `read_at` yet.
     The flag is the server's own column, so the count survives a refresh;
     stamping it here is only the optimistic half of marking a thread read. */
  const markPeerRead = useCallback((peer) => {
    if (peer == null) return;
    const target = Number(peer);
    setPrivateChat((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (Number(m.recipientId) === me && Number(m.senderId) === target && !m.readAt) {
          changed = true;
          return { ...m, readAt: new Date().toISOString() };
        }
        return m;
      });
      return changed ? next : prev;
    });
    emit('chat_dm_read', { classId: classMeta?.id, peerId: target }, () => {});
  }, [me, setPrivateChat, classMeta?.id]);

  /* Unread per student, DERIVED from the messages (never a separate counter), so
     it cannot drift from what is on screen. A row is mine (outbound) when its
     sender is me; only inbound, still-unread rows are counted. */
  const unreadByPeer = useMemo(() => {
    const map = new Map();
    if (!isInstructor || me == null) return map;
    for (const m of privateChat) {
      if (Number(m.recipientId) === me && Number(m.senderId) !== me && !m.readAt) {
        const peer = Number(m.senderId);
        map.set(peer, (map.get(peer) || 0) + 1);
      }
    }
    return map;
  }, [privateChat, isInstructor, me]);

  const totalUnread = useMemo(() => {
    let n = 0;
    unreadByPeer.forEach((c) => { n += c; });
    return n;
  }, [unreadByPeer]);

  function scrollDmToBottom() {
    const el = dmListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setDmPinned(true);
    setDmHasNew(false);
  }

  function handleDmScroll() {
    const el = dmListRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setDmPinned(atBottom);
    if (atBottom) setDmHasNew(false);
  }

  /* The instructor opens a thread ONLY by clicking its tab: select it, clear its
     badge (mark read), and jump to the newest message. */
  function openPeer(peer) {
    setSelectedPeer(peer);
    if (isInstructor) markPeerRead(peer);
    requestAnimationFrame(scrollDmToBottom);
  }

  /* Reconcile a restored/selected thread that no longer has any messages (a
     stale localStorage id). This only ever CLEARS a selection — it never opens
     one — so a new student's first message cannot steal the open thread. */
  useEffect(() => {
    if (!isInstructor) return;
    if (selectedPeer == null) return;
    if (dmThreads.some((t) => t.peerId === selectedPeer)) return;
    setSelectedPeer(null);
  }, [isInstructor, dmThreads, selectedPeer]);

  /* Remember the open thread per class, so a refresh comes back to the same one. */
  useEffect(() => {
    if (!dmStoreKey) return;
    try { localStorage.setItem(dmStoreKey, selectedPeer == null ? '' : String(selectedPeer)); } catch { /* storage may be unavailable */ }
  }, [dmStoreKey, selectedPeer]);

  /* Student side: keep their single thread pinned to the newest message. */
  useEffect(() => {
    if (isInstructor) return;
    const el = dmListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [privateChat.length, isInstructor]);

  /* Instructor side: whenever the panel is actually showing the open thread (the
     chat tab, rail not collapsed), mark it read — clearing a badge that built up
     while the panel was hidden — and keep it pinned to the bottom. */
  useEffect(() => {
    if (!isInstructor) return;
    if (!panelVisible || tab !== 'chat') return;
    if (selectedPeer == null) return;
    markPeerRead(selectedPeer);
    const el = dmListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setDmHasNew(false);
    setDmPinned(true);
  }, [isInstructor, panelVisible, tab, selectedPeer, markPeerRead]);

  /* Publish the total so the room header can badge the collapsed rail. */
  useEffect(() => {
    if (typeof onUnreadChange === 'function') onUnreadChange(totalUnread);
  }, [totalUnread, onUnreadChange]);

  /* Everything the socket listener needs at event time. */
  liveRef.current = {
    isInstructor,
    me,
    selectedPeer,
    tab,
    panelVisible,
    dmPinned,
    markPeerRead,
  };

  const markDmFailed = useCallback((clientId) => {
    setPrivateChat((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, pending: false, failed: true } : m)));
  }, [setPrivateChat]);

  const markDmPending = useCallback((clientId) => {
    setPrivateChat((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, pending: true, failed: false } : m)));
  }, [setPrivateChat]);

  /* Student → coach. Added locally first (optimistic, pending), then confirmed
     when the server echoes the saved copy back with the same clientId. */
  function sendStudentDm(e) {
    e.preventDefault();
    const trimmed = dmText.trim();
    if (!trimmed || dmBusy) return;
    const clientId = makeClientId();
    appendPrivateChat({
      id: clientId,
      clientId,
      senderId: me,
      recipientId: null,
      userName: user?.name || 'You',
      userRole: user?.role,
      message: trimmed,
      createdAt: new Date().toISOString(),
      pending: true,
      failed: false,
    });
    setDmText('');
    setDmBusy(true);
    emit('chat_dm', { classId: classMeta.id, text: trimmed, clientId }, (res) => {
      setDmBusy(false);
      if (res?.ok === false) {
        setError(res.error || 'Could not send message');
        markDmFailed(clientId);
      }
    });
  }

  /* Coach → student. Same optimistic flow, on the reply event. */
  function sendInstructorReply(e) {
    e.preventDefault();
    const trimmed = replyText.trim();
    if (!trimmed || selectedPeer == null || dmBusy) return;
    const clientId = makeClientId();
    appendPrivateChat({
      id: clientId,
      clientId,
      senderId: me,
      recipientId: selectedPeer,
      userName: user?.name || 'Coach',
      userRole: user?.role,
      message: trimmed,
      createdAt: new Date().toISOString(),
      pending: true,
      failed: false,
    });
    setReplyText('');
    setDmBusy(true);
    emit('chat_dm_reply', { classId: classMeta.id, toUserId: selectedPeer, text: trimmed, clientId }, (res) => {
      setDmBusy(false);
      if (res?.ok === false) {
        setError(res.error || 'Could not send reply');
        markDmFailed(clientId);
      }
    });
  }

  /* Re-send a failed message with its original clientId, so the eventual echo
     still replaces this same bubble rather than adding a second one. */
  function retryDm(m) {
    markDmPending(m.clientId);
    if (isInstructor) {
      emit('chat_dm_reply', { classId: classMeta.id, toUserId: Number(m.recipientId), text: m.message, clientId: m.clientId }, (res) => {
        if (res?.ok === false) { setError(res.error || 'Could not send reply'); markDmFailed(m.clientId); }
      });
    } else {
      emit('chat_dm', { classId: classMeta.id, text: m.message, clientId: m.clientId }, (res) => {
        if (res?.ok === false) { setError(res.error || 'Could not send message'); markDmFailed(m.clientId); }
      });
    }
  }

  /* One DM bubble, used by both ends. Mine right-aligned and labelled "You";
     pending and failed get their own state so a message is never left hidden. */
  function renderDm(m) {
    const mine = me != null && Number(m.senderId) === me;
    return (
      <div key={m.clientId || m.id} className={`live-msg live-msg-dm ${mine ? 'live-msg-mine' : ''}`}>
        <div className="live-msg-meta">
          <span className="live-msg-name">{mine ? 'You' : (m.userName || 'Coach')}</span>
          <span className="live-msg-time">{formatTime(m.createdAt)}</span>
        </div>
        <div className="live-msg-body">{m.message}</div>
        {m.pending && <span className="live-dm-status">Sending…</span>}
        {m.failed && (
          <span className="live-dm-status live-dm-status-failed">
            Not sent.{' '}
            <Button type="button" variant="ghost" size="sm" onClick={() => retryDm(m)}>Retry</Button>
          </span>
        )}
      </div>
    );
  }

  function sendMessage(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !permissions.canSendChat) return;
    setSending(true);
    setText('');
    emit('chat_message', { classId: classMeta.id, text: trimmed }, (res) => {
      setSending(false);
      if (res?.ok === false) {
        setError(res.error || 'Could not send message');
        setText(trimmed);
      }
    });
  }

  function handleClearChat() {
    if (!window.confirm('Clear all chat messages?')) return;
    clearChat(classMeta.id)
      .then(() => setChat([]))
      .catch(() => setError('Could not clear chat'));
  }

  function setMode(mode) {
    setChatMode(mode);
    emit('admin:set_chat_mode', { classId: classMeta.id, mode }, (res) => {
      if (res?.ok === false) setError(res.error || 'Could not change chat mode');
      else setChatMode(mode);
    });
  }

  function removeUser(userId, name) {
    if (!window.confirm(`Remove ${name} from the class?`)) return;
    emit('admin:remove_participant', { classId: classMeta.id, userId }, (res) => {
      if (res?.ok === false) setError(res.error || 'Could not remove participant');
    });
  }

  function setGrant(userId, side) {
    setMoveGrants((prev) => {
      const rest = (prev || []).filter((g) => g.userId !== userId);
      return side === 'none' ? rest : [...rest, { userId, moveSide: side }];
    });
    emit('student_move_grant', { classId: classMeta.id, userId, side }, (res) => {
      if (res?.ok === false) setError(res.error || 'Could not update grant');
    });
  }

  /* The class-wide stop. It flips the SAME stored switch the Board tools
     "Students move" chip uses, so the two controls can never disagree: the
     server persists it, rejects student moves while it is off, and the
     `interaction_changed` echo keeps every tab in step. Applied optimistically
     and reverted if the server refuses. */
  function toggleAllStudentMoves() {
    const next = !classMeta?.studentInteractionEnabled;
    setClassMeta((prev) => (prev ? { ...prev, studentInteractionEnabled: next } : prev));
    /* The switch lives inside the classroom's `chess_control` channel, the same
       one the board's own "Students move" chip uses - there is no standalone
       socket event for it, so a raw `toggle_interaction` emit never reached the
       server and the DB stayed on while the button turned green. */
    emit('chess_control', { classId: classMeta.id, action: 'toggle_interaction', payload: { enabled: next } }, (res) => {
      if (res?.ok === false) {
        setClassMeta((prev) => (prev ? { ...prev, studentInteractionEnabled: !next } : prev));
        setError(res.error || 'Could not update student moves');
      }
    });
  }

  /* The colours a move grant can carry - the same white/black/both the board
     already understands. Each student holds at most one, so a colour already
     spoken for is offered disabled, and revoking frees it for someone else. */
  const GRANT_COLOURS = ['white', 'black', 'both'];
  const grantOf = (userId) => (moveGrants || []).find((g) => g.userId === userId);
  const colourTakenByOther = (userId, side) =>
    (moveGrants || []).some((g) => g.userId !== userId && g.moveSide === side);
  const freeColours = GRANT_COLOURS.filter(
    (side) => !(moveGrants || []).some((g) => g.moveSide === side)
  );
  function grantFirstFree(userId) {
    if (freeColours.length) setGrant(userId, freeColours[0]);
  }

  /* One roster, read in three places: the chip count, the tab head and the list
     body. Filtered once here so the three can never disagree. */
  const inRoom = (participants || []).filter((p) => p.status !== 'left');
  /* Hosts first (Head Coach and other HOST users), then students by name. */
  const roster = [...inRoom].sort((a, b) => {
    const ah = a.roleInClass === 'host' ? 0 : 1;
    const bh = b.roleInClass === 'host' ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return (a.name || '').localeCompare(b.name || '');
  });
  const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';

  /* Grants and the roster are the same list of people, so they are one panel:
     a single row per person carries the name, the move colour and the actions.
     The list - and only the list - scrolls; the panel around it stays bounded. */
  const participantsBody = (
    <div className="live-participants live-participants--tab">
      <div className="live-participants-title">
        <span>👥 Participants ({inRoom.length})</span>
        {isInstructor && <span className="live-participants-hint">admins can grant/remove</span>}
      </div>
      {isInstructor && (
        <button
          type="button"
          className={`live-stop-btn ${classMeta?.studentInteractionEnabled ? 'is-stop' : 'is-allow'}`}
          onClick={toggleAllStudentMoves}
          aria-pressed={!classMeta?.studentInteractionEnabled}
          title={classMeta?.studentInteractionEnabled
            ? 'Block every student from moving pieces (server-enforced)'
            : 'Let students move pieces again'}
        >
          {classMeta?.studentInteractionEnabled ? '⛔ Stop all students' : '▶ Allow students'}
        </button>
      )}
      <ul className="live-participants-list">
        {roster.length === 0 && <li className="live-participants-empty">No participants yet.</li>}
        {roster.map((p) => {
          const isHost = p.roleInClass === 'host';
          const g = grantOf(p.userId);
          /* A host cannot be granted, muted or removed - not by another host, not
             by themselves. Students never see any action button. */
          const canManage = isInstructor && !isHost;
          return (
            <li key={p.userId} className="live-participant">
              <span
                className={`live-participant-avatar ${p.status === 'active' ? 'is-online' : ''}`}
                aria-hidden="true"
              >
                {initialOf(p.name)}
              </span>
              <span className="live-participant-name">
                {p.name}
                {isHost && <span className="live-participant-host">HOST</span>}
                {!isHost && g?.moveSide && (
                  <span
                    className={`live-participant-colour is-${g.moveSide}`}
                    title={`Move access: ${g.moveSide === 'both' ? 'either side' : g.moveSide}`}
                  />
                )}
                {!isHost && activityByStudent[p.userId] && (
                  <span
                    className={`live-participant-activity ${activityByStudent[p.userId].status === 'in-game' ? 'is-live' : 'is-done'}`}
                    title={activityByStudent[p.userId].status === 'in-game'
                      ? `In game #${activityByStudent[p.userId].gameId}`
                      : `Finished${activityByStudent[p.userId].result ? ` · ${activityByStudent[p.userId].result}` : ''}`}
                  >
                    {activityByStudent[p.userId].status === 'in-game' ? '⚔ In game' : '🏁 Done'}
                  </span>
                )}
              </span>
              {canManage && (
                <span className="live-participant-actions">
                  {g?.moveSide ? (
                    <>
                      {GRANT_COLOURS.map((side) => {
                        const taken = colourTakenByOther(p.userId, side);
                        return (
                          <button
                            key={side}
                            type="button"
                            className={`live-grant-dot is-${side} ${g.moveSide === side ? 'on' : ''} ${taken ? 'is-taken' : ''}`}
                            disabled={taken}
                            onClick={() => setGrant(p.userId, side)}
                            title={taken
                              ? `${side} is already taken by another student`
                              : `Allow ${p.name} to move ${side === 'both' ? 'either side' : side}`}
                            aria-label={`move as ${side}`}
                          />
                        );
                      })}
                      <button
                        type="button"
                        className="live-participant-revoke"
                        onClick={() => setGrant(p.userId, 'none')}
                        title="Remove move access"
                      >
                        ✖
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="live-participant-grant"
                      onClick={() => grantFirstFree(p.userId)}
                      disabled={!freeColours.length}
                      title={freeColours.length
                        ? `Grant move access to ${p.name}`
                        : 'Every colour is already assigned'}
                    >
                      Grant
                    </button>
                  )}
                  <button
                    type="button"
                    className="live-participant-remove"
                    onClick={() => removeUser(p.userId, p.name)}
                    title={`Remove ${p.name}`}
                    aria-label={`Remove ${p.name}`}
                  >
                    ⛔
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div className={`live-chat-panel ${asMobilePanel ? 'live-chat-mobile-panel' : ''}`}>
      <div className="live-chat-head">
        <div className="live-chat-modes">
          {/* The way back to the messages. Every other panel is a tab now, so
              without this the only route home was clicking whichever chip happened
              to be lit - which reads as a toggle, not as "go to chat". First in the
              bar because it is the default view. */}
          <button
            type="button"
            className={`live-chip ${tab === 'chat' ? 'live-chip-on' : ''}`}
            onClick={() => openTab('chat')}
            title="Back to the class chat"
          >
            💬 Chat
            {isInstructor && <UnreadBadge count={totalUnread} />}
          </button>
          <button
            type="button"
            className={`live-chip ${tab === 'moves' ? 'live-chip-on' : ''}`}
            onClick={() => openTab('moves')}
            title="Show the move history in this panel"
          >
            ♞ Moves
          </button>
          {/* Outside the isInstructor block on purpose: the class leaderboard is
              for the students too - it is the thing that makes the points mean
              something to them. */}
          <button
            type="button"
            className={`live-chip ${tab === 'leaderboard' ? 'live-chip-on' : ''}`}
            onClick={() => openTab('leaderboard')}
            title="Class leaderboard - points earned in this class"
          >
            🏆 Standings
          </button>
          {/* Also outside the isInstructor block: everyone can see who else is in
              the room. The count rides on the chip because the panel is only
              ~300px wide - it is the one number an instructor checks constantly,
              and it used to be buried under the message list. Grants live in this
              tab too: they are per-student, and this is the per-student tab. */}
          <button
            type="button"
            className={`live-chip ${tab === 'participants' ? 'live-chip-on' : ''}`}
            onClick={() => openTab('participants')}
            title="Who is in the room"
          >
            👥 {inRoom.length}
          </button>
          {isInstructor && (
            <>
            {/* Who in the class has done the puzzle work. Coach-only: it exposes
                every student's status, and the student list must never see that. */}
            <button
              type="button"
              className={`live-chip ${tab === 'assignments' ? 'live-chip-on' : ''}`}
              onClick={() => openTab('assignments')}
              title="Who has done the assigned work"
            >
              📋 Assignments
            </button>
            <button
              type="button"
              className={`live-chip ${tab === 'files' ? 'live-chip-on' : ''}`}
              onClick={() => openTab('files')}
              onMouseEnter={prefetchCourseFiles}
              onFocus={prefetchCourseFiles}
              title="Open the course files right here in the classroom"
            >
              📚 Course
            </button>
            </>
          )}
        </div>
      </div>

      {/* The chat's own controls, under the panel heading rather than mixed into
          the tab bar above it. They act on the messages - set who may post, wipe
          the transcript - so they belong to the chat and not to the panel, and
          the bar is for choosing a panel. Only rendered on the chat tab, since
          that is the only one they do anything to. */}
      {isInstructor && tab === 'chat' && (
        <div className="live-chat-modebar">
          <button
            type="button"
            className={`live-chip ${chatMode === 'open' ? 'live-chip-on' : ''}`}
            onClick={() => setMode('open')}
            title="Students can post in the chat"
          >
            Open
          </button>
          <button
            type="button"
            className={`live-chip ${chatMode === 'instructor-only' ? 'live-chip-on' : ''}`}
            onClick={() => setMode('instructor-only')}
            title="Students can only send you a private message"
          >
            🛡 Instructor only
          </button>
          <button type="button" onClick={handleClearChat} title="Clear chat" className="live-chip">
            🗑 Clean
          </button>
        </div>
      )}

      {error && <p className="live-chat-error">{error}</p>}

      {/* All tab panels stay mounted; inactive ones are hidden with display:none
          so their internal state (scroll position, search text, navigation, etc.)
          survives tab switches. */}
      <div className="live-chat-tabbody" style={{ display: (tab === 'files' && isInstructor) ? 'block' : 'none' }}>
        <Suspense fallback={(
          <div className="live-chat-panel" aria-busy="true" aria-label="Loading course files">
            <div className="live-course-files-scroll">
              <div className="live-course-skeleton" aria-hidden="true">
                <span className="live-course-skeleton-row" />
                <span className="live-course-skeleton-row" />
                <span className="live-course-skeleton-row" />
              </div>
            </div>
          </div>
        )}
        >
          <CourseFilesPanel asMobilePanel={asMobilePanel} hideHeader />
        </Suspense>
      </div>
      <div className="live-chat-tabbody" style={{ display: tab === 'moves' ? 'block' : 'none' }}>
        <LiveMoveHistory asMobilePanel={asMobilePanel} hideHeader />
      </div>
      <div className="live-chat-tabbody" style={{ display: tab === 'leaderboard' ? 'block' : 'none' }}>
        <ClassroomLeaderboard asMobilePanel={asMobilePanel} />
      </div>
      <div className="live-chat-tabbody" style={{ display: tab === 'participants' ? 'block' : 'none' }}>
        {participantsBody}
      </div>
      {/* Stays mounted like the other tabs; `active` is what tells it to refetch,
          so reopening always shows the latest status. */}
      <div className="live-chat-tabbody" style={{ display: (tab === 'assignments' && isInstructor) ? 'block' : 'none' }}>
        <ClassAssignmentsPanel active={tab === 'assignments' && isInstructor} asMobilePanel={asMobilePanel} />
      </div>
      <div
        className="live-chat-tabbody"
        style={{ display: tab === 'chat' || !isInstructor ? 'block' : 'none' }}
      >
        {!isInstructor && chatMode === 'instructor-only' ? (
          /* Student: the private thread with the coach, rendered IN PLACE of the
             public feed (which is closed in this mode). Both directions appear,
             own messages right-aligned and labelled "You". */
          <>
            <p className="live-chat-notice">
              🎓 Chat is instructor-only right now — this thread is private between you and the coach.
            </p>
            <div className="live-chat-list live-dm-thread" ref={dmListRef}>
              {studentThread.length === 0
                ? <p className="live-chat-empty">No messages yet — say hi! 👋</p>
                : studentThread.map(renderDm)}
            </div>
            <form onSubmit={sendStudentDm} className="live-chat-form live-chat-dm-form">
              <input
                className="live-chat-input"
                placeholder="✉️ Message the coach privately…"
                value={dmText}
                maxLength={500}
                onChange={(e) => setDmText(e.target.value)}
              />
              <button type="submit" className="live-chat-send" disabled={!dmText.trim() || dmBusy}>
                ➤
              </button>
            </form>
          </>
        ) : (
        <>
        {/* Coach: the private inbox — one thread per student, with a reply box —
           shown above the normal class chat. */}
        {isInstructor && dmThreads.length > 0 && (
          <div className="live-dm-mailbox">
            <div className="live-dm-mailbox-title">✉️ Private messages</div>
            <div className="live-dm-threads">
              {dmThreads.map((t) => (
                <button
                  key={t.peerId}
                  type="button"
                  className={`live-chip ${selectedPeer === t.peerId ? 'live-chip-on' : ''} ${unreadByPeer.get(t.peerId) ? 'live-chip-unread' : ''}`}
                  onClick={() => openPeer(t.peerId)}
                  title={`Chat with ${t.name}`}
                >
                  {t.name}
                  <UnreadBadge count={unreadByPeer.get(t.peerId)} />
                </button>
              ))}
            </div>
            {!selectedThread && (
              <p className="live-dm-hint">Select a student to open the conversation.</p>
            )}
            {selectedThread && (
              <>
                <div className="live-dm-thread" ref={dmListRef} onScroll={handleDmScroll}>
                  {selectedThread.messages.map(renderDm)}
                </div>
                {dmHasNew && (
                  <button type="button" className="live-dm-newpill" onClick={scrollDmToBottom}>
                    New messages ↓
                  </button>
                )}
                <form onSubmit={sendInstructorReply} className="live-chat-form live-chat-dm-form">
                  <input
                    className="live-chat-input"
                    placeholder={`Reply to ${selectedThread.name}…`}
                    value={replyText}
                    maxLength={500}
                    onChange={(e) => setReplyText(e.target.value)}
                  />
                  <button type="submit" className="live-chat-send" disabled={!replyText.trim() || dmBusy}>
                    ➤
                  </button>
                </form>
              </>
            )}
          </div>
        )}

        <div className="live-chat-list" ref={listRef}>
          {chat.length === 0 && <p className="live-chat-empty">No messages yet — say hi! 👋</p>}
          {chat.map((m) => (
            <div key={m.id} className={`live-msg ${isInstructor && (m.userRole === 'admin' || m.userRole === 'superadmin') ? 'live-msg-instructor' : ''}`}>
              <div className="live-msg-meta">
                <span className="live-msg-name">
                  {m.userName}
                  {(m.userRole === 'admin' || m.userRole === 'superadmin') && <span className="live-msg-host"> HOST</span>}
                </span>
                <span className="live-msg-time">{formatTime(m.createdAt)}</span>
              </div>
              <div className="live-msg-body">{m.message}</div>
            </div>
          ))}
        </div>

        {permissions.canSendChat && (
          <form onSubmit={sendMessage} className="live-chat-form">
            <input
              className="live-chat-input"
              placeholder="Type a message…"
              value={text}
              disabled={sending}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="live-chat-send" disabled={sending || !text.trim()}>
              ➤
            </button>
          </form>
        )}
        </>
      )}
      </div>
    </div>
  );
}