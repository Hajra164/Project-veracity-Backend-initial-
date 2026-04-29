'use strict';

const router     = require('express').Router();

// ── Auth middleware (from root middleware/auth.js) ────────────
const { verifyToken, requireRole, requireTier } = require('../../middleware/auth');

// ── Report-specific middleware ────────────────────────────────
const { validateProjectId } = require('../middleware/validation');
const { safePdfStream, safeJson, safeXml } = require('../middleware/stream.handler');

// ── Audit ─────────────────────────────────────────────────────
const { auditLog, AuditStatus } = require('../utils/audit');

// ── Engine ────────────────────────────────────────────────────
const engine = require('../services/report.engine');

// ═══════════════════════════════════════════════════════════════
//  USER ROUTES
//  All routes:  /api/report/my/:projectId/[json|xml|pdf]
//  Auth:        verifyToken (any logged-in user)
//  Role guard:  none — ownership enforced inside user.fetcher
//  Tier guard:  PDF → pro only
// ═══════════════════════════════════════════════════════════════

// ── GET /api/report/my/:projectId/json ────────────────────────
router.get(
  '/:projectId/json',
  verifyToken,
  validateProjectId,
  async (req, res) => {
   const userId = req.user.user_id || req.user.userId;
    const projectId = parseInt(req.params.projectId, 10);

    try {
      const { data } = await engine.generate({
        role: 'user', format: 'json', userId, projectId,
      });

      await auditLog(
        userId, 'REPORT_USER_JSON', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `report_project_${projectId}_${Date.now()}.json`;
      return safeJson(res, data, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_USER_JSON', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.FAILED, err.message
      );
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || 'Failed to generate JSON report.' });
    }
  }
);

// ── GET /api/report/my/:projectId/xml ─────────────────────────
router.get(
  '/:projectId/xml',
  verifyToken,
  validateProjectId,
  async (req, res) => {
   const userId = req.user.user_id || req.user.userId;
    const projectId = parseInt(req.params.projectId, 10);

    try {
      const { data } = await engine.generate({
        role: 'user', format: 'xml', userId, projectId,
      });

      await auditLog(
        userId, 'REPORT_USER_XML', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `report_project_${projectId}_${Date.now()}.xml`;
      return safeXml(res, data, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_USER_XML', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.FAILED, err.message
      );
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || 'Failed to generate XML report.' });
    }
  }
);

// ── GET /api/report/my/:projectId/pdf  (pro only) ─────────────
router.get(
  '/:projectId/pdf',
  verifyToken,
  requireTier('pro'),
  validateProjectId,
  async (req, res) => {
    const userId    = req.user.user_id || req.user.userId;
    const projectId = parseInt(req.params.projectId, 10);

    try {
      const { stream } = await engine.generate({
        role: 'user', format: 'pdf', userId, projectId,
      });

      await auditLog(
        userId, 'REPORT_USER_PDF', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `report_project_${projectId}_${Date.now()}.pdf`;
      return safePdfStream(stream, res, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_USER_PDF', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.FAILED, err.message
      );
      const status = err.statusCode || 500;
      if (!res.headersSent) {
        return res.status(status).json({ error: err.message || 'Failed to generate PDF report.' });
      }
    }
  }
);

module.exports = router;