'use strict';
const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { verifyToken } = require('../middleware/auth');

// ── GET /api/dashboard/stats
// Works for all roles — students/users see own data, admin sees system-wide
router.get('/stats', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const role   = req.user.role;

  try {
    // ── ADMIN: system-wide stats ──────────────────────────
    if (role === 'admin') {
      const [scans, riskDist, trends, users, projects] = await Promise.all([
        pool.query('SELECT COUNT(*) AS total FROM predictions'),
        pool.query(`
          SELECT risk_level, COUNT(*) AS count
          FROM predictions GROUP BY risk_level`),
        pool.query(`
          SELECT DATE_TRUNC('day', created_at)::date AS date,
                 SUM(CASE WHEN risk_level='LOW'      THEN 1 ELSE 0 END) AS low,
                 SUM(CASE WHEN risk_level='MEDIUM'   THEN 1 ELSE 0 END) AS medium,
                 SUM(CASE WHEN risk_level='HIGH'     THEN 1 ELSE 0 END) AS high,
                 SUM(CASE WHEN risk_level='CRITICAL' THEN 1 ELSE 0 END) AS critical
          FROM predictions
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY date ORDER BY date ASC`),
        pool.query('SELECT COUNT(*) AS total FROM users'),
        pool.query('SELECT COUNT(*) AS total FROM projects WHERE is_archived = false')
      ]);

      const total = parseInt(scans.rows[0].total);
      const byRisk = {};
      riskDist.rows.forEach(r => { byRisk[r.risk_level] = parseInt(r.count); });

      return res.json({
        totalPredictions:         total,
        totalProjects:            parseInt(projects.rows[0].total),
        totalUsers:               parseInt(users.rows[0].total),
        highRiskCount:            byRisk['HIGH']     || 0,
        mediumRiskCount:          byRisk['MEDIUM']   || 0,
        lowRiskCount:             byRisk['LOW']      || 0,
        criticalRiskCount:        byRisk['CRITICAL'] || 0,
        averageDefectProbability: total > 0
          ? parseFloat(((byRisk['HIGH'] || 0) * 0.65 / total).toFixed(4))
          : 0,
        riskTrends:  trends.rows,
        defectStats: trends.rows
      });
    }

    // ── PROJECT MANAGER: all projects stats ───────────────
    if (role === 'project_manager') {
      const [scans, riskDist, trends, projects] = await Promise.all([
        pool.query('SELECT COUNT(*) AS total FROM predictions'),
        pool.query(`
          SELECT risk_level, COUNT(*) AS count
          FROM predictions GROUP BY risk_level`),
        pool.query(`
          SELECT DATE_TRUNC('day', p.created_at)::date AS date,
                 SUM(CASE WHEN p.risk_level='LOW'      THEN 1 ELSE 0 END) AS low,
                 SUM(CASE WHEN p.risk_level='MEDIUM'   THEN 1 ELSE 0 END) AS medium,
                 SUM(CASE WHEN p.risk_level='HIGH'     THEN 1 ELSE 0 END) AS high,
                 SUM(CASE WHEN p.risk_level='CRITICAL' THEN 1 ELSE 0 END) AS critical
          FROM predictions p
          WHERE p.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY date ORDER BY date ASC`),
        pool.query('SELECT COUNT(*) AS total FROM projects WHERE is_archived = false')
      ]);

      const total = parseInt(scans.rows[0].total);
      const byRisk = {};
      riskDist.rows.forEach(r => { byRisk[r.risk_level] = parseInt(r.count); });

      return res.json({
        totalPredictions:         total,
        totalProjects:            parseInt(projects.rows[0].total),
        highRiskCount:            byRisk['HIGH']     || 0,
        mediumRiskCount:          byRisk['MEDIUM']   || 0,
        lowRiskCount:             byRisk['LOW']      || 0,
        criticalRiskCount:        byRisk['CRITICAL'] || 0,
        averageDefectProbability: 0,
        riskTrends:               trends.rows,
        defectStats:              trends.rows
      });
    }

    // ── STUDENT / USER: own data only ─────────────────────
    const [predictions, trends, projects] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN p.risk_level='HIGH'     THEN 1 ELSE 0 END) AS high,
          SUM(CASE WHEN p.risk_level='MEDIUM'   THEN 1 ELSE 0 END) AS medium,
          SUM(CASE WHEN p.risk_level='LOW'      THEN 1 ELSE 0 END) AS low,
          SUM(CASE WHEN p.risk_level='CRITICAL' THEN 1 ELSE 0 END) AS critical,
          ROUND(AVG(p.risk_score)::numeric, 4)  AS avg_risk
        FROM predictions p
        JOIN projects pr ON p.project_id = pr.project_id
        WHERE pr.user_id = $1`, [userId]),

      pool.query(`
        SELECT DATE_TRUNC('day', p.created_at)::date AS date,
               SUM(CASE WHEN p.risk_level='LOW'      THEN 1 ELSE 0 END) AS low,
               SUM(CASE WHEN p.risk_level='MEDIUM'   THEN 1 ELSE 0 END) AS medium,
               SUM(CASE WHEN p.risk_level='HIGH'     THEN 1 ELSE 0 END) AS high,
               SUM(CASE WHEN p.risk_level='CRITICAL' THEN 1 ELSE 0 END) AS critical
        FROM predictions p
        JOIN projects pr ON p.project_id = pr.project_id
        WHERE pr.user_id = $1
          AND p.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY date ORDER BY date ASC`, [userId]),

      pool.query(`
        SELECT COUNT(*) AS total FROM projects
        WHERE user_id = $1 AND is_archived = false`, [userId])
    ]);

    const r = predictions.rows[0];
    return res.json({
      totalPredictions:         parseInt(r.total),
      totalProjects:            parseInt(projects.rows[0].total),
      highRiskCount:            parseInt(r.high     || 0),
      mediumRiskCount:          parseInt(r.medium   || 0),
      lowRiskCount:             parseInt(r.low      || 0),
      criticalRiskCount:        parseInt(r.critical || 0),
      averageDefectProbability: parseFloat(r.avg_risk || 0),
      riskTrends:               trends.rows,
      defectStats:              trends.rows
    });

  } catch (err) {
    console.error('Dashboard stats error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;