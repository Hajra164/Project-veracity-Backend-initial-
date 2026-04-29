// ═══════════════════════════════════════════════════════════════
//  DESIGN TOKENS — Brand colors from your frontend CSS
// ═══════════════════════════════════════════════════════════════

const C = {
  // Brand (from your frontend --scrollbar-thumb: #14a085)
  teal        : '#14a085',
  tealDark    : '#0d7a65',
  tealLight   : '#edf7f5',

  // Neutrals — slate-based
  ink         : '#0f172a',
  body        : '#374151',
  subtle      : '#6b7280',
  muted       : '#9ca3af',
  rule        : '#e5e7eb',
  surface     : '#f9fafb',
  white       : '#ffffff',
  pageBg      : '#ffffff',

  // Semantic — desaturated, professional
  highRisk    : '#991b1b',
  highRiskBg  : '#fef2f2',
  medRisk     : '#78350f',
  medRiskBg   : '#fffbeb',
  lowRisk     : '#065f46',
  lowRiskBg   : '#22533c',

  // Role accents
  adminPurple : '#4c1d95',
  pmSlate     : '#1e3a5f',
};

// ═══════════════════════════════════════════════════════════════
//  PAGE GEOMETRY — A4
// ═══════════════════════════════════════════════════════════════
const PAGE = {
  W      : 595.28,   // page width
  H      : 841.89,   // page height
  M      : 48,       // margin
  get CW() { return this.W - this.M * 2; }, // content width
  FOOTER : 58,       // footer safe zone from bottom
  HEADER : 72,       // header height
};

// ═══════════════════════════════════════════════════════════════
//  LAYOUT CONSTANTS
// ═══════════════════════════════════════════════════════════════
const LAYOUT = {
  ROW_H        : 20,   // table row height
  SHAP_ROW_H   : 34,   // SHAP bar row height
  CARD_H       : 78,   // risk card height
  SECTION_GAP  : 22,   // space after section heading
  CARD_GAP     : 8,    // space between cards
  LABEL_SIZE   : 6,    // small label font size
  BODY_SIZE    : 8,    // body text font size
  HEADING_SIZE : 8.5,  // section heading font size
  TITLE_SIZE   : 14,   // page title font size
  COVER_SIZE   : 24,   // cover brand name size
};

// ═══════════════════════════════════════════════════════════════
//  RISK COLOR HELPERS
// ═══════════════════════════════════════════════════════════════
const riskColor = (level) => {
  if (!level) return C.teal;
  const l = level.toString().toUpperCase();
  if (l === 'HIGH')   return C.highRisk;
  if (l === 'MEDIUM') return C.medRisk;
  return C.lowRisk;
};

const riskBgColor = (level) => {
  if (!level) return C.tealLight;
  const l = level.toString().toUpperCase();
  if (l === 'HIGH')   return C.highRiskBg;
  if (l === 'MEDIUM') return C.medRiskBg;
  return C.lowRiskBg;
};

const priorityColor = (p) => {
  if (p === 'CRITICAL') return C.highRisk;
  if (p === 'HIGH')     return '#92400e';
  if (p === 'MEDIUM')   return C.tealDark;
  return C.subtle;
};

const roleLabel = (role) => {
  if (role === 'admin')           return 'DBA ADMIN REPORT';
  if (role === 'project_manager') return 'PROJECT MANAGER REPORT';
  return 'STANDARD REPORT';
};

module.exports = { C, PAGE, LAYOUT, riskColor, riskBgColor, priorityColor, roleLabel };