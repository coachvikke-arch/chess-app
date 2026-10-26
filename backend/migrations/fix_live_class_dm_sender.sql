-- Live-class student → coach DMs were inserted without sender_id.
--
-- The socket handler wrote only (live_class_id, user_id, recipient_id, ...), but
-- every read path in chatController identifies the author by sender_id:
--   * getThread       JOIN users u ON u.id = m.sender_id        → NULL drops the row
--   * listConversations conv_other = CASE WHEN sender_id = me ... → NULL, then
--                                        JOIN users other        drops the thread
-- So a DM written from the classroom was invisible in the Messages page even
-- though the row existed. Backfill from user_id, which is the student who wrote
-- it (for class-scoped rows user_id IS the author; see add_chat_dm_columns.sql).

UPDATE chat_messages
   SET sender_id = user_id
 WHERE is_private IS TRUE
   AND sender_id IS NULL
   AND user_id IS NOT NULL;