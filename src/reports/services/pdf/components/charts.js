const { C, PAGE, LAYOUT, roleLabel } = require('../tokens');
const { fill, rRect, hRule, drawV } = require('./header');

// ═══════════════════════════════════════════════════════════════
//  CHART RENDERING ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Horizontal Bar Chart
 * Renders risk distribution or metric comparison
 * data: [{ label, value, color?, max? }]
 */
function drawHorizontalBarChart(doc, title, data, y) {
  if (!data || !data.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text(`${title}: No data available`, PAGE.M, y);
    return y + 20;
  }

  let chartY = y;

  // Title
  doc.fontSize(10).fillColor(C.ink).font('Helvetica-Bold')
     .text(title, PAGE.M, chartY);
  chartY += 16;

  // Calculate layout
  const barH = 24;
  const maxLabel = Math.max(...data.map(d => doc.widthOfString(d.label || '', { fontSize: 8 })));
  const labelW = Math.min(maxLabel + 12, 140);
  const chartW = PAGE.CW - labelW - 40;
  const maxValue = Math.max(...data.map(d => d.max || d.value || 0)) || 1;

  // Bars
  data.forEach((item, idx) => {
    const barY = chartY + idx * barH;
    const val = item.value || 0;
    const color = item.color || _riskColor(val);
    const barW = Math.min((val / maxValue) * chartW, chartW);

    // Label
    doc.fontSize(8).fillColor(C.ink).font('Helvetica')
       .text(item.label || 'Item', PAGE.M, barY + 6, {
         width: labelW - 12,
         align: 'left',
       });

    // Bar background (light)
    fill(doc, PAGE.M + labelW, barY + 6, chartW, 12, C.surface);

    // Bar fill
    fill(doc, PAGE.M + labelW, barY + 6, barW, 12, color);

    // Value label
    const valText = typeof val === 'number' ? val.toFixed(1) : String(val);
    doc.fontSize(7).fillColor(C.muted).font('Helvetica-Bold')
       .text(valText, PAGE.M + labelW + chartW + 8, barY + 6, {
         width: 30,
         align: 'right',
       });
  });

  chartY += data.length * barH;
  return chartY + 8;
}

/**
 * Vertical Bar Chart / Histogram
 * Renders metric distribution or time-based trends
 * data: [{ label, value, color? }]
 */
function drawVerticalBarChart(doc, title, data, y) {
  if (!data || !data.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text(`${title}: No data available`, PAGE.M, y);
    return y + 20;
  }

  let chartY = y;

  // Title
  doc.fontSize(10).fillColor(C.ink).font('Helvetica-Bold')
     .text(title, PAGE.M, chartY);
  chartY += 16;

  // Calculate layout
  const chartW = PAGE.CW;
  const chartH = 140;
  const barCount = Math.min(data.length, 12); // Max 12 bars
  const barW = (chartW - 40) / barCount;
  const maxValue = Math.max(...data.map(d => d.value || 0)) || 1;
  const step = Math.max(1, Math.ceil(maxValue / 5));

  // Y-axis labels (0, step, 2*step, ...)
  const gridY = chartY + 8;
  for (let i = 0; i <= 5; i++) {
    const val = i * step;
    const gy = gridY + chartH - (i / 5) * chartH;
    doc.fontSize(6).fillColor(C.muted).font('Helvetica')
       .text(String(val), PAGE.M - 24, gy - 3, { width: 20, align: 'right' });
    // Grid line
    fill(doc, PAGE.M, gy, chartW - 40, 0.5, C.rule);
  }

  // Bars
  data.slice(0, barCount).forEach((item, idx) => {
    const val = item.value || 0;
    const barH = Math.min((val / maxValue) * chartH, chartH);
    const barX = PAGE.M + 20 + idx * barW;
    const barY = gridY + chartH - barH;
    const color = item.color || C.teal;

    // Bar
    rRect(doc, barX + 4, barY, barW - 8, barH, 2, color, 'transparent', 0);

    // Label below (every nth label to avoid clutter)
    if (idx % Math.ceil(barCount / 8) === 0) {
      doc.fontSize(6).fillColor(C.muted).font('Helvetica')
         .text(item.label || '', barX, gridY + chartH + 6, {
           width: barW,
           align: 'center',
         });
    }
  });

  // Axes
  fill(doc, PAGE.M, gridY, 1, chartH, C.rule);
  fill(doc, PAGE.M, gridY + chartH, chartW - 40, 1, C.rule);

  chartY = gridY + chartH + 36;
  return chartY;
}

/**
 * Pie/Donut Chart
 * Renders risk level distribution
 * data: [{ label, value, color? }]
 */
function drawPieChart(doc, title, data, y) {
  if (!data || !data.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text(`${title}: No data available`, PAGE.M, y);
    return y + 20;
  }

  let chartY = y;

  // Title
  doc.fontSize(10).fillColor(C.ink).font('Helvetica-Bold')
     .text(title, PAGE.M, chartY);
  chartY += 16;

  // Calculate total
  const total = data.reduce((sum, d) => sum + (d.value || 0), 0) || 1;

  // Pie dimensions
  const cx = PAGE.M + 60;
  const cy = chartY + 60;
  const radius = 50;

  // Draw slices
  let startAngle = -Math.PI / 2;
  data.forEach((item) => {
    const sliceAngle = (item.value / total) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;

    // Draw slice
    _drawPieSlice(doc, cx, cy, radius, startAngle, endAngle, item.color || C.teal);

    startAngle = endAngle;
  });

  // Legend (right side)
  let legendY = chartY;
  const legendX = PAGE.M + 140;
  data.forEach((item) => {
    const pct = ((item.value / total) * 100).toFixed(1);

    // Color dot
    fill(doc, legendX, legendY + 2, 8, 8, item.color || C.teal);

    // Label + percentage
    doc.fontSize(7).fillColor(C.ink).font('Helvetica')
       .text(`${item.label}: ${pct}%`, legendX + 12, legendY, {
         width: 100,
         align: 'left',
       });

    legendY += 14;
  });

  chartY += 140;
  return chartY;
}

/**
 * Sparkline Chart
 * Renders mini trend line for metrics
 * data: [value, value, ...] — numbers only
 */
function drawSparkline(doc, label, values, x, y, width) {
  if (!values || !values.length) {
    doc.fontSize(7).fillColor(C.muted).font('Helvetica')
       .text(`${label}: No data`, x, y);
    return;
  }

  const height = 20;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Calculate points
  const pointCount = values.length;
  const pointSpacing = (width - 2) / (pointCount - 1 || 1);

  // Draw background
  fill(doc, x, y, width, height, C.surface);

  // Draw line
  doc.moveTo(x + 1, y + height - ((values[0] - minVal) / range) * (height - 2) - 1);
  values.forEach((v, i) => {
    const px = x + 1 + i * pointSpacing;
    const py = y + height - ((v - minVal) / range) * (height - 2) - 1;
    doc.lineTo(px, py);
  });
  doc.strokeColor(C.teal).lineWidth(1).stroke();

  // Trend indicator
  const trend = values[pointCount - 1] - values[0];
  const trendColor = trend > 0 ? C.risk : C.safe;
  const trendLabel = trend > 0 ? '↑ ' : '↓ ';
  doc.fontSize(6).fillColor(trendColor).font('Helvetica-Bold')
     .text(`${trendLabel}${Math.abs(trend).toFixed(2)}`, x + width + 4, y + 2);
}

/**
 * Risk Score Gauge
 * Visual representation of 0-1 score with color coding
 */
function drawRiskGauge(doc, score, label, x, y) {
  const gaugeW = 100;
  const gaugeH = 16;
  const bgColor = C.surface;
  const fillColor = _scoreColor(score);

  // Background bar
  rRect(doc, x, y, gaugeW, gaugeH, 3, bgColor, C.rule, 0.5);

  // Fill bar
  const fillW = score * gaugeW;
  fill(doc, x, y, fillW, gaugeH, fillColor);

  // Percentage text
  const pctText = `${(score * 100).toFixed(0)}%`;
  doc.fontSize(8).fillColor(C.ink).font('Helvetica-Bold')
     .text(pctText, x + gaugeW + 8, y + 2);

  // Label
  if (label) {
    doc.fontSize(7).fillColor(C.muted).font('Helvetica')
       .text(label, x, y + gaugeH + 4);
  }
}

/**
 * Complexity Distribution Heatmap
 * Shows metric values in grid format
 * data: { rows: [{ label, values: [num, num, ...] }] }
 */
function drawMetricHeatmap(doc, title, data, y) {
  if (!data || !data.rows || !data.rows.length) {
    doc.fontSize(8).fillColor(C.muted).font('Helvetica')
       .text(`${title}: No data available`, PAGE.M, y);
    return y + 20;
  }

  let heatY = y;

  // Title
  doc.fontSize(10).fillColor(C.ink).font('Helvetica-Bold')
     .text(title, PAGE.M, heatY);
  heatY += 16;

  const rows = data.rows.slice(0, 6); // Max 6 rows
  const maxValInData = Math.max(
    ...rows.flatMap(r => r.values || [])
  ) || 1;

  rows.forEach((row, rIdx) => {
    const rowY = heatY + rIdx * 20;
    const labelW = 100;

    // Row label
    doc.fontSize(7).fillColor(C.ink).font('Helvetica')
       .text(row.label || '', PAGE.M, rowY + 6, {
         width: labelW - 8,
         align: 'left',
       });

    // Cells
    const cellW = 14;
    const cellH = 14;
    const cellCount = Math.min(row.values.length, 12);

    (row.values || []).slice(0, cellCount).forEach((val, cIdx) => {
      const cellX = PAGE.M + labelW + cIdx * (cellW + 3);
      const cellY = rowY + 3;
      const normalized = val / maxValInData;
      const cellColor = _heatmapColor(normalized);

      rRect(doc, cellX, cellY, cellW, cellH, 1, cellColor, 'transparent', 0);

      // Value (tiny)
      doc.fontSize(5).fillColor(C.ink).font('Helvetica')
         .text(String(val.toFixed(1)), cellX + 1, cellY + 5, {
           width: cellW - 2,
           align: 'center',
         });
    });
  });

  heatY += rows.length * 20 + 8;
  return heatY;
}

/**
 * Statistics Box
 * Quick summary of key metrics
 * stats: [{ label, value, unit? }]
 */
function drawStatBox(doc, stats, y) {
  if (!stats || !stats.length) return y;

  const boxW = (PAGE.CW - (stats.length - 1) * 8) / stats.length;
  let boxY = y;

  stats.forEach((stat, idx) => {
    const bx = PAGE.M + idx * (boxW + 8);
    const by = boxY;

    // Box background
    rRect(doc, bx, by, boxW, 52, 4, C.surface, C.rule, 0.5);

    // Top accent bar
    fill(doc, bx, by, boxW, 3, C.teal);

    // Label
    doc.fontSize(6).fillColor(C.muted).font('Helvetica')
       .text(stat.label.toUpperCase(), bx + 8, by + 8, {
         width: boxW - 16,
         align: 'left',
       });

    // Value
    doc.fontSize(18).fillColor(C.ink).font('Helvetica-Bold')
       .text(String(stat.value), bx + 8, by + 18, {
         width: boxW - 16,
         align: 'left',
       });

    // Unit (if provided)
    if (stat.unit) {
      doc.fontSize(7).fillColor(C.subtle).font('Helvetica')
         .text(stat.unit, bx + 8, by + 38, {
           width: boxW - 16,
           align: 'left',
         });
    }
  });

  return boxY + 60;
}

// ═══════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function _riskColor(value) {
  if (typeof value === 'string') {
    const v = value.toUpperCase();
    if (v === 'CRITICAL') return C.risk;
    if (v === 'HIGH') return '#FF9800';
    if (v === 'MEDIUM') return '#FFC107';
    return C.safe;
  }
  // Numeric value (0-1)
  if (value >= 0.7) return C.risk;
  if (value >= 0.5) return '#FF9800';
  if (value >= 0.3) return '#FFC107';
  return C.safe;
}

function _scoreColor(score) {
  if (score >= 0.7) return C.risk; // Red
  if (score >= 0.5) return '#FF9800'; // Orange
  if (score >= 0.3) return '#FFC107'; // Yellow
  return C.safe; // Green
}

function _heatmapColor(normalized) {
  // Normalized: 0-1, red (high) to green (low)
  if (normalized >= 0.7) return '#FFCDD2'; // Light red
  if (normalized >= 0.5) return '#FFE0B2'; // Light orange
  if (normalized >= 0.3) return '#FFF9C4'; // Light yellow
  return '#C8E6C9'; // Light green
}

function _drawPieSlice(doc, cx, cy, radius, startAngle, endAngle, color) {
  const x1 = cx + radius * Math.cos(startAngle);
  const y1 = cy + radius * Math.sin(startAngle);
  const x2 = cx + radius * Math.cos(endAngle);
  const y2 = cy + radius * Math.sin(endAngle);

  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  // Use moveTo + arc-like path
  doc.moveTo(cx, cy)
     .lineTo(x1, y1);

  // Approximate arc with lines (PDF doesn't have native arc)
  const steps = Math.ceil(Math.abs(endAngle - startAngle) * 20);
  for (let i = 1; i <= steps; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / steps);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    doc.lineTo(x, y);
  }

  doc.lineTo(cx, cy).closePath();
  doc.fillColor(color).fill();
}

module.exports = {
  drawHorizontalBarChart,
  drawVerticalBarChart,
  drawPieChart,
  drawSparkline,
  drawRiskGauge,
  drawMetricHeatmap,
  drawStatBox,
};