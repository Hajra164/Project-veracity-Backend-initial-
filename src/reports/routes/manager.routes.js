'use strict';

const router = require('express').Router();

// ── Auth middleware ───────────────────────────────────────────
const { verifyToken, requireRole, requireTier } = require('../../middleware/auth');

// ── Report-specific middleware ────────────────────────────────
const { safePdfStream, safeJson, safeXml } = require('../middleware/stream.handler');

// ── Audit ─────────────────────────────────────────────────────
const { auditLog, AuditStatus } = require('../utils/audit');

// ── Engine ────────────────────────────────────────────────────
const engine = require('../services/report.engine');

// ═══════════════════════════════════════════════════════════════
//  MANAGER ROUTES
//  All routes:  /api/report/manager/[json|xml|pdf]
//  Auth:        verifyToken
//  Role guard:  project_manager OR admin
//  Tier guard:  PDF → pro only (admin always bypasses)
// ═══════════════════════════════════════════════════════════════

// ── GET /api/report/manager/json ──────────────────────────────
router.get(
  '/json',
  verifyToken,
  requireRole('project_manager', 'admin'),
  async (req, res) => {
    const userId = req.user.user_id || req.user.userId;

    try {
      const { data } = await engine.generate({
        role: 'project_manager', format: 'json', userId,
      });

      await auditLog(
        userId, 'REPORT_MANAGER_JSON', null,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `manager_report_${Date.now()}.json`;
      return safeJson(res, data, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_MANAGER_JSON', null,
        req.ip, req.headers['user-agent'], AuditStatus.FAILED, err.message
      );
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || 'Failed to generate manager JSON report.' });
    }
  }
);

// ── GET /api/report/manager/xml ───────────────────────────────
router.get(
  '/xml',
  verifyToken,
  requireRole('project_manager', 'admin'),
  async (req, res) => {
    const userId = req.user.user_id || req.user.userId;

    try {
      const { data } = await engine.generate({
        role: 'project_manager', format: 'xml', userId,
      });

      await auditLog(
        userId, 'REPORT_MANAGER_XML', null,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `manager_report_${Date.now()}.xml`;
      return safeXml(res, data, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_MANAGER_XML', null,
        req.ip, req.headers['user-agent'], AuditStatus.FAILED, err.message
      );
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || 'Failed to generate manager XML report.' });
    }
  }
);

// ── GET /api/report/manager/pdf  (pro tier only) ──────────────
router.get(
  '/pdf',
  verifyToken,
  requireRole('project_manager', 'admin'),
  requireTier('pro'),                          // admin bypasses via requireTier logic
  async (req, res) => {
    const userId = req.user.user_id || req.user.userId;

    try {
      const { stream } = await engine.generate({
        role: 'project_manager', format: 'pdf', userId,
      });

      await auditLog(
        userId, 'REPORT_MANAGER_PDF', null,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `manager_report_${Date.now()}.pdf`;
      return safePdfStream(stream, res, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_MANAGER_PDF', null,
        req.ip, req.headers['user-agent'], AuditStatus.FAILED, err.message
      );
      const status = err.statusCode || 500;
      if (!res.headersSent) {
        return res.status(status).json({ error: err.message || 'Failed to generate manager PDF report.' });
      }
    }
  }
);

module.exports = router;