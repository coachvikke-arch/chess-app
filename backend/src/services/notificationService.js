const db = require('../config/database');

/* Push a socket event to one user's room, exactly like the online controller does. */
function emitToUser(io, userId, event, data) {
  if (!io || userId == null) return;
  io.to(`user:${userId}`).emit(event, data);
}

/* Insert a notification row. Fails softly so a notification problem can never
 * break gameplay or other unrelated flows. */
async function create({ userId, title, message, type = null, senderId = null, relatedId = null, requestStatus = null }) {
  try {
    const result = await db.query(
      `INSERT INTO notifications (user_id, title, message, type, sender_id, related_id, request_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, title, message, type, senderId, relatedId, requestStatus]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.warn('Failed to create notification:', err.message);
    return null;
  }
}

/* Create a notification and instantly push it over the socket to that user so
 * their bell badge updates in real time (no 30s polling wait). */
async function push(io, userId, title, message, extra = {}) {
  const row = await create({ userId, title, message, ...extra });
  if (row) emitToUser(io, userId, 'notification', row);
  return row;
}

/* Update all request notification rows tied to a related id, optionally
   * scoped to a single user_id. Returns the updated rows so callers can re-push
   * them over the socket (keeps open tabs/other deviles in sync).
   *
   * `type` exists because this started out match-request-only and is now also
   * used by coach-approved chat requests. It defaults to 'match_request' so the
   * existing online-controller call sites keep their exact behaviour. */
  async function setRequestStatus({ relatedId, userId = null, requestStatus, message = null, isRead = null, type = 'match_request' }) {
    try {
      // type is a WHERE parameter only - it identifies the notification family,
      // it is never rewritten.
      const sets = ['request_status = $3'];
      const params = [relatedId, type, requestStatus];
      if (message !== null) {
        params.push(message);
        sets.push(`message = $${params.length}`);
      }
      if (isRead !== null) {
        params.push(isRead);
        sets.push(`is_read = $${params.length}`);
      }
      const values = [...params];
      let where = "type = $2 AND related_id = $1";
      if (userId != null) {
        values.push(userId);
        where += ` AND user_id = $${values.length}`;
      }
      const result = await db.query(
        `UPDATE notifications SET ${sets.join(', ')} WHERE ${where} RETURNING *`,
        values
      );
      return result.rows;
    } catch (err) {
      console.warn('Failed to update request notification:', err.message);
      return [];
    }
  }

module.exports = { create, push, setRequestStatus, emitToUser };