/**
 * Migration: Add target_student_user_id to chat_admin_requests for student-to-student requests.
 *
 * New column: target_student_user_id (nullable)
 *   - NULL when the request is student->admin
 *   - The target student user id when the request is student->student
 *
 * The unique index now includes target_student_user_id so that:
 *   - (student A, admin X) is one request
 *   - (student B, admin X) is another request
 *   - (student A, admin X, student B) is a different request from (student A, admin X, student C)
 */

exports.up = async function(knex) {
  // Add the new column
  await knex.schema.alterTable('chat_admin_requests', (table) => {
    table.integer('target_student_user_id').references('users.id').onDelete('SET NULL');
  });

  // Update the unique index to include target_student_user_id
  await knex.schema.alterTable('chat_admin_requests', (table) => {
    // Drop old index if exists, create new one
    // Note: PostgreSQL doesn't support IF EXISTS / IF NOT EXISTS alter, so we handle via raw
  });

  // Re-create the unique index with the new column
  await knex.raw(`
    DROP INDEX IF EXISTS uq_chat_admin_requests_one_active ON chat_admin_requests;
    CREATE UNIQUE INDEX uq_chat_admin_requests_one_active
      ON chat_admin_requests (student_user_id, admin_user_id, target_student_user_id)
      WHERE status IN ('pending', 'accepted');
  `);
};

/**
 * Downgrade: remove the target_student_user_id column and revert index
 */
exports.down = async function(knex) {
  // Drop the unique index
  await knex.raw(`
    DROP INDEX IF EXISTS uq_chat_admin_requests_one_active ON chat_admin_requests;
  `);

  // Re-create the original index
  await knex.raw(`
    CREATE UNIQUE INDEX uq_chat_admin_requests_one_active
      ON chat_admin_requests (student_user_id, admin_user_id)
      WHERE status IN ('pending', 'accepted');
  `);

  // Remove the column
  await knex.schema.alterTable('chat_admin_requests', (table) => {
    table.dropColumn('target_student_user_id');
  });
};