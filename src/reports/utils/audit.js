const pool = require('../../db');

const AuditStatus = {
  SUCCESS: 'SUCCESS',
  FAILED : 'FAILED',
};

/**
 * Non-silent audit logger
 * Logs to DB and falls back to stderr if DB insert fails
 */
async function auditLog(userId, action, resourceId, ip, ua, status = AuditStatus.SUCCESS, errorMessage = null) {
  const entry = {
    user_id      : userId,
    action,
    resource_type: 'project',
    resource_id  : resourceId,
    status,
    ip_address   : ip   || 'unknown',
    user_agent   : ua   || 'unknown',
    error_message: errorMessage,
  };

  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, resource_type, resource_id,
          status, ip_address, user_agent, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.user_id, entry.action, entry.resource_type,
        entry.resource_id, entry.status, entry.ip_address,
        entry.user_agent, entry.error_message,
      ]
    );
  } catch (err) {
    // Never swallow — always surface to stderr
    console.error('[AUDIT_FAILURE]', {
      attempted_entry: entry,
      error          : err.message,
    });
  }
}

module.exports = { auditLog, AuditStatus };