import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import api from '../services/api';
import { getSocket, on, emit } from '../services/socket';
import {
  listContacts,
  listConversations,
  getThread,
  sendDirectMessage,
  markRead,
  toggleReaction as toggleReactionApi,
  deleteMessage as deleteMessageApi,
  listGroups,
  getGroup,
  getGroupMessages,
  sendGroupMessage,
  markGroupRead,
  deleteGroup as deleteGroupApi,
} from '../utils/chat';
import { listChatRequestInbox } from '../utils/chatRequests';

const ChatContext = createContext(null);
const WS = {};

export function ChatProvider({ children }) {
  const { user } = useAuth();
  const meId = user?.id ? Number(user.id) : null;

const [conversations, setConversations] = useState([]);
  const [presence, setPresence] = useState({});           // userId -> true/false
  const [unreadByThread, setUnreadByThread] = useState({}); // otherId -> count
  const [drawerOpen, setDrawerOpen] = useState(false);      // floating inbox
  const [threadFor, setThreadFor] = useState(null);          // otherId of open thread
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [contacts, setContacts] = useState([]);
  const [busy, setBusy] = useState(false);

  /* Chats that were cancelled while this session was live, keyed by the OTHER
     user id: { otherId, cancelledBy, cancelledAt, reason, requestId }.
     Populated from the server's `chat_cancelled` push so an open thread flips to
     read-only instantly instead of after a reload. Not persisted on purpose - on
     a fresh load the cancelled thread is simply gone from the inbox, and the bell
     entry is the durable record. */
  const [cancelledChats, setCancelledChats] = useState({});

  /* Group rooms: admin-created, 1:many, attachments. Kept beside the DM state
     so the sidebar unread badge and the flag surfaces stay in one place. */
  const [groups, setGroups] = useState([]);                 // my groups (summaries)
  const [groupUnreadByGroup, setGroupUnreadByGroup] = useState({}); // groupId -> count
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [groupMessages, setGroupMessages] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeGroupMembers, setActiveGroupMembers] = useState([]);

  const meKey = `user:${meId}`;
  const unreadTotal =
    Object.values(unreadByThread).reduce((n, c) => n + c, 0) +
    Object.values(groupUnreadByGroup).reduce((n, c) => n + c, 0);

  /* Pending chat requests awaiting this staff member's decision — the count
     behind the Chat Requests sidebar badge. Staff-only endpoint (students get
     403), so non-staff never ask and simply read zero. */
  const isStaff = user?.role === 'admin' || user?.role === 'superadmin';
  const [pendingRequests, setPendingRequests] = useState(0);
  const refreshRequestBadge = async () => {
    if (!isStaff) { setPendingRequests(0); return; }
    try {
      const d = await listChatRequestInbox('pending');
      const rows = d?.requests || [];
      setPendingRequests(rows.length);
    } catch { /* students 403 here; badge just stays empty */ }
  };

  /* ---------------- load on mount / login ---------------- */
  useEffect(() => {
    if (!meId) { setConversations([]); setPresence({}); setPendingRequests(0); return; }

let liveFresh = true;
    (async () => {
      try {
        const [cs, rr, gr] = await Promise.all([
          listConversations(),
          api.get('/chat/users', { params: { q: '' }, cache: false }),
          listGroups(),
        ]);
        if (!liveFresh) return;
        const convs = cs?.conversations || [];
        setConversations(convs);

        const unread = {};
        convs.forEach((c) => { if (c.unread) unread[Number(c.otherId)] = Number(c.unread); });
        setUnreadByThread(unread);

        const contacts = rr.data?.users || [];
        setContacts(contacts);

        const online = {};
        contacts.forEach((u) => { online[Number(u.id)] = !!u.online; });
        setPresence(online);

        const grps = gr?.groups || [];
        setGroups(grps);
        const gun = {};
        grps.forEach((g) => { if (g.unread) gun[Number(g.id)] = Number(g.unread); });
        setGroupUnreadByGroup((prev) => ({ ...prev, ...gun }));
      } catch (e) { console.warn('[chat:load]', e.message); }
    })();

    refreshRequestBadge();

    const poll = setInterval(() => {
      refreshRequestBadge();
      listConversations().then((d) => {
        const convs = d?.conversations || [];
        setConversations(convs);
        const unread = {};
        convs.forEach((c) => { if (c.unread) unread[Number(c.otherId)] = Number(c.unread); });
        setUnreadByThread(unread);
      }).catch(() => {});
      listGroups().then((d) => {
        const grps = d?.groups || [];
        setGroups(grps);
        const gun = {};
        grps.forEach((g) => { if (g.unread) gun[Number(g.id)] = Number(g.unread); });
        setGroupUnreadByGroup((prev) => ({ ...prev, ...gun }));
      }).catch(() => {});
      /* The directory carries each row's permission (canMessage, chatState), and
         those verdicts move server-side — a coach answers, a chat is closed, the
         owner opens one by writing first. The socket pushes cover a connected
         client, but this is what makes the People list honest again after a drop,
         a backgrounded tab, or a missed event. Read with the live query so a search
         in progress is not reset. */
      listContacts(searchQueryRef.current).then((d) => setContacts(d?.users || [])).catch(() => {});
    }, 15_000);

    return () => { liveFresh = false; clearInterval(poll); };
  }, [meId]);

  /* ------------------ realtime presence + DM ------------------ */
  useEffect(() => {
    if (!meId) return undefined;
    const offPresence = on('presence:changed', (payload) => {
      const uid = Number(payload?.userId ?? payload?.id);
      if (uid) setPresence((p) => ({ ...p, [uid]: !!payload?.online }));
    });
    const offDm = on('chat_dm', (payload) => {
      const msg = payload?.message;
      if (!msg) return;
      const otherId = Number(msg.sender_id === meId ? msg.recipient_id : msg.sender_id);
      if (threadForRef.current === otherId) {
        setMessages((m) => [...m, msg]);
        markRead(otherId).catch(() => {});
      } else {
        setUnreadByThread((u) => ({ ...u, [otherId]: (u[otherId] || 0) + 1 }));
        refreshConversations();
      }
    });
const offUnread = on('chat_unread_changed', (payload) => {
      const oid = Number(payload?.otherId);
      const unread = Number(payload?.unread ?? 0);
      if (oid) setUnreadByThread((u) => ({ ...u, [oid]: unread }));
    });

    /* ── group chat realtime ── */
    const offGroupMsg = on('chat_group_message', (payload) => {
      const msg = payload?.message;
      if (!msg) return;
      const gid = Number(msg.group_id);
      if (activeGroupIdRef.current === gid) {
        /* id-gated: the same row can arrive via echo + refresh, never twice. */
        setGroupMessages((m) =>
          m.some((x) => Number(x.id) === Number(msg.id)) ? m : [...m, msg]
        );
        markGroupRead(gid).catch(() => {});
      } else {
        setGroupUnreadByGroup((u) => ({ ...u, [gid]: (u[gid] || 0) + 1 }));
        refreshGroups();
      }
    });
    const offGroupUnread = on('chat_group_unread_changed', (payload) => {
      const gid = Number(payload?.groupId);
      const unread = Number(payload?.unread ?? 0);
      if (gid) setGroupUnreadByGroup((u) => ({ ...u, [gid]: unread }));
    });
    const offGroupAdded = on('chat_group_added', () => refreshGroups());
    const offGroupRemoved = on('chat_group_removed', () => refreshGroups());
    const offGroupUpdated = on('chat_group_updated', () => refreshGroups());
    /* The room no longer exists — the server has already erased its messages and
       memberships. The list must stop offering it, and if it was on screen the
       pane falls back to the empty chat state rather than an empty room. */
    const offGroupDeleted = on('chat_group_deleted', (payload) => dropGroup(payload?.group?.id));
    const offReaction = on('chat_reaction', (payload) => {
      const scope = payload?.scope === 'group' ? 'group' : 'dm';
      const mid = Number(payload?.messageId);
      if (!mid) return;
      const reactions = payload.reactions || [];
      if (scope === 'group') {
        setGroupMessages((m) => m.map((x) => (Number(x.id) === mid ? { ...x, reactions } : x)));
      } else {
        setMessages((m) => m.map((x) => (Number(x.id) === mid ? { ...x, reactions } : x)));
      }
    });

    /* A message was deleted. For mode 'everyone' the row is gone for all of
     * us, so drop it from whichever list it's in; for mode 'me' the server only
     * echoes back to the user who hid it (their other tabs). The payload's
     * scope is authoritative, so a deletion in a room you aren't viewing is a
     * harmless no-op. */
    const offDeleted = on('chat_message_deleted', (payload) => {
      const scope = payload?.scope === 'group' ? 'group' : 'dm';
      const mid = Number(payload?.messageId);
      if (!mid) return;
      const drop = (m) => m.filter((x) => Number(x.id) !== mid);
      if (scope === 'group') setGroupMessages(drop);
      else setMessages(drop);
    });

    /* A new chat request arrives as a plain notification to every panel member:
       refresh the sidebar count at once instead of waiting for the poll. */
    const offRequestBell = on('notification', () => { refreshRequestBadge(); });

    /* A chat was cancelled. Three things have to happen at once, and none of
       them can wait for a poll:
         - remember the cancellation, so an OPEN thread renders read-only with
           "This chat was cancelled" and no composer
         - drop the thread from the inbox, because the server will no longer list it
         - re-read the contacts, so the People row stops offering "Message"
       The notifications were already pushed separately by the cancel endpoint, so
       this deliberately does NOT raise the bell again. */
    const offCancelled = on('chat_cancelled', (payload) => {
      const otherId = Number(payload?.otherId);
      if (!otherId) return;
      setCancelledChats((prev) => ({ ...prev, [otherId]: { ...payload, otherId } }));
      setConversations((list) => (list || []).filter((c) => Number(c.otherId) !== otherId));
      setUnreadByThread((u) => { const next = { ...u }; delete next[otherId]; return next; });
      searchContacts(searchQueryRef.current);
    });

    /* A coach/learner request changed state — sent, accepted or cancelled. The
       server pushes it to BOTH sides with each side's own `otherId`, so neither
       waits for the 15s poll: the student's row goes Request chat → Request
       pending → Message as the coach answers, and the coach's Accept/Cancel pair
       disappears once used.
       The contacts and the inbox are simply re-read rather than patched by hand:
       the directory is a server-side rule, so a client that recomputes it would be
       free to be wrong. Cancelling an OPEN chat also sends `chat_cancelled` above,
       which is what flips a live thread to read-only - this event does not have to
       duplicate that. */
    const offAdminRequest = on('admin_chat_request', () => {
      searchContacts(searchQueryRef.current);
      refreshConversations();
    });

    /* The same for a classmate pairing, which lives on the peer queue rather than
       on the coach/learner table. One push per transition, to the asker, the asked
       and the coaches on the panel, so:
         - the asker's row moves Request chat → Request sent without the 15s poll
         - the asked learner's row and the coach's Requests list move the same way
         - an approved pair gets a live thread from both ends at once
       The contacts and the inbox are re-read instead of patched, because which row
       is decided is the server's rule, not something the client should recompute. */
    const offPeerRequest = on('chat_request', () => {
      searchContacts(searchQueryRef.current);
      refreshConversations();
    });

    return () => { offPresence?.(); offDm?.(); offUnread?.(); offGroupMsg?.(); offGroupUnread?.(); offGroupAdded?.(); offGroupRemoved?.(); offGroupUpdated?.(); offGroupDeleted?.(); offReaction?.(); offDeleted?.(); offRequestBell?.(); offCancelled?.(); offAdminRequest?.(); offPeerRequest?.(); };
  }, [meId]); // threadFor read via ref-free effect dependency handled below

  const threadForRef = useRef(threadFor);
  useEffect(() => { threadForRef.current = threadFor; }, [threadFor]);
  const activeGroupIdRef = useRef(activeGroupId);
  useEffect(() => { activeGroupIdRef.current = activeGroupId; }, [activeGroupId]);
  const searchQueryRef = useRef(searchQuery);
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  async function refreshConversations() { listConversations().then((d) => setConversations(d?.conversations || [])).catch(() => {}); }
  async function refreshGroups() { listGroups().then((d) => setGroups(d?.groups || [])).catch(() => {}); }

  /* Take one room out of every piece of state that could still name it: the
     list row, its unread count and, if it was the open room, the thread pane —
     which then falls back to the "pick a conversation" empty state. Called by
     the `chat_group_deleted` push (every connected member) and by the delete
     action below. */
  function dropGroup(groupId) {
    const gid = Number(groupId);
    if (!gid) return;
    setGroups((list) => list.filter((g) => Number(g.id) !== gid));
    setGroupUnreadByGroup((u) => {
      if (!(gid in u)) return u;
      const next = { ...u };
      delete next[gid];
      return next;
    });
    if (activeGroupIdRef.current === gid) closeGroup();
  }

  /* ---------------- actions ---------------- */
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => { setDrawerOpen(false); setThreadFor(null); setMessages([]); }, []);
  const closeThread = useCallback(() => { setThreadFor(null); setMessages([]); }, []);

  /* The thread endpoint returns `ORDER BY created_at DESC` (newest first) so
     that `?before=` pagination can slice the newest N. That order is right for
     paging but WRONG for display: the drawer rendered it verbatim, so a thread
     read newest→oldest top-to-bottom — the "upside down" symptom.
     Everything else in this file already assumes ASC: both live-append paths
     (`chat_dm` and `send`) do `[...m, msg]`, which only lands the new message at
     the bottom on an ascending list. Sorting on load fixes all three at once and
     leaves the API's paging order untouched. */
  const oldestFirst = (list) => [...(list || [])].sort(
    (a, b) => new Date(a?.created_at || 0) - new Date(b?.created_at || 0)
  );

const openThread = useCallback(async (otherId) => {
    setActiveGroupId(null); setActiveGroup(null); setActiveGroupMembers([]); setGroupMessages([]);
    setThreadFor(Number(otherId));
    setBusy(true);
    try {
      const d = await getThread(otherId);
      setMessages(oldestFirst(d?.messages));
      setUnreadByThread((u) => ({ ...u, [Number(otherId)]: 0 }));
      markRead(otherId).catch(() => {});
    } catch (e) {
      setMessages([]);
      setThreadFor(null);
      /* Rejected on purpose. The People list is a snapshot of the server's verdict
         and that verdict can move between the load and the tap — a request withdrawn,
         an allocation changed, a chat the owner closed. The page owns what a refusal
         means (a 403 drops the pair into its request flow, anything else into an
         error toast); swallowing it here leaves the thread open on an empty list with
         nothing said, which reads as a row that does not work. The pane is closed for
         the same reason: an empty thread you never agreed to open is not a state a
         user can get out of. */
      throw e;
    }
    finally { setBusy(false); }
  }, []);

  /* Open a group room: clears the open DM thread and marks the room read. */
  const openGroup = useCallback(async (groupId) => {
    const gid = Number(groupId);
    if (!gid) return;
    setThreadFor(null); setMessages([]);
    setActiveGroupId(gid);
    setBusy(true);
    try {
      const [gData, d] = await Promise.all([getGroup(gid), getGroupMessages(gid)]);
      setActiveGroup(gData?.group || null);
      setActiveGroupMembers(gData?.members || []);
      setGroupMessages(oldestFirst(d?.messages));
      setGroupUnreadByGroup((u) => ({ ...u, [gid]: 0 }));
      markGroupRead(gid).catch(() => {});
    } catch (e) { console.warn('[chat:openGroup]', e.message); setGroupMessages([]); }
    finally { setBusy(false); }
  }, []);

  const closeGroup = useCallback(() => {
    setActiveGroupId(null); setActiveGroup(null); setActiveGroupMembers([]); setGroupMessages([]);
  }, []);

  /* Admin-only room deletion. `dropGroup` runs here as well as on the
     `chat_group_deleted` push because the push only reaches members who are
     connected at that moment — the deleting admin must never be left with a row
     that 404s when opened. Dropping twice is harmless. */
  const deleteGroupRoom = useCallback(async (groupId) => {
    await deleteGroupApi(groupId);
    dropGroup(groupId);
  }, []);

  /* Toggle an emoji reaction on a message. The server returns the message's
   * full reaction list, so we just stamp it onto the matching row (the same
   * list the socket `chat_reaction` handler patches for everyone else). */
  const react = useCallback(async (scope, messageId, emoji) => {
    const d = await toggleReactionApi(scope, Number(messageId), emoji);
    const reactions = d?.reactions || [];
    if (scope === 'group') {
      setGroupMessages((m) => m.map((x) => (Number(x.id) === Number(messageId) ? { ...x, reactions } : x)));
    } else {
      setMessages((m) => m.map((x) => (Number(x.id) === Number(messageId) ? { ...x, reactions } : x)));
    }
  }, []);

  /* Delete a message, WhatsApp-style. `mode` is 'everyone' (gone for all
   * participants) or 'me' (a tombstone hidden from my own view only). The row
   * is dropped from the matching list right away — the server's socket echo
   * does the same for everybody else, so this is purely the local reaction. */
  const deleteMessage = useCallback(async (scope, messageId, mode) => {
    await deleteMessageApi(scope, Number(messageId), mode);
    const mid = Number(messageId);
    const drop = (m) => m.filter((x) => Number(x.id) !== mid);
    if (scope === 'group') setGroupMessages(drop);
    else setMessages(drop);
    /* The inbox/room previews are built from the newest surviving row, so a
     * delete that was the last activity changes what the list should show. */
    if (scope === 'group') refreshGroups();
    else refreshConversations();
  }, []);

  const sendToGroup = useCallback(async (groupId, payload) => {
    const row = await sendGroupMessage(groupId, payload);
    if (Number(row?.message?.group_id) === activeGroupIdRef.current) {
      setGroupMessages((m) =>
        m.some((x) => Number(x.id) === Number(row.message.id)) ? m : [...m, row.message]
      );
    }
    refreshGroups();
  }, []);

const send = useCallback(async (otherId, text, file) => {
    const t = String(text || '').trim();
    if (!t && !file) return;
    const row = await sendDirectMessage(otherId, { text: t, file: file || undefined });
    if (Number(row?.message?.recipient_id) === threadForRef.current || Number(row?.message?.sender_id) === otherId) {
      setMessages((m) =>
        m.some((x) => Number(x.id) === Number(row.message.id)) ? m : [...m, row.message]
      );
    }
    refreshConversations();
  }, [meId]);

  const searchContacts = useCallback(async (q) => {
    setSearchQuery(q);
    try {
      const d = await listContacts(q);
      setContacts(d?.users || []);
    } catch (e) { console.warn('[chat:search]', e.message); }
  }, []);

  const isOnline = useCallback((uid) => !!presence[Number(uid)], [presence]);

const value = useMemo(() => ({
    meId, conversations, presence, unreadByThread, unreadTotal, pendingRequests, refreshRequestBadge,
    drawerOpen, threadFor, messages, contacts, searchQuery, busy, cancelledChats,
    groups, groupUnreadByGroup, activeGroupId, groupMessages, activeGroup, activeGroupMembers,
    openDrawer, closeDrawer, closeThread, openThread, send, searchContacts, isOnline,
    openGroup, closeGroup, sendToGroup, react, deleteMessage, deleteGroupRoom,
  }), [meId, conversations, presence, unreadByThread, unreadTotal, pendingRequests, drawerOpen,
      threadFor, messages, contacts, searchQuery, busy, cancelledChats,
      groups, groupUnreadByGroup, activeGroupId, groupMessages, activeGroup, activeGroupMembers,
      openDrawer, closeDrawer, closeThread,
      openThread, send, searchContacts, isOnline, openGroup, closeGroup, sendToGroup, react, deleteMessage, deleteGroupRoom]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
