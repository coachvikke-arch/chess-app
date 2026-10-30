import api from '../services/api';

/* REST client for the coach/learner chat channel.
 *
 * Separate from utils/chatRequests.js because they are two different rules with
 * two different deciders: chatRequests is the peer queue, where BOTH students'
 * coaches and the owner sit on a panel and may approve or reject. This one has a
 * single decider - the specific coach the student was allocated to - and only
 * Accept and Cancel. Keeping the clients apart is what stops a future edit from
 * accidentally pointing a student's coach request at the peer panel.
 */

/** Ask one allocated coach for permission to chat. 409 when one is already open. */
export async function sendAdminChatRequest(adminId) {
  return (await api.post('/chat-admin-requests', { adminId })).data;
}

/** The coach's own answer. Only the coach this request was sent to can post it. */
export async function acceptAdminChatRequest(requestId) {
  return (await api.post(`/chat-admin-requests/${requestId}/accept`)).data;
}

/** Withdraw a pending ask, or close a chat that was already accepted. */
export async function cancelAdminChatRequest(requestId) {
  return (await api.post(`/chat-admin-requests/${requestId}/cancel`)).data;
}

/** Every request I am a party to, either as the student or as the coach. */
export async function listMyAdminChatRequests(status) {
  return (await api.get('/chat-admin-requests', {
    params: status ? { status } : {},
    cache: false,
  })).data;
}

/* ── Presentation ──
 * The row states come from the server (contact.chatState), so nothing here
 * re-derives a permission from a role string. The one exception is
 * isAdminChannelPair below, which only picks WHICH row style to render and is a
 * deliberate mirror of the server-side helper of the same name. */

/**
 * True for the coach/learner channel: exactly one side is a student and neither
 * side is the owner. Mirrors isAdminChannelPair in the backend controller.
 *
 * A missing peerRole (a stale deep link, a notification row) is NOT treated as a
 * coach pair - without a role the honest answer is "not this channel", and the
 * peer control it falls back to still refuses to send when the server disagrees.
 */
export function isAdminChannelPair(callerRole, peerRole) {
  if (!peerRole) return false;
  if (callerRole === 'superadmin' || peerRole === 'superadmin') return false;
  return (callerRole === 'student') !== (peerRole === 'student');
}

/** The short label shown in the People row chip for this channel.
 *
 * `asCoach` is the VIEWER, not a permission: the pair has one server-decided state,
 * but a coach reading "Request" on a student who has never asked learns nothing,
 * and a student reading it knows exactly which button to press. */
export function adminChannelStatusLabel(state, asCoach = false) {
  if (state === 'accepted') return 'Open';
  if (state === 'pending') return asCoach ? 'Their request' : 'Pending';
  if (state === 'cancelled') return 'Cancelled';
  if (state === 'not_allocated') return asCoach ? 'Not your student' : 'Not your coach';
  return asCoach ? 'No request' : 'Request';
}

/** The one-line explanation under a row's name for this channel. */
export function adminChannelRowCopy(state, peerName, asCoach = false) {
  const name = peerName || 'this coach';
  switch (state) {
    case 'accepted':
      return 'You can message each other';
    case 'pending':
      return asCoach ? `${name} wants to chat with you` : 'Request pending';
    case 'cancelled':
      return asCoach
        ? 'You closed this chat. They can ask again.'
        : 'Request cancelled - you can ask again';
    case 'not_allocated':
      return asCoach ? 'No longer allocated to you' : 'Not allocated to you';
    default:
      return asCoach
        ? `${name} has not asked to chat yet`
        : `Ask ${name} to open chat`;
  }
}
