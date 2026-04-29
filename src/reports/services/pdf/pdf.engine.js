'use strict';

const PDFDocument          = require('pdfkit');
const { C, PAGE, LAYOUT, roleLabel } = require('./tokens');
const {
  fill, rRect, hRule, kv,
  sectionHead, pageBg, pageHeader, pageFooter, checkBreak,
} = require('./components/header');
const { drawCover }        = require('./components/cover');
const {
  drawRiskTable,
  drawMetricsTable,
  drawShapTable,
  drawMitigationTable,
} = require('./components/tables');
const {
  drawHorizontalBarChart,
  drawVerticalBarChart,
  drawPieChart,
  drawRiskGauge,
  drawStatBox,
} = require('./components/charts');

// ═══════════════════════════════════════════════════════════════
//  PDF ENGINE — builds the full PDF for a given role
// ═══════════════════════════════════════════════════════════════
function _addPage(doc, pageNum, role) {
  // Footer for current page is caller's responsibility before this
  doc.addPage();
  pageBg(doc);
  const y = pageHeader(doc, role);
  return { y, pageNum: pageNum + 1 };
}
/**
 * Creates a PDFDocument (pdfkit) and pipes content for a USER report.
 * @param {object} data  — from user.fetcher
 * @returns {PDFDocument}
 */
function buildUserPdf(data) {
  const doc = _newDoc();
  const { project, prediction, metrics, shap, mitigations, user } = data;
  const role = roleLabel('user');
  let pageNum = 1;
  let y;

  // ── COVER ──────────────────────────────────────────────────
  pageBg(doc);
  drawCover(doc, {
    title     : project.project_name,
    subtitle  : project.project_description || 'Source Code Risk Report',
    roleLabel : role,
    name      : user.full_name,
    date      : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    stats     : [
      { label: 'Risk Level',    value: prediction.risk_level },
      { label: 'Risk Score',    value: `${(prediction.risk_score * 100).toFixed(0)}%` },
      { label: 'Metrics',       value: metrics.length },
      { label: 'SHAP Features', value: shap.length },
    ],
  });
  pageFooter(doc, pageNum, role);

  // ── PAGE 2 — RISK OVERVIEW ─────────────────────────────────
  ({ y, pageNum } = _addPage(doc, pageNum, role));

  y = sectionHead(doc, 'Risk Overview', y);
  y = drawRiskTable(doc, prediction, y);
  y += 8;

  // Risk gauge — label then gauge
  y = sectionHead(doc, 'Risk Score', y);
  drawRiskGauge(doc, prediction.risk_score, 'Overall Project Risk', PAGE.M, y);
  y += 40;

  // Stat boxes
  y = sectionHead(doc, 'Analysis Summary', y);
  y = drawStatBox(doc, [
    { label: 'Analysis Count', value: project.analysis_count || 1 },
    { label: 'Inference (ms)', value: prediction.inference_duration_ms ?? 'N/A' },
    { label: 'SHAP (ms)',      value: prediction.shap_computation_duration_ms ?? 'N/A' },
    { label: 'Cached',         value: prediction.is_cached ? 'YES' : 'NO' },
  ], y);

  pageFooter(doc, pageNum, role);

  // ── METRICS — start fresh page, then paginate ──────────────
  ({ y, pageNum } = _addPage(doc, pageNum, role));
  y = sectionHead(doc, 'Code Metrics', y);
  ({ y, pageNum } = _drawMetricsTablePaged(doc, metrics, y, pageNum, role));
  pageFooter(doc, pageNum, role);

  // ── SHAP ──────────────────────────────────────────────────
  ({ y, pageNum } = _addPage(doc, pageNum, role));
  y = sectionHead(doc, 'SHAP Feature Explanations', y);
  y = drawShapTable(doc, shap, y);
  pageFooter(doc, pageNum, role);

  // ── MITIGATIONS ───────────────────────────────────────────
  ({ y, pageNum } = _addPage(doc, pageNum, role));
  y = sectionHead(doc, 'Recommended Mitigations', y);
  y = drawMitigationTable(doc, mitigations, y);
  pageFooter(doc, pageNum, role);

  doc.end();
  return doc;
}
/**
 * Draws ALL metrics across pages as needed.
 * Returns final y and updates pageNum externally via callback.
 */
function _drawMetricsTablePaged(doc, metrics, startY, pageNum, role) {
  if (!metrics || !metrics.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text('No metrics extracted', PAGE.M, startY);
    return { y: startY + 20, pageNum };
  }

  const headers  = ['METRIC', 'VALUE', 'UNIT', 'NORMALIZED'];
  const headerW  = [160, 100, 80, 100];
  const colX     = [
    PAGE.M,
    PAGE.M + headerW[0],
    PAGE.M + headerW[0] + headerW[1],
    PAGE.M + headerW[0] + headerW[1] + headerW[2],
  ];
  const ROW_H = 20;

  function drawTableHeader(y) {
    fill(doc, PAGE.M - 8, y, PAGE.CW + 16, 24, C.surface);
    doc.fontSize(7).fillColor(C.muted).font('Helvetica-Bold');
    headers.forEach((h, i) => {
      doc.text(h, colX[i] + 8, y + 8, { width: headerW[i] - 16, align: 'center' });
    });
    return y + 28;
  }

  let y = drawTableHeader(startY);

  metrics.forEach((metric, idx) => {
    // Check if we need a new page
    if (y + ROW_H > PAGE.H - PAGE.FOOTER) {
      pageFooter(doc, pageNum, role);
      pageNum++;
      doc.addPage();
      pageBg(doc);
      pageHeader(doc, role);
      y = PAGE.HEADER + 16;
      y = sectionHead(doc, 'Code Metrics (continued)', y);
      y = drawTableHeader(y);
    }

    const bgColor = idx % 2 === 0 ? C.surface : C.white;
    fill(doc, PAGE.M - 8, y, PAGE.CW + 16, ROW_H, bgColor);

    doc.fontSize(8).fillColor(C.ink).font('Helvetica')
       .text(metric.metric_name, colX[0] + 8, y + 5, { width: headerW[0] - 16, align: 'left' });

    doc.fontSize(9).fillColor(C.ink).font('Helvetica-Bold')
       .text(String(metric.metric_value), colX[1] + 8, y + 5, { width: headerW[1] - 16, align: 'center' });

    doc.fontSize(8).fillColor(C.subtle).font('Helvetica')
       .text(metric.metric_unit || '–', colX[2] + 8, y + 5, { width: headerW[2] - 16, align: 'center' });

    const normLabel = metric.is_normalized ? 'YES' : '-';
    const normColor = metric.is_normalized ? C.teal : C.muted;
    doc.fontSize(8).fillColor(normColor).font('Helvetica-Bold')
       .text(normLabel, colX[3] + 8, y + 5, { width: headerW[3] - 16, align: 'center' });

    y += ROW_H;
  });

  return { y: y + 8, pageNum };
}
/**
 * Builds PDF for PROJECT MANAGER role — adds fleet-level charts.
 * @param {object} data  — from manager.fetcher
 * @returns {PDFDocument}
 */
function buildManagerPdf(data) {
  const doc = _newDoc();
  const { projects, predictions, riskDist, topMetrics, user } = data;
  let pageNum = 1;

  // ── COVER ──────────────────────────────────────────────────
  pageBg(doc);
  drawCover(doc, {
    title    : 'Project Manager Report',
    subtitle : 'Fleet-Level Risk Overview',
    roleLabel: roleLabel('project_manager'),
    name     : user.full_name,
    date     : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    stats    : [
      { label: 'Total Projects', value: projects.length },
      { label: 'High Risk',      value: riskDist.HIGH   || 0 },
      { label: 'Medium Risk',    value: riskDist.MEDIUM || 0 },
      { label: 'Low Risk',       value: riskDist.LOW    || 0 },
    ],
  });
  pageFooter(doc, pageNum, roleLabel('project_manager'));

  // ── PAGE 2 — RISK DISTRIBUTION ────────────────────────────
  doc.addPage();
  pageBg(doc);
  let y = pageHeader(doc, roleLabel('project_manager'));
  pageNum++;

  y = sectionHead(doc, 'Risk Distribution', y);

  const pieData = Object.entries(riskDist).map(([label, value]) => ({
    label,
    value,
    color: label === 'HIGH' ? C.highRisk : label === 'MEDIUM' ? C.medRisk : C.lowRisk,
  }));
  y = drawPieChart(doc, 'Projects by Risk Level', pieData, y);

  y = checkBreak(doc, y, 160);
  y = sectionHead(doc, 'Risk Score Comparison', y);
  const scoreBar = predictions.map(p => ({
    label: p.project_name,
    value: p.risk_score,
  }));
  y = drawVerticalBarChart(doc, 'Risk Scores per Project', scoreBar, y);

  pageFooter(doc, pageNum, roleLabel('project_manager'));

  // ── PAGE 3 — PROJECT TABLE ────────────────────────────────
  doc.addPage();
  pageBg(doc);
  y = pageHeader(doc, roleLabel('project_manager'));
  pageNum++;

  y = sectionHead(doc, 'All Projects', y);
  y = _drawProjectSummaryTable(doc, predictions, y);

  pageFooter(doc, pageNum, roleLabel('project_manager'));

  doc.end();
  return doc;
}

/**
 * Builds PDF for ADMIN role — system-wide analytics.
 * @param {object} data  — from admin.fetcher
 * @returns {PDFDocument}
 */
function buildAdminPdf(data) {
  const doc = _newDoc();
  const {
    userStats, projectStats, predictionStats,
    riskDist, recentAudit, user,
  } = data;
  let pageNum = 1;

  // ── COVER ──────────────────────────────────────────────────
  pageBg(doc);
  drawCover(doc, {
    title    : 'Admin System Report',
    subtitle : 'Platform-Wide Analytics & Audit Summary',
    roleLabel: roleLabel('admin'),
    name     : user.full_name,
    date     : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    stats    : [
      { label: 'Total Users',       value: userStats.total       || 0 },
      { label: 'Total Projects',    value: projectStats.total    || 0 },
      { label: 'Total Predictions', value: predictionStats.total || 0 },
      { label: 'Pro Users',         value: userStats.pro         || 0 },
    ],
  });
  pageFooter(doc, pageNum, roleLabel('admin'));

  // ── PAGE 2 — PLATFORM OVERVIEW ────────────────────────────
  doc.addPage();
  pageBg(doc);
  let y = pageHeader(doc, roleLabel('admin'));
  pageNum++;

  y = sectionHead(doc, 'Platform Statistics', y);
  y = drawStatBox(doc, [
    { label: 'Free Users',     value: userStats.free        || 0 },
    { label: 'Pro Users',      value: userStats.pro         || 0 },
    { label: 'Active Users',   value: userStats.active      || 0 },
    { label: 'Archived Proj.', value: projectStats.archived || 0 },
  ], y);

  y = checkBreak(doc, y, 180);
  y = sectionHead(doc, 'Risk Distribution — All Projects', y);
  const pieData = Object.entries(riskDist).map(([label, value]) => ({
    label,
    value,
    color: label === 'HIGH' ? C.highRisk : label === 'MEDIUM' ? C.medRisk : C.lowRisk,
  }));
  y = drawPieChart(doc, 'System-Wide Risk Levels', pieData, y);

  pageFooter(doc, pageNum, roleLabel('admin'));

  // ── PAGE 3 — AUDIT LOG ────────────────────────────────────
  doc.addPage();
  pageBg(doc);
  y = pageHeader(doc, roleLabel('admin'));
  pageNum++;

  y = sectionHead(doc, 'Recent Audit Log', y);
  y = _drawAuditTable(doc, recentAudit, y);

  pageFooter(doc, pageNum, roleLabel('admin'));

  doc.end();
  return doc;
}

// ═══════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

function _newDoc() {
  return new PDFDocument({
    size    : 'A4',
    margins : { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: true,
    bufferPages  : false,
  });
}

/** Mini project summary table for manager report */
function _drawProjectSummaryTable(doc, predictions, y) {
  if (!predictions || !predictions.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text('No projects found', PAGE.M, y);
    return y + 20;
  }

  const headers = ['PROJECT', 'RISK LEVEL', 'SCORE', 'ANALYSES'];
  const headerW = [180, 100, 80, 80];
  const colX    = [
    PAGE.M,
    PAGE.M + headerW[0],
    PAGE.M + headerW[0] + headerW[1],
    PAGE.M + headerW[0] + headerW[1] + headerW[2],
  ];

  // Header row
  fill(doc, PAGE.M - 8, y, PAGE.CW + 16, 24, C.surface);
  doc.fontSize(7).fillColor(C.muted).font('Helvetica-Bold');
  headers.forEach((h, i) => {
    doc.text(h, colX[i] + 8, y + 8, { width: headerW[i] - 16, align: 'center' });
  });

  let rowY = y + 28;
  predictions.slice(0, 15).forEach((p, idx) => {
    const bg = idx % 2 === 0 ? C.surface : C.white;
    fill(doc, PAGE.M - 8, rowY, PAGE.CW + 16, 20, bg);

    doc.fontSize(8).fillColor(C.ink).font('Helvetica')
       .text(p.project_name || '—', colX[0] + 8, rowY + 5, { width: headerW[0] - 16, align: 'left' });

    const lvlColor = p.risk_level === 'HIGH' ? C.highRisk
                   : p.risk_level === 'MEDIUM' ? C.medRisk : C.lowRisk;
    doc.fontSize(8).fillColor(lvlColor).font('Helvetica-Bold')
       .text(p.risk_level || '—', colX[1] + 8, rowY + 5, { width: headerW[1] - 16, align: 'center' });

    doc.fontSize(8).fillColor(C.ink).font('Helvetica')
       .text(`${(p.risk_score * 100).toFixed(1)}%`, colX[2] + 8, rowY + 5, { width: headerW[2] - 16, align: 'center' });

    doc.fontSize(8).fillColor(C.subtle).font('Helvetica')
       .text(String(p.analysis_count || 1), colX[3] + 8, rowY + 5, { width: headerW[3] - 16, align: 'center' });

    rowY += 20;
  });

  return rowY + 8;
}

/** Audit log table for admin report */
function _drawAuditTable(doc, logs, y) {
  if (!logs || !logs.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text('No audit logs available', PAGE.M, y);
    return y + 20;
  }

  const headers = ['USER', 'ACTION', 'STATUS', 'DATE'];
  const headerW = [120, 180, 80, 80];
  const colX    = [
    PAGE.M,
    PAGE.M + headerW[0],
    PAGE.M + headerW[0] + headerW[1],
    PAGE.M + headerW[0] + headerW[1] + headerW[2],
  ];

  fill(doc, PAGE.M - 8, y, PAGE.CW + 16, 24, C.surface);
  doc.fontSize(7).fillColor(C.muted).font('Helvetica-Bold');
  headers.forEach((h, i) => {
    doc.text(h, colX[i] + 8, y + 8, { width: headerW[i] - 16, align: 'center' });
  });

  let rowY = y + 28;
  logs.slice(0, 20).forEach((log, idx) => {
    const bg = idx % 2 === 0 ? C.surface : C.white;
    fill(doc, PAGE.M - 8, rowY, PAGE.CW + 16, 20, bg);

    doc.fontSize(7).fillColor(C.ink).font('Helvetica')
       .text(log.user_id || '—', colX[0] + 8, rowY + 5, { width: headerW[0] - 16 });
    doc.fontSize(7).fillColor(C.subtle).font('Helvetica')
       .text(log.action  || '—', colX[1] + 8, rowY + 5, { width: headerW[1] - 16 });

    const sc = log.status === 'SUCCESS' ? C.lowRisk : C.highRisk;
    doc.fontSize(7).fillColor(sc).font('Helvetica-Bold')
       .text(log.status  || '—', colX[2] + 8, rowY + 5, { width: headerW[2] - 16, align: 'center' });

    const d = log.created_at
      ? new Date(log.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      : '—';
    doc.fontSize(7).fillColor(C.muted).font('Helvetica')
       .text(d, colX[3] + 8, rowY + 5, { width: headerW[3] - 16, align: 'center' });

    rowY += 20;
  });

  return rowY + 8;
}

module.exports = { buildUserPdf, buildManagerPdf, buildAdminPdf };