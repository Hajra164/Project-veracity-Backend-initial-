'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const pool    = require('../db');
const { verifyToken } = require('../middleware/auth');
require('dotenv').config();

router.post('/', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const tier   = req.user.tier || 'free';
  const { code, file_path, project_id } = req.body;

  if (!code || !file_path)
    return res.status(400).json({ error: 'Code and file_path are required.' });

  if (!code.trim())
    return res.status(400).json({ error: 'Code cannot be empty.' });


  //POST http://localhost:5000/api/analysis
  // ── Free tier limit ──────────────────────────────────────
  if (tier === 'free') {
    try {
      const usage = await pool.query(`
        SELECT COUNT(*) AS count
        FROM predictions p
        JOIN projects pr ON p.project_id = pr.project_id
        WHERE pr.user_id = $1
          AND p.created_at >= DATE_TRUNC('month', NOW())`,
        [userId]
      );
      if (parseInt(usage.rows[0].count) >= 10) {
        return res.status(403).json({
          error: 'Monthly limit reached. Upgrade to Pro.',
          code:  'TIER_LIMIT_EXCEEDED'
        });
      }
    } catch (tierErr) {
      // ✅ Don't block analysis if tier check fails
      console.warn('Tier check failed (non-blocking):', tierErr.message);
    }
  }

  // ── Call ML service ──────────────────────────────────────
  console.log(`🔬 Sending to ML: ${file_path} (${code.length} chars)`);
  let ml;
  try {
    const mlRes = await axios.post(
      `${process.env.ML_WORKER_URL}/analyze`,
      { code, filename: file_path },
      {
        timeout: 180000,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    ml = mlRes.data;
    console.log(`✅ ML responded: risk=${ml.risk_level}, prob=${ml.bug_probability}`);
  } catch (err) {
    console.error('ML error:', err.message);

    if (err.code === 'ECONNREFUSED')
      return res.status(503).json({
        error: 'ML service not running. Start uvicorn on port 8080.',
        code:  'ML_UNAVAILABLE'
      });

    if (err.code === 'ECONNABORTED' || err.message.includes('timeout'))
      return res.status(504).json({
        error: 'ML analysis timed out. Try a smaller file.',
        code:  'ML_TIMEOUT'
      });

    if (err.response?.status === 429)
      return res.status(429).json({
        error: 'ML rate limit hit. Wait 1 minute.',
        code:  'RATE_LIMITED'
      });

    if (err.response?.data?.detail)
      return res.status(400).json({ error: err.response.data.detail });

    return res.status(500).json({ error: 'ML service unavailable.' });
  }

  // ── Map to 4-level risk ──────────────────────────────────
  const mapRisk = (prob) => {
    if (prob >= 0.75) return 'CRITICAL';
    if (prob >= 0.50) return 'HIGH';
    if (prob >= 0.25) return 'MEDIUM';
    return 'LOW';
  };
  const riskLevel = mapRisk(ml.bug_probability);

  // ── Save to DB ───────────────────────────────────────────
  let savedId = null;
  let savedAt = new Date().toISOString();

  if (project_id) {
    try {
      const predRow = await pool.query(`
        INSERT INTO predictions
          (project_id, model_version, risk_score, risk_level, is_pro_report)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING prediction_id, created_at`,
        [project_id, 'v2.1', ml.bug_probability, riskLevel, false]
      );
      savedId = predRow.rows[0].prediction_id;
      savedAt = predRow.rows[0].created_at;

      // Save metrics
      await Promise.all(
        Object.entries(ml.features).map(([name, val]) =>
          pool.query(`
            INSERT INTO code_metrics
              (prediction_id, metric_name, metric_value, extraction_method)
            VALUES ($1, $2, $3, $4)`,
            [savedId, name, val, 'radon'])
        )
      );

      // Save SHAP
      const topFeatures = ml.shap_explanation?.top_features ?? [];
      await Promise.all(
        topFeatures.map((f, i) =>
          pool.query(`
            INSERT INTO shap_explanations
              (prediction_id, feature_name, feature_value, shap_value,
               shap_base_value, feature_rank, is_top_5)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [savedId, f.feature, f.metric_value, f.shap_value,
             ml.shap_explanation.base_value, i + 1, true])
        )
      );

      // Update project
      await pool.query(`
        UPDATE projects
        SET latest_prediction_id = $1,
            analysis_count = analysis_count + 1,
            updated_at = NOW()
        WHERE project_id = $2`,
        [savedId, project_id]
      );

      console.log(`✅ Saved prediction ${savedId} for project ${project_id}`);
    } catch (dbErr) {
      console.error('DB save error:', dbErr.message);
      // ✅ Still return ML result even if DB save fails
    }
  }

  // ── Return response ──────────────────────────────────────
  res.status(201).json({
    prediction: {
      id:                 savedId,
      defect_probability: ml.bug_probability,
      risk_level:         riskLevel.toLowerCase(),
      top_risk_features:  (ml.shap_explanation?.top_features ?? []).map(f => ({
        feature_name:   f.feature,
        shap_value:     parseFloat(f.shap_value),
        feature_value:  parseFloat(f.metric_value),
        impact:         f.shap_value > 0 ? 'positive' : 'negative',
        abs_shap_value: Math.abs(f.shap_value)
      })),
      code_snippet: code.slice(0, 500),
      file_path,
      metrics:      ml.features,
      created_at:   savedAt,
      mitigation_advice: ml.mitigation_advice
    }
  });
});

module.exports = router;