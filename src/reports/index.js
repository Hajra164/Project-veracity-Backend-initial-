'use strict';

/**
 * reports/index.js
 *
 * Entry point for the entire reports sub-system.
 * Mounted in src/index.js (the main app) as:
 *
 *   const reportRoutes = require('./reports');
 *   app.use('/api/report', reportRoutes);
 *
 * This file:
 *   1. Creates a top-level Express router.
 *   2. Mounts the three role-scoped route files.
 *   3. Exports the router — nothing else.
 *
 * Final URL structure:
 *   /api/report/my/:projectId/json     → user.routes.js
 *   /api/report/my/:projectId/xml      → user.routes.js
 *   /api/report/my/:projectId/pdf      → user.routes.js  (pro only)
 *
 *   /api/report/manager/json           → manager.routes.js (PM + admin)
 *   /api/report/manager/xml            → manager.routes.js
 *   /api/report/manager/pdf            → manager.routes.js (pro tier)
 *
 *   /api/report/admin/json             → admin.routes.js  (admin only)
 *   /api/report/admin/xml              → admin.routes.js
 *   /api/report/admin/pdf              → admin.routes.js  (always pro)
 * 
 *   /api/report/student/:projectId/json   → student.routes.js  (free)
 *   /api/report/student/:projectId/xml    → student.routes.js  (free)
 *   /api/report/student/:projectId/pdf    → student.routes.js  (free — no tier gate)
 */

const express = require('express');
const router  = express.Router();

// ── Role-scoped sub-routers ────────────────────────────────────────────────
const userRoutes    = require('./routes/user.routes');
const managerRoutes = require('./routes/manager.routes');
const adminRoutes   = require('./routes/admin.routes');
const studentRoutes = require('./routes/student.routes');

// ── Mount points ───────────────────────────────────────────────────────────
router.use('/my',      userRoutes);      // /api/report/my/:projectId/*
router.use('/manager', managerRoutes);   // /api/report/manager/*
router.use('/admin',   adminRoutes);     // /api/report/admin/*
router.use('/student', studentRoutes);   // /api/report/student/:projectId/* 

// ── 404 catch-all for unknown /api/report/* paths ─────────────────────────
router.use((req, res) => {
  res.status(404).json({
    error: `Report endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

module.exports = router;