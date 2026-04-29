'use strict';

const { safeNum, safeDate, safeStr, safePct } = require('../../utils/sanitize');

// ═══════════════════════════════════════════════════════════════
//  JSON FORMATTERS — one per report role
// ═══════════════════════════════════════════════════════════════

/**
 * Formats user-level report data as a structured JSON object.
 * @param {object} data  — from user.fetcher
 * @returns {object}
 */
function formatUserJson(data) {
  const { project, prediction, metrics, shap, mitigations, user } = data;

  return {
    report: {
      meta: {
        generated_at : new Date().toISOString(),
        report_type  : 'USER_REPORT',
        generated_by : safeStr(user.full_name),
        user_id      : user.user_id,
        tier         : safeStr(user.tier),
      },
      project: {
        project_id         : project.project_id,
        project_name       : safeStr(project.project_name),
        project_description: safeStr(project.project_description),
        file_size_bytes    : project.file_size_bytes || 0,
        file_encoding      : safeStr(project.file_encoding),
        analysis_count     : project.analysis_count  || 0,
        is_archived        : project.is_archived     || false,
        created_at         : safeDate(project.created_at),
        updated_at         : safeDate(project.updated_at),
      },
      prediction: {
        prediction_id              : prediction.prediction_id,
        risk_level                 : safeStr(prediction.risk_level),
        risk_score                 : safeNum(prediction.risk_score, 4),
        risk_score_pct             : safePct(prediction.risk_score),
        model_version              : safeStr(prediction.model_version),
        inference_duration_ms      : prediction.inference_duration_ms      || 0,
        shap_computation_duration_ms: prediction.shap_computation_duration_ms || 0,
        total_duration_ms          : prediction.total_duration_ms           || 0,
        is_cached                  : prediction.is_cached  || false,
        is_pro_report              : prediction.is_pro_report || false,
        expires_at                 : safeDate(prediction.expires_at),
        created_at                 : safeDate(prediction.created_at),
      },
      code_metrics: metrics.map(m => ({
        metric_id          : m.metric_id,
        metric_name        : safeStr(m.metric_name),
        metric_value       : safeNum(m.metric_value, 4),
        metric_unit        : safeStr(m.metric_unit, ''),
        extraction_method  : safeStr(m.extraction_method),
        is_normalized      : m.is_normalized || false,
        extraction_duration_ms: m.extraction_duration_ms || 0,
      })),
      shap_explanations: shap.map(s => ({
        shap_id           : s.shap_id,
        feature_name      : safeStr(s.feature_name),
        feature_value     : safeNum(s.feature_value, 4),
        shap_value        : safeNum(s.shap_value, 6),
        shap_base_value   : safeNum(s.shap_base_value, 6),
        feature_rank      : s.feature_rank,
        is_top_5          : s.is_top_5 || false,
        computation_method: safeStr(s.computation_method),
      })),
      mitigations: mitigations.map(r => ({
        rule_id          : r.rule_id,
        risk_driver      : safeStr(r.risk_driver),
        mitigation_advice: safeStr(r.mitigation_advice),
        priority         : safeStr(r.priority),
        evidence_source  : safeStr(r.evidence_source),
        version          : safeStr(r.version),
      })),
    },
  };
}

/**
 * Formats manager-level report data as JSON.
 * @param {object} data  — from manager.fetcher
 * @returns {object}
 */
function formatManagerJson(data) {
  const { projects, predictions, riskDist, topMetrics, user } = data;

  return {
    report: {
      meta: {
        generated_at: new Date().toISOString(),
        report_type : 'MANAGER_REPORT',
        generated_by: safeStr(user.full_name),
        user_id     : user.user_id,
        tier        : safeStr(user.tier),
      },
      summary: {
        total_projects : projects.length,
        risk_distribution: riskDist,
      },
      projects: projects.map(p => ({
        project_id         : p.project_id,
        project_name       : safeStr(p.project_name),
        project_description: safeStr(p.project_description),
        analysis_count     : p.analysis_count || 0,
        is_archived        : p.is_archived    || false,
        created_at         : safeDate(p.created_at),
      })),
      predictions: predictions.map(p => ({
        prediction_id : p.prediction_id,
        project_id    : p.project_id,
        project_name  : safeStr(p.project_name),
        risk_level    : safeStr(p.risk_level),
        risk_score    : safeNum(p.risk_score, 4),
        risk_score_pct: safePct(p.risk_score),
        model_version : safeStr(p.model_version),
        is_cached     : p.is_cached || false,
        created_at    : safeDate(p.created_at),
      })),
      top_metrics: (topMetrics || []).map(m => ({
        metric_name : safeStr(m.metric_name),
        avg_value   : safeNum(m.avg_value, 4),
        max_value   : safeNum(m.max_value, 4),
        project_count: m.project_count || 0,
      })),
    },
  };
}

/**
 * Formats admin-level report data as JSON.
 * @param {object} data  — from admin.fetcher
 * @returns {object}
 */
function formatAdminJson(data) {
  const {
    userStats, projectStats, predictionStats,
    riskDist, recentAudit, topUsers, user,
  } = data;

  return {
    report: {
      meta: {
        generated_at: new Date().toISOString(),
        report_type : 'ADMIN_REPORT',
        generated_by: safeStr(user.full_name),
        user_id     : user.user_id,
      },
      user_statistics: {
        total  : userStats.total   || 0,
        active : userStats.active  || 0,
        free   : userStats.free    || 0,
        pro    : userStats.pro     || 0,
        admins : userStats.admins  || 0,
        managers: userStats.managers || 0,
      },
      project_statistics: {
        total   : projectStats.total    || 0,
        archived: projectStats.archived || 0,
        active  : projectStats.active   || 0,
      },
      prediction_statistics: {
        total      : predictionStats.total       || 0,
        cached     : predictionStats.cached      || 0,
        pro_reports: predictionStats.pro_reports || 0,
        avg_duration_ms: safeNum(predictionStats.avg_duration_ms, 1),
      },
      risk_distribution: riskDist,
      top_users: (topUsers || []).map(u => ({
        user_id      : u.user_id,
        full_name    : safeStr(u.full_name),
        email        : safeStr(u.email),
        tier         : safeStr(u.tier),
        project_count: u.project_count || 0,
      })),
      recent_audit_logs: (recentAudit || []).map(log => ({
        user_id      : log.user_id,
        action       : safeStr(log.action),
        resource_type: safeStr(log.resource_type),
        resource_id  : log.resource_id,
        status       : safeStr(log.status),
        ip_address   : safeStr(log.ip_address),
        created_at   : safeDate(log.created_at),
      })),
    },
  };
}

module.exports = { formatUserJson, formatManagerJson, formatAdminJson };