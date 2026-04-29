const { C, PAGE, LAYOUT } = require('../tokens');
const { fill, rRect, hRule } = require('./header');

// ═══════════════════════════════════════════════════════════════
//  TABLE RENDERING ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Risk Level Table
 */
function drawRiskTable(doc, prediction, y) {
  const tableY = y;
  const headers = ['METRIC', 'VALUE', 'STATUS'];
  const headerW = [100, 150, 120];
  const colX = [PAGE.M, PAGE.M + headerW[0], PAGE.M + headerW[0] + headerW[1]];

  fill(doc, PAGE.M - 8, tableY, PAGE.CW + 16, 24, C.surface);
  doc.fontSize(7).fillColor(C.muted).font('Helvetica-Bold');
  headers.forEach((h, i) => {
    doc.text(h, colX[i] + 8, tableY + 8, {
      width: headerW[i] - 16,
      align: i === 0 ? 'left' : 'center',
    });
  });

  const rows = [
    {
      metric: 'Risk Level',
      value : prediction.risk_level.toUpperCase(),
      status: _riskBadge(prediction.risk_level),
    },
    {
      metric: 'Risk Score',
      value : `${(prediction.risk_score * 100).toFixed(1)}%`,
      status: _scoreBadge(prediction.risk_score),
    },
    {
      metric: 'Model Version',
      value : prediction.model_version || 'v1.0',
      status: 'INFO',
    },
    {
      metric: 'Inference Time',
      value : prediction.inference_duration_ms != null
                ? `${prediction.inference_duration_ms}ms` : 'N/A',
      status: 'CACHED' in prediction && prediction.is_cached ? 'CACHED' : 'FRESH',
    },
  ];

  let rowY = tableY + 28;
  rows.forEach((row, idx) => {
    const bgColor = idx % 2 === 0 ? C.surface : C.white;
    fill(doc, PAGE.M - 8, rowY, PAGE.CW + 16, 20, bgColor);

    doc.fontSize(8).fillColor(C.ink).font('Helvetica');
    doc.text(row.metric, colX[0] + 8, rowY + 5, {
      width: headerW[0] - 16, align: 'left',
    });
    doc.fontSize(9).fillColor(C.ink).font('Helvetica-Bold');
    doc.text(row.value, colX[1] + 8, rowY + 5, {
      width: headerW[1] - 16, align: 'center',
    });
    _drawStatusBadge(doc, colX[2] + 8, rowY + 5, row.status, headerW[2] - 16);

    rowY += 20;
  });

  return rowY + 8;
}

/**
 * Code Metrics Table
 */
function drawMetricsTable(doc, metrics, y) {
  if (!metrics || !metrics.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text('No metrics extracted', PAGE.M, y);
    return y + 20;
  }

  const tableY = y;
  const headers = ['METRIC', 'VALUE', 'UNIT', 'NORMALIZED'];
  const headerW = [120, 100, 80, 100];
  const colX    = [PAGE.M, PAGE.M + headerW[0], PAGE.M + headerW[0] + headerW[1]];
  const colX3   = PAGE.M + headerW[0] + headerW[1] + headerW[2];

  fill(doc, PAGE.M - 8, tableY, PAGE.CW + 16, 24, C.surface);
  doc.fontSize(7).fillColor(C.muted).font('Helvetica-Bold');
  headers.forEach((h, i) => {
    const x = i === 0 ? colX[0] : i === 1 ? colX[1] : i === 2 ? colX[2] : colX3;
    const w = i === 0 ? headerW[0] : i === 1 ? headerW[1] : i === 2 ? headerW[2] : headerW[3];
    doc.text(h, x + 8, tableY + 8, { width: w - 16, align: 'center' });
  });

  let rowY = tableY + 28;
  metrics.forEach((metric, idx) => {
    const bgColor = idx % 2 === 0 ? C.surface : C.white;
    fill(doc, PAGE.M - 8, rowY, PAGE.CW + 16, 20, bgColor);

    doc.fontSize(8).fillColor(C.ink).font('Helvetica');
    doc.text(metric.metric_name, colX[0] + 8, rowY + 5, {
      width: headerW[0] - 16, align: 'left',
    });
    doc.fontSize(9).fillColor(C.ink).font('Helvetica-Bold');
    doc.text(String(metric.metric_value), colX[1] + 8, rowY + 5, {
      width: headerW[1] - 16, align: 'center',
    });
    doc.fontSize(8).fillColor(C.subtle).font('Helvetica');
    doc.text(metric.metric_unit || '-', colX[2] + 8, rowY + 5, {
      width: headerW[2] - 16, align: 'center',
    });
    const normLabel = metric.is_normalized ? 'YES' : '-';
    const normColor = metric.is_normalized ? C.teal : C.muted;
    doc.fontSize(8).fillColor(normColor).font('Helvetica-Bold');
    doc.text(normLabel, colX3 + 8, rowY + 5, {
      width: headerW[3] - 16, align: 'center',
    });

    rowY += 20;
  });

  return rowY + 8;
}

/**
 * SHAP Explanations Table
 */
function drawShapTable(doc, shapExplanations, y) {
  if (!shapExplanations || !shapExplanations.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text('No SHAP explanations available', PAGE.M, y);
    return y + 20;
  }

  const tableY  = y;
  const headers = ['RANK', 'FEATURE', 'SHAP VALUE', 'IMPACT'];
  const headerW = [50, 150, 100, 100];
  const colX    = [PAGE.M, PAGE.M + headerW[0], PAGE.M + headerW[0] + headerW[1]];
  const colX3   = PAGE.M + headerW[0] + headerW[1] + headerW[2];

  fill(doc, PAGE.M - 8, tableY, PAGE.CW + 16, 24, C.surface);
  doc.fontSize(7).fillColor(C.muted).font('Helvetica-Bold');
  headers.forEach((h, i) => {
    const x = i === 0 ? colX[0] : i === 1 ? colX[1] : i === 2 ? colX[2] : colX3;
    const w = i === 0 ? headerW[0] : i === 1 ? headerW[1] : i === 2 ? headerW[2] : headerW[3];
    doc.text(h, x + 8, tableY + 8, {
      width: w - 16, align: i < 2 ? 'left' : 'center',
    });
  });

  let rowY = tableY + 28;
  shapExplanations.slice(0, 10).forEach((shap, idx) => {
    const bgColor = idx % 2 === 0 ? C.surface : C.white;
    const isTop5  = shap.is_top_5;
    fill(doc, PAGE.M - 8, rowY, PAGE.CW + 16, 20, bgColor);

    const rankLabel = isTop5 ? `${shap.feature_rank}*` : String(shap.feature_rank);
    doc.fontSize(9).fillColor(isTop5 ? C.teal : C.ink).font('Helvetica-Bold');
    doc.text(rankLabel, colX[0] + 8, rowY + 5, {
      width: headerW[0] - 16, align: 'center',
    });

    doc.fontSize(8).fillColor(C.ink).font('Helvetica');
    doc.text(shap.feature_name, colX[1] + 8, rowY + 5, {
      width: headerW[1] - 16, align: 'left',
    });

    const shapVal  = parseFloat(shap.shap_value) || 0;
    const barW     = (headerW[2] - 24) * Math.min(Math.abs(shapVal) / 0.5, 1);
    const barColor = shapVal > 0 ? C.highRisk : C.lowRisk;

    doc.fontSize(8).fillColor(C.ink).font('Helvetica-Bold');
    doc.text(shapVal.toFixed(4), colX[2] + 8, rowY + 5, {
      width: headerW[2] - 24, align: 'left',
    });
    fill(doc,
      colX[2] + 8 + doc.widthOfString(shapVal.toFixed(4)) + 4,
      rowY + 7, barW, 6, barColor
    );

    const impact = _shapImpact(shapVal);
    doc.fontSize(8).fillColor(_impactColor(impact)).font('Helvetica-Bold');
    doc.text(impact, colX3 + 8, rowY + 5, {
      width: headerW[3] - 16, align: 'center',
    });

    rowY += 20;
  });

  if (shapExplanations.length > 10) {
    doc.fontSize(7).fillColor(C.muted).font('Helvetica-Bold')
       .text(`+ ${shapExplanations.length - 10} more features`, PAGE.M, rowY + 6);
    rowY += 14;
  }

  return rowY + 8;
}

/**
 * Mitigation Rules Table
 * Full-height rows — no truncation, no overlap, readable font.
 */
function drawMitigationTable(doc, rules, y) {
  if (!rules || !rules.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text('No mitigations available', PAGE.M, y);
    return y + 20;
  }

  // Column widths — advice gets the most space
  const driverW   = 90;
  const priorityW = 64;
  const adviceW   = PAGE.CW - driverW - priorityW; // remaining width

  const driverX   = PAGE.M;
  const adviceX   = PAGE.M + driverW;
  const priorityX = PAGE.M + driverW + adviceW;

  const ADVICE_FONT = 9;
  const V_PAD      = 10; // vertical padding top+bottom inside each row
  const MIN_ROW_H  = 40;

  // ── Header ─────────────────────────────────────────────────
  const tableY = y;
  fill(doc, PAGE.M - 8, tableY, PAGE.CW + 16, 26, C.ink);

  doc.fontSize(7).fillColor(C.white).font('Helvetica-Bold');
  doc.text('RISK DRIVER',      driverX   + 8, tableY + 9, { width: driverW   - 12 });
  doc.text('MITIGATION ADVICE', adviceX   + 8, tableY + 9, { width: adviceW   - 12 });
  doc.text('PRIORITY',         priorityX + 4, tableY + 9, { width: priorityW - 8, align: 'center' });

  let rowY = tableY + 26;
  const activeRules = rules.filter(r => r.is_active);

  activeRules.forEach((rule, idx) => {
    const advice = rule.mitigation_advice || '-';

    // Measure the advice text height so the row is exactly tall enough
    const adviceH = doc.heightOfString(advice, {
      width   : adviceW - 16,
      fontSize: ADVICE_FONT,
    });
    const rowH = Math.max(MIN_ROW_H, adviceH + V_PAD * 2);

    // Row background
    fill(doc, PAGE.M - 8, rowY, PAGE.CW + 16, rowH, idx % 2 === 0 ? C.surface : C.white);

    // Left priority accent stripe
    fill(doc, PAGE.M - 8, rowY, 4, rowH, _priorityColor(rule.priority));

    // Risk driver — bold, vertically centred in row
    const midY = rowY + (rowH / 2) - 6;
    doc.fontSize(9).fillColor(C.ink).font('Helvetica-Bold');
    doc.text(rule.risk_driver || '-', driverX + 8, midY, {
      width: driverW - 16, align: 'left',
    });

    // Mitigation advice — full readable text, top-padded
    doc.fontSize(ADVICE_FONT).fillColor(C.body).font('Helvetica');
    doc.text(advice, adviceX + 8, rowY + V_PAD, {
      width  : adviceW - 16,
      align  : 'left',
      lineGap: 2,
    });

    // Priority label — colored, vertically centred
    doc.fontSize(9).fillColor(_priorityColor(rule.priority)).font('Helvetica-Bold');
    doc.text(
      String(rule.priority || '-').toUpperCase(),
      priorityX + 4, midY,
      { width: priorityW - 8, align: 'center' }
    );

    // Row bottom divider
    doc.save()
       .moveTo(PAGE.M - 8, rowY + rowH)
       .lineTo(PAGE.W - PAGE.M + 8, rowY + rowH)
       .strokeColor(C.rule).lineWidth(0.5).stroke()
       .restore();

    rowY += rowH;
  });

  return rowY + 8;
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

function _riskBadge(riskLevel) {
  const l = String(riskLevel).toUpperCase();
  if (l === 'CRITICAL') return 'CRITICAL';
  if (l === 'HIGH')     return 'HIGH';
  if (l === 'MEDIUM')   return 'MEDIUM';
  return 'LOW';
}

function _scoreBadge(score) {
  if (score >= 0.7) return 'CRITICAL';
  if (score >= 0.5) return 'HIGH';
  if (score >= 0.3) return 'MEDIUM';
  return 'LOW';
}

function _drawStatusBadge(doc, x, y, status, width) {
  const colors = {
    CACHED:   C.teal,
    FRESH:    C.lowRisk,
    INFO:     C.subtle,
    CRITICAL: C.highRisk,
    HIGH:     '#CC7000',
    MEDIUM:   '#8a6500',
    LOW:      C.lowRisk,
  };
  doc.fontSize(8).fillColor(colors[status] || C.subtle).font('Helvetica-Bold')
     .text(status, x, y, { width, align: 'center' });
}

function _priorityColor(priority) {
  const p = String(priority || '').toUpperCase();
  if (p === 'CRITICAL') return C.highRisk;
  if (p === 'HIGH')     return '#CC7000';
  if (p === 'MEDIUM')   return '#8a6500';
  return C.lowRisk;
}

function _shapImpact(shapVal) {
  const abs = Math.abs(shapVal);
  if (abs >= 0.3) return 'HIGH';
  if (abs >= 0.1) return 'MEDIUM';
  return 'LOW';
}

function _impactColor(impact) {
  if (impact === 'HIGH')   return C.highRisk;
  if (impact === 'MEDIUM') return '#CC7000';
  return C.lowRisk;
}

module.exports = {
  drawRiskTable,
  drawMetricsTable,
  drawShapTable,
  drawMitigationTable,
};