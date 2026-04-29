'use strict';

const { escapeXml, safeNum, safeDate, safeStr, safePct } = require('../../utils/sanitize');

// ═══════════════════════════════════════════════════════════════
//  XML FORMATTERS — one per report role
// ═══════════════════════════════════════════════════════════════

/**
 * Wraps a value in an XML tag.
 * @param {string} tag
 * @param {string|number} value
 * @param {string} [attrs]  — optional attribute string, e.g. 'unit="ms"'
 */
const tag = (tagName, value, attrs = '') =>
  `<${tagName}${attrs ? ' ' + attrs : ''}>${escapeXml(value)}</${tagName}>`;

/** Indents each line of a block by `n` spaces */
const indent = (str, n = 2) =>
  str.split('\n').map(l => ' '.repeat(n) + l).join('\n');

// ─────────────────────────────────────────────
//  USER REPORT
// ─────────────────────────────────────────────
function formatUserXml(data) {
  const { project, prediction, metrics, shap, mitigations, user } = data;

  const metaBlock = indent([
    tag('generated_at', new Date().toISOString()),
    tag('report_type',  'USER_REPORT'),
    tag('generated_by', safeStr(user.full_name)),
    tag('user_id',      user.user_id),
    tag('tier',         safeStr(user.tier)),
  ].join('\n'), 4);

  const projectBlock = indent([
    tag('project_id',          project.project_id),
    tag('project_name',        safeStr(project.project_name)),
    tag('project_description', safeStr(project.project_description)),
    tag('file_size_bytes',     project.file_size_bytes || 0),
    tag('file_encoding',       safeStr(project.file_encoding)),
    tag('analysis_count',      project.analysis_count || 0),
    tag('is_archived',         project.is_archived ? 'true' : 'false'),
    tag('created_at',          safeDate(project.created_at)),
    tag('updated_at',          safeDate(project.updated_at)),
  ].join('\n'), 4);

  const predBlock = indent([
    tag('prediction_id',               prediction.prediction_id),
    tag('risk_level',                  safeStr(prediction.risk_level)),
    tag('risk_score',                  safeNum(prediction.risk_score, 4)),
    tag('risk_score_pct',              safePct(prediction.risk_score)),
    tag('model_version',               safeStr(prediction.model_version)),
    tag('inference_duration_ms',       prediction.inference_duration_ms || 0),
    tag('shap_computation_duration_ms', prediction.shap_computation_duration_ms || 0),
    tag('total_duration_ms',           prediction.total_duration_ms || 0),
    tag('is_cached',                   prediction.is_cached ? 'true' : 'false'),
    tag('is_pro_report',               prediction.is_pro_report ? 'true' : 'false'),
    tag('expires_at',                  safeDate(prediction.expires_at)),
    tag('created_at',                  safeDate(prediction.created_at)),
  ].join('\n'), 4);

  const metricsBlock = metrics.map(m => indent([
    '<metric>',
    indent([
      tag('metric_id',            m.metric_id),
      tag('metric_name',          safeStr(m.metric_name)),
      tag('metric_value',         safeNum(m.metric_value, 4)),
      tag('metric_unit',          safeStr(m.metric_unit, '')),
      tag('extraction_method',    safeStr(m.extraction_method)),
      tag('is_normalized',        m.is_normalized ? 'true' : 'false'),
      tag('extraction_duration_ms', m.extraction_duration_ms || 0),
    ].join('\n'), 2),
    '</metric>',
  ].join('\n'), 4)).join('\n');

  const shapBlock = shap.map(s => indent([
    '<feature>',
    indent([
      tag('shap_id',            s.shap_id),
      tag('feature_name',       safeStr(s.feature_name)),
      tag('feature_value',      safeNum(s.feature_value, 4)),
      tag('shap_value',         safeNum(s.shap_value, 6)),
      tag('shap_base_value',    safeNum(s.shap_base_value, 6)),
      tag('feature_rank',       s.feature_rank),
      tag('is_top_5',           s.is_top_5 ? 'true' : 'false'),
      tag('computation_method', safeStr(s.computation_method)),
    ].join('\n'), 2),
    '</feature>',
  ].join('\n'), 4)).join('\n');

  const mitigBlock = mitigations.map(r => indent([
    '<rule>',
    indent([
      tag('rule_id',           r.rule_id),
      tag('risk_driver',       safeStr(r.risk_driver)),
      tag('mitigation_advice', safeStr(r.mitigation_advice)),
      tag('priority',          safeStr(r.priority)),
      tag('evidence_source',   safeStr(r.evidence_source)),
      tag('version',           safeStr(r.version)),
    ].join('\n'), 2),
    '</rule>',
  ].join('\n'), 4)).join('\n');

  return _wrap(`
  <meta>\n${metaBlock}\n  </meta>
  <project>\n${projectBlock}\n  </project>
  <prediction>\n${predBlock}\n  </prediction>
  <code_metrics>\n${metricsBlock}\n  </code_metrics>
  <shap_explanations>\n${shapBlock}\n  </shap_explanations>
  <mitigations>\n${mitigBlock}\n  </mitigations>`);
}

// ─────────────────────────────────────────────
//  MANAGER REPORT
// ─────────────────────────────────────────────
function formatManagerXml(data) {
  const { projects, predictions, riskDist, topMetrics, user } = data;

  const metaBlock = indent([
    tag('generated_at', new Date().toISOString()),
    tag('report_type',  'MANAGER_REPORT'),
    tag('generated_by', safeStr(user.full_name)),
    tag('user_id',      user.user_id),
    tag('tier',         safeStr(user.tier)),
  ].join('\n'), 4);

  const summaryBlock = indent([
    tag('total_projects', projects.length),
    '<risk_distribution>',
    indent(
      Object.entries(riskDist).map(([k, v]) => tag(k.toLowerCase(), v)).join('\n'), 2
    ),
    '</risk_distribution>',
  ].join('\n'), 4);

  const projectsBlock = projects.map(p => indent([
    '<project>',
    indent([
      tag('project_id',          p.project_id),
      tag('project_name',        safeStr(p.project_name)),
      tag('project_description', safeStr(p.project_description)),
      tag('analysis_count',      p.analysis_count || 0),
      tag('is_archived',         p.is_archived ? 'true' : 'false'),
      tag('created_at',          safeDate(p.created_at)),
    ].join('\n'), 2),
    '</project>',
  ].join('\n'), 4)).join('\n');

  const predsBlock = predictions.map(p => indent([
    '<prediction>',
    indent([
      tag('prediction_id',  p.prediction_id),
      tag('project_id',     p.project_id),
      tag('project_name',   safeStr(p.project_name)),
      tag('risk_level',     safeStr(p.risk_level)),
      tag('risk_score',     safeNum(p.risk_score, 4)),
      tag('risk_score_pct', safePct(p.risk_score)),
      tag('model_version',  safeStr(p.model_version)),
      tag('is_cached',      p.is_cached ? 'true' : 'false'),
      tag('created_at',     safeDate(p.created_at)),
    ].join('\n'), 2),
    '</prediction>',
  ].join('\n'), 4)).join('\n');

  const metricsBlock = (topMetrics || []).map(m => indent([
    '<metric>',
    indent([
      tag('metric_name',  safeStr(m.metric_name)),
      tag('avg_value',    safeNum(m.avg_value, 4)),
      tag('max_value',    safeNum(m.max_value, 4)),
      tag('project_count', m.project_count || 0),
    ].join('\n'), 2),
    '</metric>',
  ].join('\n'), 4)).join('\n');

  return _wrap(`
  <meta>\n${metaBlock}\n  </meta>
  <summary>\n${summaryBlock}\n  </summary>
  <projects>\n${projectsBlock}\n  </projects>
  <predictions>\n${predsBlock}\n  </predictions>
  <top_metrics>\n${metricsBlock}\n  </top_metrics>`);
}

// ─────────────────────────────────────────────
//  ADMIN REPORT
// ─────────────────────────────────────────────
function formatAdminXml(data) {
  const {
    userStats, projectStats, predictionStats,
    riskDist, recentAudit, topUsers, user,
  } = data;

  const metaBlock = indent([
    tag('generated_at', new Date().toISOString()),
    tag('report_type',  'ADMIN_REPORT'),
    tag('generated_by', safeStr(user.full_name)),
    tag('user_id',      user.user_id),
  ].join('\n'), 4);

  const userStatsBlock = indent([
    tag('total',    userStats.total    || 0),
    tag('active',   userStats.active   || 0),
    tag('free',     userStats.free     || 0),
    tag('pro',      userStats.pro      || 0),
    tag('admins',   userStats.admins   || 0),
    tag('managers', userStats.managers || 0),
  ].join('\n'), 4);

  const projStatsBlock = indent([
    tag('total',    projectStats.total    || 0),
    tag('archived', projectStats.archived || 0),
    tag('active',   projectStats.active   || 0),
  ].join('\n'), 4);

  const predStatsBlock = indent([
    tag('total',           predictionStats.total        || 0),
    tag('cached',          predictionStats.cached       || 0),
    tag('pro_reports',     predictionStats.pro_reports  || 0),
    tag('avg_duration_ms', safeNum(predictionStats.avg_duration_ms, 1)),
  ].join('\n'), 4);

  const riskBlock = indent(
    Object.entries(riskDist).map(([k, v]) => tag(k.toLowerCase(), v)).join('\n'), 4
  );

  const topUsersBlock = (topUsers || []).map(u => indent([
    '<user>',
    indent([
      tag('user_id',       u.user_id),
      tag('full_name',     safeStr(u.full_name)),
      tag('email',         safeStr(u.email)),
      tag('tier',          safeStr(u.tier)),
      tag('project_count', u.project_count || 0),
    ].join('\n'), 2),
    '</user>',
  ].join('\n'), 4)).join('\n');

  const auditBlock = (recentAudit || []).map(log => indent([
    '<log>',
    indent([
      tag('user_id',       log.user_id),
      tag('action',        safeStr(log.action)),
      tag('resource_type', safeStr(log.resource_type)),
      tag('resource_id',   log.resource_id),
      tag('status',        safeStr(log.status)),
      tag('ip_address',    safeStr(log.ip_address)),
      tag('created_at',    safeDate(log.created_at)),
    ].join('\n'), 2),
    '</log>',
  ].join('\n'), 4)).join('\n');

  return _wrap(`
  <meta>\n${metaBlock}\n  </meta>
  <user_statistics>\n${userStatsBlock}\n  </user_statistics>
  <project_statistics>\n${projStatsBlock}\n  </project_statistics>
  <prediction_statistics>\n${predStatsBlock}\n  </prediction_statistics>
  <risk_distribution>\n${riskBlock}\n  </risk_distribution>
  <top_users>\n${topUsersBlock}\n  </top_users>
  <recent_audit_logs>\n${auditBlock}\n  </recent_audit_logs>`);
}

// ─────────────────────────────────────────────
//  SHARED WRAPPER
// ─────────────────────────────────────────────
function _wrap(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<report>\n${body}\n</report>`;
}

module.exports = { formatUserXml, formatManagerXml, formatAdminXml };