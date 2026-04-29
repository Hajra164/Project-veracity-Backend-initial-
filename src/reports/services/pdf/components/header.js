const { C, PAGE, LAYOUT } = require('../tokens');

// ═══════════════════════════════════════════════════════════════
//  LOW-LEVEL DRAW HELPERS (used across all components)
// ═══════════════════════════════════════════════════════════════

function fill(doc, x, y, w, h, color) {
  doc.save().rect(x, y, w, h).fill(color).restore();
}

function rRect(doc, x, y, w, h, r, fillClr, strokeClr, strokeW = 0.5) {
  doc.save().roundedRect(x, y, w, h, r);
  if (fillClr && strokeClr) {
    doc.fillColor(fillClr).strokeColor(strokeClr).lineWidth(strokeW).fillAndStroke();
  } else if (fillClr) {
    doc.fill(fillClr);
  } else if (strokeClr) {
    doc.strokeColor(strokeClr).lineWidth(strokeW).stroke();
  }
  doc.restore();
}

function hRule(doc, y, color = C.rule, lw = 0.5) {
  doc.save()
     .moveTo(PAGE.M, y).lineTo(PAGE.W - PAGE.M, y)
     .strokeColor(color).lineWidth(lw).stroke()
     .restore();
}

function drawV(doc, x, y, size, color) {
  const w = size * 0.82, h = size, t = size * 0.20;
  doc.save()
     .moveTo(x, y).lineTo(x + t, y)
     .lineTo(x + w / 2, y + h - t * 0.8)
     .lineTo(x + w / 2 - t * 0.55, y + h)
     .closePath().fill(color)
     .moveTo(x + w, y).lineTo(x + w - t, y)
     .lineTo(x + w / 2, y + h - t * 0.8)
     .lineTo(x + w / 2 + t * 0.55, y + h)
     .closePath().fill(color)
     .restore();
}

function kv(doc, label, value, x, y, w, valueColor = C.ink, valueSize = 10) {
  doc.fontSize(LAYOUT.LABEL_SIZE).fillColor(C.muted).font('Helvetica')
     .text(label.toUpperCase(), x, y, { width: w });
  doc.fontSize(valueSize).fillColor(valueColor).font('Helvetica-Bold')
     .text(String(value), x, y + 8, { width: w });
}

function sectionHead(doc, label, y, rightNote = '') {
  doc.fontSize(LAYOUT.HEADING_SIZE).fillColor(C.ink).font('Helvetica-Bold')
     .text(label.toUpperCase(), PAGE.M, y, {
       width: PAGE.CW - 80,
       characterSpacing: 0.6,
     });
  if (rightNote) {
    doc.fontSize(7).fillColor(C.muted).font('Helvetica')
       .text(rightNote, 0, y + 1, { align: 'right', width: PAGE.W - PAGE.M });
  }
  fill(doc, PAGE.M, y + 14, PAGE.CW, 1.5, C.teal);
  return y + LAYOUT.SECTION_GAP;
}

function pageBg(doc) {
  fill(doc, 0, 0, PAGE.W, PAGE.H, C.pageBg);
}

// ═══════════════════════════════════════════════════════════════
//  PAGE HEADER — dark band with logo
// ═══════════════════════════════════════════════════════════════
function pageHeader(doc, rightLabel = '') {
  fill(doc, 0, 0, PAGE.W, 54, C.ink);
  fill(doc, 0, 54, PAGE.W, 2.5, C.teal);
  drawV(doc, PAGE.M, 9, 34, C.teal);
  doc.fontSize(LAYOUT.TITLE_SIZE).fillColor(C.white).font('Helvetica-Bold')
     .text('VERACITY', PAGE.M + 40, 15);
  doc.fontSize(7).fillColor(C.muted).font('Helvetica')
     .text('AI-Powered Code Risk Analysis', PAGE.M + 40, 32);
  if (rightLabel) {
    doc.fontSize(7).fillColor(C.muted).font('Helvetica')
       .text(rightLabel, 0, 22, { align: 'right', width: PAGE.W - PAGE.M });
  }
  return PAGE.HEADER;
}

// ═══════════════════════════════════════════════════════════════
//  PAGE FOOTER
// ═══════════════════════════════════════════════════════════════
function pageFooter(doc, pageNum, roleStr) {
  hRule(doc, PAGE.H - 40, C.rule, 0.5);
  doc.fontSize(6.5).fillColor(C.muted).font('Helvetica')
     .text(
       `Project Veracity  ·  ${roleStr}  ·  Confidential`,
       PAGE.M, PAGE.H - 30,
       { width: PAGE.CW - 30 }
     );
  doc.fontSize(6.5).fillColor(C.muted).font('Helvetica')
     .text(String(pageNum), 0, PAGE.H - 30, {
       align: 'right', width: PAGE.W - PAGE.M,
     });
}

// ═══════════════════════════════════════════════════════════════
//  PAGINATION HELPER — safe page break
// ═══════════════════════════════════════════════════════════════
function checkBreak(doc, y, need = 80) {
  if (y + need > PAGE.H - PAGE.FOOTER) {
    doc.addPage();
    pageBg(doc);
    return PAGE.M + 20;
  }
  return y;
}

module.exports = {
  fill, rRect, hRule, drawV, kv,
  sectionHead, pageBg, pageHeader, pageFooter, checkBreak,
};