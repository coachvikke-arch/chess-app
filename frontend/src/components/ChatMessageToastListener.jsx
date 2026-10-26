import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { on } from '../services/socket';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

/*
 * Global, always-mounted listener that toasts INCOMING chat messages.
 *
 * The backend pushes `chat_dm` (1:1) and `chat_group_message` (group) to
 * everyone who should see the message. ChatContext already uses those events to
 * append the row and bump the unread badge; this listener adds the "you've got
 * mail" moment, the same idea as ChatReactionListener but for new messages.
 *
 * Two rules keep it from being annoying:
 *   1. Never toast for a message you can already see — if that DM/group is the
 *      one currently open (in the full page or the global drawer), the row just
 *      appeared on screen and a toast would be noise.
 *   2. Collapse bursts — someone typing three messages in a row should produce
 *      ONE toast, not three, so a repeat while that card is still on screen
 *      rewrites it and appends a " (+N more)" counter.
 */

const MAX_PREVIEW = 120;

function preview(msg) {
  const text = String(msg?.message || '').trim();
  if (text) return text.length > MAX_PREVIEW ? text.slice(0, MAX_PREVIEW).trimEnd() + '…' : text;
  if (msg?.attachment) {
    if (String(msg.attachment_type || '').startsWith('image/')) return '🖼️ Sent a photo';
    return msg.attachment_name ? `📎 Sent ${msg.attachment_name}` : '📎 Sent a file';
  }
  return 'New message';
}

export default function ChatMessageToastListener() {
  const { showToast, updateToast, hasToast } = useToast();
  const { user } = useAuth();
  const chat = useChat();
  const navigate = useNavigate();
  const meId = Number(user?.id ?? 0);
  const isStudent = user?.role === 'student';
  const messagesPath = isStudent ? '/student/messages' : '/admin/messages';

  /* The socket callbacks are registered once, so they can't close over the
   * current thread/group/group-list. Mirror those values into a ref instead of
   * re-subscribing on every navigation or poll tick. */
  const stateRef = useRef({ threadFor: null, activeGroupId: null, groups: [] });
  stateRef.current = {
    threadFor: chat.threadFor,
    activeGroupId: chat.activeGroupId,
    groups: chat.groups || [],
  };

  /* Per-conversation burst state: the live toast id and how many messages it
   * already accounts for. */
  const live = useRef(new Map());

  useEffect(() => {
    /* Show or bump the toast for a conversation, honouring the cooldown. */
    const notify = (key, build) => {
      const entry = live.current.get(key);
      if (entry && hasToast(entry.id)) {
        /* Still on screen: rewrite it in place and say how many more came.
           The liveness check matters because the user may have dismissed it
           with ✕, in which case a fresh toast is the right move. */
        entry.extra += 1;
        entry.at = Date.now();
        updateToast(entry.id, {
          message: `${build.preview}  (+${entry.extra} more)`,
          title: build.title,
          tone: build.tone,
          duration: 6000,
        });
        return;
      }
      /* Either the first message, or the last toast for this conversation was
         dismissed/expired: make a new one. A message inside the cooldown of a
         toast that is GONE still gets one — silently dropping a real message is
         worse than showing it slightly late. */
      const id = showToast(build.preview, {
        tone: build.tone,
        title: build.title,
        duration: 6000,
        action: { label: build.actionLabel, onClick: build.onOpen },
      });
      live.current.set(key, { id, at: Date.now(), extra: 0 });
    };

    const open = () => stateRef.current;
    /* `threadFor` / `activeGroupId` are shared by the global drawer AND the full
       Messages page, so one non-null id means that conversation is on screen
       wherever the user happens to be looking — no toast needed. */
    const isOpenDm = (otherId) => Number(open().threadFor) === otherId;
    const isOpenGroup = (gid) => Number(open().activeGroupId) === gid;

    const offDm = on('chat_dm', (payload) => {
      const msg = payload?.message;
      if (!msg) return;
      const from = Number(msg.sender_id);
      if (!from || from === meId) return;                 /* my own message echo */
      const otherId = Number(msg.recipient_id === meId ? msg.sender_id : msg.recipient_id);
      if (isOpenDm(otherId)) return;                       /* already visible */
      const who = msg.sender_name || 'Someone';
      notify(`dm-${otherId}`, {
        preview: preview(msg),
        title: `💬 ${who}`,
        tone: 'info',
        actionLabel: 'Reply',
        onOpen: () => navigate(messagesPath, { state: { openUserId: otherId } }),
      });
    });

    const offGroup = on('chat_group_message', (payload) => {
      const msg = payload?.message;
      if (!msg) return;
      const from = Number(msg.sender_id);
      if (!from || from === meId) return;                 /* my own message */
      const gid = Number(msg.group_id);
      if (isOpenGroup(gid)) return;                        /* already visible */
      const who = msg.sender_name || 'Someone';
      /* Group name from the loaded list; fall back to a generic label if the
         room hasn't loaded (or the user just joined). */
      const room = open().groups.find((g) => Number(g.id) === gid);
      notify(`grp-${gid}`, {
        preview: `${who}: ${preview(msg)}`,
        title: `👥 ${room?.name || 'Group chat'}`,
        tone: 'info',
        actionLabel: 'Open',
        onOpen: () => navigate(messagesPath, { state: { openGroupId: gid } }),
      });
    });

    return () => { offDm?.(); offGroup?.(); live.current.clear(); };
  }, [showToast, updateToast, hasToast, meId, navigate, messagesPath]);

  return null;
}
