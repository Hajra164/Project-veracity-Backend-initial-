'use strict';

const db = require('../../../db');

// ═══════════════════════════════════════════════════════════════
//  USER FETCHER
//  Returns everything needed to render a user-level report
//  for a single project + its latest prediction.
//
//  Shape returned:
//  {
//    user        : { user_id, full_name, email, tier }
//    project     : { ...projects row }
//    prediction  : { ...predictions row }
//    metrics     : [ ...code_metrics rows ]
//    shap        : [ ...shap_explanations rows ]
//    mitigations : [ ...mitigation_rules rows ]
//  }
// ═══════════════════════════════════════════════════════════════

/**
 * @param {number} userId     — authenticated user's id
 * @param {number} projectId  — project being reported on
 * @returns {Promise<object>}
 * @throws  {Error}           — with .statusCode for route-level handling
 */
async function fetchUserReportData(userId, projectId) {

  // ── 1. User row ──────────────────────────────────────────────
  const userRow = await db.query(
    `SELECT user_id, full_name, email, tier
     FROM   users
     WHERE  user_id = $1
       AND  is_active = true`,
    [userId]
  );
  if (!userRow.rows.length) {
    const e = new Error('User not found'); e.statusCode = 404; throw e;
  }
  const user = userRow.rows[0];

  // ── 2. Project row (must belong to this user) ────────────────
  const projRow = await db.query(
    `SELECT project_id, user_id, project_name, project_description,
            file_size_bytes, file_encoding, source_code_hash,
            is_archived, archived_at, latest_prediction_id,
            analysis_count, created_at, updated_at
     FROM   projects
     WHERE  project_id = $1
       AND  user_id    = $2`,
    [projectId, userId]
  );
  if (!projRow.rows.length) {
    const e = new Error('Project not found or access denied'); e.statusCode = 404; throw e;
  }
  const project = projRow.rows[0];

  // ── 3. Latest prediction for this project ────────────────────
  if (!project.latest_prediction_id) {
    const e = new Error('No prediction available for this project'); e.statusCode = 404; throw e;
  }

  const predRow = await db.query(
    `SELECT prediction_id, project_id, risk_level, risk_score,
            model_version, inference_duration_ms,
            shap_computation_duration_ms, total_duration_ms,
            is_cached, is_pro_report, expires_at, created_at
     FROM   predictions
     WHERE  prediction_id = $1
       AND  project_id    = $2`,
    [project.latest_prediction_id, projectId]
  );
  if (!predRow.rows.length) {
    const e = new Error('Prediction record missing'); e.statusCode = 500; throw e;
  }
  const prediction = predRow.rows[0];
  const predictionId = prediction.prediction_id;

  // ── 4. Code metrics ──────────────────────────────────────────
  const metricsRow = await db.query(
    `SELECT metric_id, prediction_id, metric_name, metric_value,
            metric_unit, extraction_method, is_normalized,
            extraction_duration_ms, created_at
     FROM   code_metrics
     WHERE  prediction_id = $1
     ORDER  BY metric_name ASC`,
    [predictionId]
  );

  // ── 5. SHAP explanations ─────────────────────────────────────
  const shapRow = await db.query(
    `SELECT shap_id, prediction_id, feature_name, feature_value,
            shap_value, shap_base_value, feature_rank,
            is_top_5, computation_method, created_at
     FROM   shap_explanations
     WHERE  prediction_id = $1
     ORDER  BY feature_rank ASC`,
    [predictionId]
  );

  // ── 6. Mitigation rules (matched by risk_level via threshold) ─
  //  Pull active rules whose risk band covers this prediction's score.
  // Get feature names from SHAP results
const shapFeatureNames = shapRow.rows.map(s => s.feature_name);

let mitigRows = { rows: [] };
if (shapFeatureNames.length > 0) {
  const placeholders = shapFeatureNames.map((_, i) => `$${i + 1}`).join(', ');
  mitigRows = await db.query(
    `SELECT rule_id, risk_driver, mitigation_advice, priority,
            evidence_source, version, is_active,
            threshold_low, threshold_high
     FROM   mitigation_rules
     WHERE  is_active = true
       AND  risk_driver IN (${placeholders})
     ORDER  BY CASE priority
               WHEN 'CRITICAL' THEN 1
               WHEN 'HIGH'     THEN 2
               WHEN 'MEDIUM'   THEN 3
               ELSE 4 END`,
    shapFeatureNames
  );
}

  return {
    user,
    project,
    prediction,
    metrics     : metricsRow.rows,
    shap        : shapRow.rows,
    mitigations : mitigRows.rows,   // ← changed from mitigRow.rows
  };
}

module.exports = { fetchUserReportData };