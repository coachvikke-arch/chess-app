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

/** What a blocked coach/learner row is waiting on, in the one line the tap's toast
 *  gets. Only a LEARNER ever sees this: the server gives a coach `canMessage` for
 *  their own student from the first keystroke, so a coach's row is never blocked and
 *  a coach's view of an ask is the Requests panel's business, not a row's. */
export function adminChannelRowCopy(state, peerName) {
  const name = peerName || 'your coach';
  switch (state) {
    case 'pending':
      return 'Request sent. Waiting for your coach to answer.';
    case 'cancelled':
      return 'This request was cancelled. You can ask again.';
    case 'not_allocated':
      return 'This coach is not allocated to you.';
    default:
      return `Use "Request chat" to ask ${name} to open a chat.`;
  }
}
