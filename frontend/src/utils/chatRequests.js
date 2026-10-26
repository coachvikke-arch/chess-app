import api from '../services/api';
import { formatTime12 } from './time';

/* REST client for coach-approved chat requests.
 *
 * Separate from utils/chat.js on purpose: the messenger is feature-gated per
 * role and /chat-requests is not, because a coach whose messaging switch is off
 * still has to be able to approve requests. Keeping the two clients apart stops
 * that distinction from being quietly lost.
 *
 * Every call returns the body only (data), matching the chat.js convention.
 */

/** The one call the Message button makes. Returns the whole state machine. */
export async function getEligibility(targetUserId) {
  return (await api.get('/chat-requests/eligibility', {
    params: { targetUserId },
    cache: false,
  })).data;
}

/** Create a pending request. Throws on 409 (already pending) / 403 (cooldown). */
export async function sendChatRequest(targetUserId) {
  return (await api.post('/chat-requests', { targetUserId })).data;
}

/** Requests I sent or received, newest first. */
export async function listMyChatRequests() {
  return (await api.get('/chat-requests/mine', { cache: false })).data;
}

/** The shared decision panel's queue: both students' coaches plus Super Admin. */
export async function listChatRequestInbox(status) {
  return (await api.get('/chat-requests/inbox', {
    params: status ? { status } : {},
    cache: false,
  })).data;
}

/** Super Admin: every request, with optional status filter and search. */
export async function listAllChatRequests({ status, q } = {}) {
  return (await api.get('/chat-requests/admin/all', {
    params: {
      ...(status && status !== 'all' ? { status } : {}),
      ...(q ? { q } : {}),
    },
    cache: false,
  })).data;
}

/** One request plus the full history for that pair. */
export async function getChatRequest(id) {
  return (await api.get(`/chat-requests/${id}`, { cache: false })).data;
}

export async function approveChatRequest(id) {
  return (await api.post(`/chat-requests/${id}/approve`)).data;
}

export async function rejectChatRequest(id) {
  return (await api.post(`/chat-requests/${id}/reject`)).data;
}

/**
 * Cancel a chat request. `reason` is optional and is recorded on the request,
 * shown on the detail page and kept in the audit log.
 *
 * Works while the request is PENDING and while it is APPROVED - cancelling an
 * approved chat is what stops an existing conversation, so this endpoint is not
 * limited to withdrawing an unanswered request.
 *
 * Throws 403 when the caller may not cancel this chat and 409 when it has
 * already been decided.
 */
export async function cancelChatRequest(id, reason) {
  const trimmed = String(reason || '').trim();
  return (await api.post(`/chat-requests/${id}/cancel`, {
    ...(trimmed ? { reason: trimmed } : {}),
  })).data;
}

/* ── Shared presentation helpers ──
 * Kept here rather than in each component so the coach queue, the admin list
 * and the Message button can never disagree about what a status looks like. */

export const CHAT_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

/** Tailwind classes per status, using the app's existing badge vocabulary. */
export const STATUS_BADGE_CLASS = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-300 border-red-500/30',
  cancelled: 'bg-white/5 text-ivory-400 border-ivory-700/50',
};

/** Human label for a status badge. */
export function statusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return 'Pending';
  if (s === 'approved') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  if (s === 'cancelled') return 'Cancelled';
  return s || 'Unknown';
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' + formatTime12(d);
}

/**
 * The copy shown in the "Chat Request Required" panel and its confirm button.
 * Returns null when no request is needed or one is already approved, which is
 * the signal to render a plain Message button instead.
 */
/* Phrased without a coach count on purpose: a student can have several coaches
 * and the copy below must read correctly for one and for many. */
export function requestPromptCopy(state) {
  if (state === 'approved' || state === 'not_required') return null;
  if (state === 'pending') {
    return {
      title: 'Chat Request Pending',
      body: 'Chat request pending. Your coach has been notified and you will be able to message this user once approval comes through.',
      action: null,
    };
  }
  /* A cancelled chat is not a refusal on the merits, so there is no cooldown and
   * no "not approved" language: the chat existed and was stopped, and a fresh
   * request is available immediately. */
  if (state === 'cancelled') {
    return {
      title: 'Chat Cancelled',
      body: 'This chat was cancelled. You can send a new chat request if you still want to talk.',
      action: 'Send Chat Request',
    };
  }
  if (state === 'rejected') {
    return {
      title: 'Chat Request Required',
      body: 'Your chat request was not approved by the coach.',
      action: 'Send Chat Request',
    };
  }
  return {
    title: 'Chat Request Required',
    body: 'You need coach approval before you can start chatting with this user.',
    action: 'Send Chat Request',
  };
}