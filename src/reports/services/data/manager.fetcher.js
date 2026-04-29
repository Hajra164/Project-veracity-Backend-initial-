'use strict';

const db = require('../../../db');

// ═══════════════════════════════════════════════════════════════
//  MANAGER FETCHER
//  Returns fleet-level data across ALL projects visible to a PM.
//  A PM sees every non-archived project on the platform
//  (same tenant scope — adjust WHERE clauses if multi-tenant).
//
//  Shape returned:
//  {
//    user        : { user_id, full_name, email, tier }
//    projects    : [ ...projects rows ]
//    predictions : [ ...predictions rows, joined with project_name ]
//    riskDist    : { HIGH: n, MEDIUM: n, LOW: n }
//    topMetrics  : [ { metric_name, avg_value, max_value, project_count } ]
//  }
// ═══════════════════════════════════════════════════════════════

/**
 * @param {number} userId  — authenticated PM / admin user id
 * @returns {Promise<object>}
 * @throws  {Error}        — with .statusCode for route-level handling
 */
async function fetchManagerReportData(userId) {

  // ── 1. User row ──────────────────────────────────────────────
  const userRow = await db.query(
    `SELECT user_id, full_name, email, tier
     FROM   users
     WHERE  user_id  = $1
       AND  is_active = true`,
    [userId]
  );
  if (!userRow.rows.length) {
    const e = new Error('User not found'); e.statusCode = 404; throw e;
  }
  const user = userRow.rows[0];

  // ── 2. All non-archived projects ─────────────────────────────
  const projRow = await db.query(
    `SELECT project_id, user_id, project_name, project_description,
            file_size_bytes, file_encoding, is_archived,
            latest_prediction_id, analysis_count,
            created_at, updated_at
     FROM   projects
     WHERE  is_archived = false
     ORDER  BY created_at DESC`
  );
  const projects = projRow.rows;

  // ── 3. Latest predictions for those projects ─────────────────
  //  Only pull rows where latest_prediction_id is set.
  const predIds = projects
    .filter(p => p.latest_prediction_id)
    .map(p => p.latest_prediction_id);

  let predictions = [];
  if (predIds.length) {
    const predRow = await db.query(
      `SELECT pr.prediction_id, pr.project_id, pr.risk_level, pr.risk_score,
              pr.model_version, pr.is_cached, pr.created_at,
              pj.project_name, pj.analysis_count
       FROM   predictions pr
       JOIN   projects     pj ON pj.project_id = pr.project_id
       WHERE  pr.prediction_id = ANY($1::int[])
       ORDER  BY pr.created_at DESC`,
      [predIds]
    );
    predictions = predRow.rows;
  }

  // ── 4. Risk distribution ─────────────────────────────────────
  const riskDist = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  predictions.forEach(p => {
    const lvl = (p.risk_level || '').toUpperCase();
    if (lvl in riskDist) riskDist[lvl]++;
  });

  // ── 5. Top metrics — avg & max per metric_name across fleet ──
  let topMetrics = [];
  if (predIds.length) {
    const metRow = await db.query(
      `SELECT  metric_name,
               ROUND(AVG(metric_value::numeric), 4) AS avg_value,
               ROUND(MAX(metric_value::numeric), 4) AS max_value,
               COUNT(DISTINCT prediction_id)        AS project_count
       FROM    code_metrics
       WHERE   prediction_id = ANY($1::int[])
       GROUP   BY metric_name
       ORDER   BY avg_value DESC
       LIMIT   10`,
      [predIds]
    );
    topMetrics = metRow.rows;
  }

  return {
    user,
    projects,
    predictions,
    riskDist,
    topMetrics,
  };
}

module.exports = { fetchManagerReportData };