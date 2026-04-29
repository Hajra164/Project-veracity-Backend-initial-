'use strict';

const db = require('../../../db');

// ═══════════════════════════════════════════════════════════════
//  ADMIN FETCHER
//  Returns platform-wide aggregates + recent audit log.
//
//  Shape returned:
//  {
//    user            : { user_id, full_name, email }
//    userStats       : { total, active, free, pro, admins, managers }
//    projectStats    : { total, archived, active }
//    predictionStats : { total, cached, pro_reports, avg_duration_ms }
//    riskDist        : { HIGH: n, MEDIUM: n, LOW: n }
//    topUsers        : [ { user_id, full_name, email, tier, project_count } ]
//    recentAudit     : [ ...audit_logs rows ]
//  }
// ═══════════════════════════════════════════════════════════════

/**
 * @param {number} userId  — authenticated admin user id
 * @returns {Promise<object>}
 * @throws  {Error}        — with .statusCode for route-level handling
 */
async function fetchAdminReportData(userId) {

  // ── 1. Admin user row ────────────────────────────────────────
  const userRow = await db.query(
    `SELECT user_id, full_name, email
     FROM   users
     WHERE  user_id   = $1
       AND  is_active = true`,
    [userId]
  );
  if (!userRow.rows.length) {
    const e = new Error('Admin user not found'); e.statusCode = 404; throw e;
  }
  const user = userRow.rows[0];

  // ── 2. User statistics ───────────────────────────────────────
  const uStatRow = await db.query(
    `SELECT
       COUNT(*)                                    AS total,
       COUNT(*) FILTER (WHERE is_active = true)   AS active,
       COUNT(*) FILTER (WHERE tier = 'free')       AS free,
       COUNT(*) FILTER (WHERE tier = 'pro')        AS pro,
       COUNT(*) FILTER (WHERE role = 'admin')      AS admins,
       COUNT(*) FILTER (WHERE role = 'project_manager') AS managers
     FROM users`
  );
  const userStats = _nums(uStatRow.rows[0]);

  // ── 3. Project statistics ────────────────────────────────────
  const pStatRow = await db.query(
    `SELECT
       COUNT(*)                                       AS total,
       COUNT(*) FILTER (WHERE is_archived = true)    AS archived,
       COUNT(*) FILTER (WHERE is_archived = false)   AS active
     FROM projects`
  );
  const projectStats = _nums(pStatRow.rows[0]);

  // ── 4. Prediction statistics ─────────────────────────────────
  const predStatRow = await db.query(
    `SELECT
       COUNT(*)                                       AS total,
       COUNT(*) FILTER (WHERE is_cached = true)      AS cached,
       COUNT(*) FILTER (WHERE is_pro_report = true)  AS pro_reports,
       ROUND(AVG(total_duration_ms), 1)               AS avg_duration_ms
     FROM predictions`
  );
  const predictionStats = _nums(predStatRow.rows[0]);

  // ── 5. Risk distribution across all latest predictions ───────
  const riskRow = await db.query(
    `SELECT risk_level, COUNT(*) AS cnt
     FROM   predictions pr
     WHERE  pr.prediction_id IN (
       SELECT latest_prediction_id
       FROM   projects
       WHERE  latest_prediction_id IS NOT NULL
     )
     GROUP  BY risk_level`
  );
  const riskDist = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  riskRow.rows.forEach(r => {
    const lvl = (r.risk_level || '').toUpperCase();
    if (lvl in riskDist) riskDist[lvl] = parseInt(r.cnt, 10);
  });

  // ── 6. Top users by project count ────────────────────────────
  const topUsersRow = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.tier,
            COUNT(p.project_id) AS project_count
     FROM   users    u
     LEFT   JOIN projects p ON p.user_id = u.user_id
     GROUP  BY u.user_id, u.full_name, u.email, u.tier
     ORDER  BY project_count DESC
     LIMIT  10`
  );
  const topUsers = topUsersRow.rows.map(r => ({
    ...r,
    project_count: parseInt(r.project_count, 10),
  }));

  // ── 7. Recent audit logs ─────────────────────────────────────
  const auditRow = await db.query(
    `SELECT user_id, action, resource_type, resource_id,
            status, ip_address, user_agent, error_message, created_at
     FROM   audit_logs
     ORDER  BY created_at DESC
     LIMIT  50`
  );

  return {
    user,
    userStats,
    projectStats,
    predictionStats,
    riskDist,
    topUsers,
    recentAudit: auditRow.rows,
  };
}

// ─── helper: cast all values in a stats row to Number ───────────
function _nums(row) {
  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v !== null ? Number(v) : 0])
  );
}

module.exports = { fetchAdminReportData };