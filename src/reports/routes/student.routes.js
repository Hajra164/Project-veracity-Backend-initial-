'use strict';

const router     = require('express').Router();

// ── Auth middleware (from root middleware/auth.js) ────────────
const { verifyToken, requireRole, requireTier, requirePdfAccess } = require('../../middleware/auth');

// ── Report-specific middleware ────────────────────────────────
const { validateProjectId } = require('../middleware/validation');
const { safePdfStream, safeJson, safeXml } = require('../middleware/stream.handler');

// ── Audit ─────────────────────────────────────────────────────
const { auditLog, AuditStatus } = require('../utils/audit');

// ── Engine ────────────────────────────────────────────────────
const engine = require('../services/report.engine');

// ═══════════════════════════════════════════════════════════════
//  STUDENT ROUTES
//  All routes:  /api/report/student/:projectId/[json|xml|pdf]
//  Auth:        verifyToken + role must be 'student'
//  Tier guard:  NONE — students get PDF for free
// ═══════════════════════════════════════════════════════════════

// ── GET /api/report/student/:projectId/json ───────────────────
router.get(
  '/:projectId/json',
  verifyToken,
  requireRole('student'),
  validateProjectId,
  async (req, res) => {
    const userId    = req.user.user_id || req.user.userId;
    const projectId = parseInt(req.params.projectId, 10);

    try {
      const { data } = await engine.generate({
        role: 'student', format: 'json', userId, projectId,
      });

      await auditLog(
        userId, 'REPORT_STUDENT_JSON', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `report_student_${projectId}_${Date.now()}.json`;
      return safeJson(res, data, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_STUDENT_JSON', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.FAILED, err.message
      );
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || 'Failed to generate JSON report.' });
    }
  }
);

// ── GET /api/report/student/:projectId/xml ────────────────────
router.get(
  '/:projectId/xml',
  verifyToken,
  requireRole('student'),
  validateProjectId,
  async (req, res) => {
    const userId    = req.user.user_id || req.user.userId;
    const projectId = parseInt(req.params.projectId, 10);

    try {
      const { data } = await engine.generate({
        role: 'student', format: 'xml', userId, projectId,
      });

      await auditLog(
        userId, 'REPORT_STUDENT_XML', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `report_student_${projectId}_${Date.now()}.xml`;
      return safeXml(res, data, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_STUDENT_XML', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.FAILED, err.message
      );
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || 'Failed to generate XML report.' });
    }
  }
);

// ── GET /api/report/student/:projectId/pdf ────────────────────
//  No requireTier() here — PDF is free for all students
router.get(
  '/:projectId/pdf',
  verifyToken,
  requireRole('student'),
  validateProjectId,
  async (req, res) => {
    const userId    = req.user.user_id || req.user.userId;
    const projectId = parseInt(req.params.projectId, 10);

    try {
      const { stream } = await engine.generate({
        role: 'student', format: 'pdf', userId, projectId,
      });

      await auditLog(
        userId, 'REPORT_STUDENT_PDF', projectId,
        req.ip, req.headers['user-agent'], AuditStatus.SUCCESS
      );

      const filename = `report_student_${projectId}_${Date.now()}.pdf`;
      return safePdfStream(stream, res, filename);

    } catch (err) {
      await auditLog(
        userId, 'REPORT_STUDENT_PDF', projectId,
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