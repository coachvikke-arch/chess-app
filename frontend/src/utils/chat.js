import api from '../services/api';

/* REST client for the 1:1 messenger. Every call returns the body only
 * (data) — mirroring online.js so the drawer can `.then(...)` directly. */

/* The People list is a permission surface: which rows appear, and whether each
   one says "Message" or "Request chat", is computed server-side from the request
   row that a socket push may have just changed. A 30s cache would serve a stale
   verdict, so this read opts out (api.js only invalidates the same path segment
   on writes, and request decisions are posted under /chat-admin-requests). */
export async function listContacts(q = '') {
  const params = q ? { q } : {};
  return (await api.get('/chat/users', { params, cache: false })).data;
}

export async function listConversations() {
  return (await api.get('/chat/conversations', { cache: false })).data;
}

export async function getThread(otherId, before) {
  const params = before ? { before } : {};
  return (await api.get(`/chat/conversations/${otherId}/messages`, { params })).data;
}

/* text and/or file — at least one required. Uses FormData so the attachment
   uploads as multipart (same as the /uploads docs flow). */
export async function sendDirectMessage(otherId, { text, file }) {
  const fd = new FormData();
  if (text) fd.append('text', text);
  if (file) fd.append('file', file);
  return (await api.post(`/chat/conversations/${otherId}/messages`, fd)).data;
}

export async function markRead(otherId) {
  return (await api.post(`/chat/conversations/${otherId}/read`)).data;
}

/* Toggle an emoji reaction on a message. `scope` is 'dm' or 'group' and
   decides which message namespace `messageId` belongs to. Returns the
   message's full reaction list. */
export async function toggleReaction(scope, messageId, emoji) {
  return (await api.post('/chat/reactions', { scope, messageId, emoji })).data;
}

/* Delete a message, WhatsApp-style.
 *   mode 'everyone' — remove it for everybody (author only; group admins too).
 *   mode 'me'       — hide it from my own view only, leaving the row intact.
 * `scope` is 'dm' or 'group' and decides which id namespace messageId is in. */
export async function deleteMessage(scope, messageId, mode) {
  return (await api.delete(`/chat/messages/${messageId}`, { data: { scope, mode } })).data;
}

/* ── Group chat (admin-created rooms, 1:many, attachments) ── */

export async function listGroups() {
  return (await api.get('/chat/groups', { cache: false })).data;
}

export async function createGroup(name, memberIds) {
  return (await api.post('/chat/groups', { name, memberIds })).data;
}

export async function getGroup(groupId) {
  return (await api.get(`/chat/groups/${groupId}`)).data;
}

export async function getGroupMessages(groupId, before) {
  const params = before ? { before } : {};
  return (await api.get(`/chat/groups/${groupId}/messages`, { params })).data;
}

/* text and/or file — at least one required. Uses FormData so the attachment
   uploads as multipart (same as the /uploads docs flow). */
export async function sendGroupMessage(groupId, { text, file }) {
  const fd = new FormData();
  if (text) fd.append('text', text);
  if (file) fd.append('file', file);
  return (await api.post(`/chat/groups/${groupId}/messages`, fd)).data;
}

export async function markGroupRead(groupId) {
  return (await api.post(`/chat/groups/${groupId}/read`)).data;
}

export async function addGroupMembers(groupId, memberIds) {
  return (await api.post(`/chat/groups/${groupId}/members`, { memberIds })).data;
}

export async function removeGroupMember(groupId, userId) {
  return (await api.delete(`/chat/groups/${groupId}/members/${userId}`)).data;
}

export async function updateGroupAvatar(groupId, file) {
  const fd = new FormData();
  fd.append('file', file);
  return (await api.post(`/chat/groups/${groupId}/avatar`, fd)).data;
}

/* Admin-only. The server cascades the messages and the memberships, and pushes
   `chat_group_deleted` to every member, so nobody keeps a dead room in the list. */
export async function deleteGroup(groupId) {
  return (await api.delete(`/chat/groups/${groupId}`)).data;
}
