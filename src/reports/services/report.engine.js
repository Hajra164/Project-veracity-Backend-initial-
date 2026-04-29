'use strict';

// ── Fetchers ──────────────────────────────────────────────────
const { fetchUserReportData    } = require('./data/user.fetcher');
const { fetchManagerReportData } = require('./data/manager.fetcher');
const { fetchAdminReportData   } = require('./data/admin.fetcher');

// ── Formatters ────────────────────────────────────────────────
const { formatUserJson,    formatManagerJson,    formatAdminJson    } = require('./formatters/json.formatter');
const { formatUserXml,     formatManagerXml,     formatAdminXml     } = require('./formatters/xml.formatter');

// ── PDF engine ────────────────────────────────────────────────
const { buildUserPdf,      buildManagerPdf,      buildAdminPdf      } = require('./pdf/pdf.engine');

// ═══════════════════════════════════════════════════════════════
//  REPORT ENGINE
//  Single entry-point for every report request.
//
//  Usage:
//    const engine = require('./services/report.engine');
//    const result = await engine.generate({ role, format, userId, projectId });
//
//  Returns:
//    { type: 'json',   data: <object>     }
//    { type: 'xml',    data: <string>     }
//    { type: 'pdf',    stream: <PDFDoc>   }
//
//  Throws Error with .statusCode on any failure.
// ═══════════════════════════════════════════════════════════════
const VALID_ROLES = ['user', 'student', 'project_manager', 'admin'];
const VALID_FORMATS  = ['json', 'xml', 'pdf'];

/**
 * Generate a report.
 *
 * @param {object} opts
 * @param {'user'|'project_manager'|'admin'} opts.role
 * @param {'json'|'xml'|'pdf'}               opts.format
 * @param {number}  opts.userId        — always required
 * @param {number}  [opts.projectId]   — required for role='user'
 *
 * @returns {Promise<{ type: string, data?: any, stream?: import('pdfkit') }>}
 */
async function generate({ role, format, userId, projectId }) {

  // ── Input validation ─────────────────────────────────────────
  if (!VALID_ROLES.includes(role)) {
    const e = new Error(`Invalid role: ${role}`); e.statusCode = 400; throw e;
  }
  if (!VALID_FORMATS.includes(format)) {
    const e = new Error(`Invalid format: ${format}`); e.statusCode = 400; throw e;
  }
  if (!userId) {
    const e = new Error('userId is required'); e.statusCode = 400; throw e;
  }
 if ((role === 'user' || role === 'student') && !projectId) {
    const e = new Error('projectId is required for user/student reports'); e.statusCode = 400; throw e;
  }

  // ── Fetch ─────────────────────────────────────────────────────
  const data = await _fetch(role, userId, projectId);

  // ── Format ────────────────────────────────────────────────────
  return _format(role, format, data);
}

// ─────────────────────────────────────────────────────────────
//  INTERNAL — fetch by role
// ─────────────────────────────────────────────────────────────
async function _fetch(role, userId, projectId) {
  switch (role) {
    case 'user':
    case 'student':                                      // ← add this line
      return fetchUserReportData(userId, projectId);
    case 'project_manager':
      return fetchManagerReportData(userId);
    case 'admin':
      return fetchAdminReportData(userId);
    default: {
      const e = new Error('Unknown role'); e.statusCode = 400; throw e;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  INTERNAL — format by role + format
// ─────────────────────────────────────────────────────────────
function _format(role, format, data) {

  // ── JSON ────────────────────────────────────────────────────
  if (format === 'json') {
    const formatFn = {
      user            : formatUserJson,
      student         : formatUserJson,     // ← alias
      project_manager : formatManagerJson,
      admin           : formatAdminJson,
    }[role];
    if (!formatFn) {
      const e = new Error(`No JSON formatter for role: ${role}`); e.statusCode = 500; throw e;
    }
    return { type: 'json', data: formatFn(data) };
  }

  // ── XML ─────────────────────────────────────────────────────
  if (format === 'xml') {
    const formatFn = {
      user            : formatUserXml,
      student         : formatUserXml,      // ← alias
      project_manager : formatManagerXml,
      admin           : formatAdminXml,
    }[role];
    if (!formatFn) {
      const e = new Error(`No XML formatter for role: ${role}`); e.statusCode = 500; throw e;
    }
    return { type: 'xml', data: formatFn(data) };
  }

  // ── PDF ─────────────────────────────────────────────────────
  if (format === 'pdf') {
    const buildFn = {
      user            : buildUserPdf,
      student         : buildUserPdf,       // ← alias
      project_manager : buildManagerPdf,
      admin           : buildAdminPdf,
    }[role];
    if (!buildFn) {
      const e = new Error(`No PDF builder for role: ${role}`); e.statusCode = 500; throw e;
    }
    // buildFn returns a PDFDocument (pdfkit) — caller pipes it to res
    const stream = buildFn(data);
    return { type: 'pdf', stream };
  }

  // Should never reach here due to earlier validation
  const e = new Error('Unhandled format'); e.statusCode = 500; throw e;
}
module.exports = { generate };