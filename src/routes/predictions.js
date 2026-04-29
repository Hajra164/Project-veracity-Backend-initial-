'use strict';
const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { verifyToken } = require('../middleware/auth');

// ── GET /api/predictions — paginated, filterable
router.get('/', verifyToken, async (req, res) => {
  const userId     = req.user.user_id || req.user.id;
  const role       = req.user.role;
  const page       = Math.max(1, parseInt(req.query.page)  || 1);
  const limit      = Math.min(100, parseInt(req.query.limit) || 10);
  const offset     = (page - 1) * limit;
  const riskFilter = req.query.risk_level?.toUpperCase();
  const filterSQL  = riskFilter ? `AND p.risk_level = '${riskFilter}'` : '';

  try {
    // Admin/PM see all predictions; users/students see only their own
    const ownerFilter = (role === 'admin' || role === 'project_manager')
      ? '' : `AND pr.user_id = ${userId}`;

    const [data, count] = await Promise.all([
      pool.query(`
        SELECT p.prediction_id AS id, p.project_id,
               p.risk_level, p.risk_score AS defect_probability,
               p.model_version, p.created_at,
               pr.project_name AS file_path
        FROM predictions p
        JOIN projects pr ON p.project_id = pr.project_id
        WHERE 1=1 ${ownerFilter} ${filterSQL}
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2`, [limit, offset]),

      pool.query(`
        SELECT COUNT(*) AS total FROM predictions p
        JOIN projects pr ON p.project_id = pr.project_id
        WHERE 1=1 ${ownerFilter} ${filterSQL}`)
    ]);

    const total = parseInt(count.rows[0].total);
    res.json({
      predictions: data.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/predictions/:id — full detail with metrics + SHAP
router.get('/:id', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const role   = req.user.role;

  try {
    const pred = await pool.query(`
      SELECT p.prediction_id AS id, p.project_id,
             p.risk_level, p.risk_score AS defect_probability,
             p.model_version, p.created_at,
             pr.project_name AS file_path, pr.user_id
      FROM predictions p
      JOIN projects pr ON p.project_id = pr.project_id
      WHERE p.prediction_id = $1`, [req.params.id]);

    if (pred.rows.length === 0)
      return res.status(404).json({ error: 'Prediction not found.' });

    // Ownership check for students/users
    if (['user', 'student'].includes(role) && pred.rows[0].user_id !== userId)
      return res.status(403).json({ error: 'Access denied.' });

    const [metrics, shap] = await Promise.all([
      pool.query(
        'SELECT metric_name, metric_value FROM code_metrics WHERE prediction_id = $1',
        [req.params.id]),
      pool.query(
        `SELECT feature_name, feature_value, shap_value, feature_rank
         FROM shap_explanations WHERE prediction_id = $1
         ORDER BY feature_rank ASC`, [req.params.id])
    ]);

    // Flatten metrics into object: { loc: 45, v(g): 12, ... }
    const metricsObj = {};
    metrics.rows.forEach(m => { metricsObj[m.metric_name] = m.metric_value; });

    res.json({
      id:                 pred.rows[0].id,
      defect_probability: pred.rows[0].defect_probability,
      risk_level:         pred.rows[0].risk_level?.toLowerCase(),
      file_path:          pred.rows[0].file_path,
      created_at:         pred.rows[0].created_at,
      metrics:            metricsObj,
      top_risk_features:  shap.rows.map(s => ({
        feature_name:   s.feature_name,
        shap_value:     parseFloat(s.shap_value),
        feature_value:  parseFloat(s.feature_value),
        impact:         s.shap_value > 0 ? 'positive' : 'negative',
        abs_shap_value: Math.abs(s.shap_value)
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;