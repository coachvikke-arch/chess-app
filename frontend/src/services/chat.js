import api from './api';

/* Clean initiator of the message inbox. Returns the API-backed conversation
 * header (otherName, otherOnline, unread, lastMessage...) so the drawer can
 * render instantly without a second round-trip. */

export async function listConversations() {
  return (await api.get('/chat/conversations')).data;
}

export async function listChatUsers(q = '') {
  const params = q ? { q } : {};
  return (await api.get('/chat/users', { params })).data;
}

export async function getThread(otherId, before) {
  return (await api.get(`/chat/conversations/${otherId}/messages`, { params: before ? { before } : {} })).data;
}

export async function sendDirectMessage(otherId, message) {
  return (await api.post(`/chat/conversations/${otherId}/messages`, { message })).data;
}

export async function markThreadRead(otherId) {
  return (await api.post(`/chat/conversations/${otherId}/read`)).data;
}
