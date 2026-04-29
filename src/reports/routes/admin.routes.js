'use strict';

const express  = require('express');
const router   = express.Router();

// ── Core infra ────────────────────────────────────────────────────────────────
const { verifyToken, requireRole } = require('../../middleware/auth');

// ── Report-layer middleware / utils ───────────────────────────────────────────
const { safePdfStream, safeJson, safeXml } = require('../middleware/stream.handler');
const { auditLog, AuditStatus }            = require('../utils/audit');

// ── Orchestration engine ──────────────────────────────────────────────────────
const reportEngine = require('../services/report.engine');

// ── Guard: every admin route requires authentication + admin role ──────────────
router.use(verifyToken);
router.use(requireRole('admin'));

// Helper — build a consistent filename
function adminFilename(format) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `admin_report_${ts}.${format}`;
}

// GET /api/report/admin/json
router.get('/json', async (req, res) => {
  const adminId = req.user.user_id;
  const ip      = req.ip;
  const ua      = req.get('user-agent');

  try {
    const result = await reportEngine.generate({
      role  : 'admin',
      format: 'json',
      userId: req.user.user_id,    // ✅ fix 1: userId not user
    });

    await auditLog(adminId, 'ADMIN_REPORT_JSON', 'platform', ip, ua, AuditStatus.SUCCESS);
    return safeJson(res, result.data, adminFilename('json'));  // ✅ fix 2: result.data

  } catch (err) {
    await auditLog(adminId, 'ADMIN_REPORT_JSON', 'platform', ip, ua, AuditStatus.FAILED, err.message);
    if (!res.headersSent) {
      return res.status(err.statusCode || 500).json({ error: 'Failed to generate admin JSON report.' });
    }
  }
});

// GET /api/report/admin/xml
router.get('/xml', async (req, res) => {
  const adminId = req.user.user_id;
  const ip      = req.ip;
  const ua      = req.get('user-agent');

  try {
    const result = await reportEngine.generate({
      role  : 'admin',
      format: 'xml',
      userId: req.user.user_id,    // ✅ fix 1
    });

    await auditLog(adminId, 'ADMIN_REPORT_XML', 'platform', ip, ua, AuditStatus.SUCCESS);
    return safeXml(res, result.data, adminFilename('xml'));  // ✅ fix 2: result.data

  } catch (err) {
    await auditLog(adminId, 'ADMIN_REPORT_XML', 'platform', ip, ua, AuditStatus.FAILED, err.message);
    if (!res.headersSent) {
      return res.status(err.statusCode || 500).json({ error: 'Failed to generate admin XML report.' });
    }
  }
});

// GET /api/report/admin/pdf
router.get('/pdf', async (req, res) => {
  const adminId = req.user.user_id;
  const ip      = req.ip;
  const ua      = req.get('user-agent');

  try {
    const result = await reportEngine.generate({
      role  : 'admin',
      format: 'pdf',
      userId: req.user.user_id,    // ✅ fix 1
    });

    await auditLog(adminId, 'ADMIN_REPORT_PDF', 'platform', ip, ua, AuditStatus.SUCCESS);
    return safePdfStream(result.stream, res, adminFilename('pdf'));  // ✅ fix 2: result.stream

  } catch (err) {
    await auditLog(adminId, 'ADMIN_REPORT_PDF', 'platform', ip, ua, AuditStatus.FAILED, err.message);
    if (!res.headersSent) {
      return res.status(err.statusCode || 500).json({ error: 'Failed to generate admin PDF report.' });
    }
  }
});




module.exports = router;
