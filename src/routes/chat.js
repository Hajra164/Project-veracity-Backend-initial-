'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const pool    = require('../db');
const { verifyToken } = require('../middleware/auth');
require('dotenv').config();

// ── POST /api/chat/start ─────────────────────────────────
router.post('/start', verifyToken, async (req, res) => {
  const { session_id, risk_level, top_features } = req.body;
  const user_name = req.user.email;

  if (!session_id || !risk_level || !top_features)
    return res.status(400).json({ error: 'session_id, risk_level, top_features required.' });

  try {
    const mlRes = await axios.post(
      `${process.env.ML_WORKER_URL}/chat/start`,
      { session_id, risk_level, top_features, user_name },
      { timeout: 30000 }
    );
    res.json(mlRes.data);
  } catch (err) {
    console.error('Chat start error:', err.message);
    res.status(500).json({ error: 'Chatbot unavailable.' });
  }
});

// ── POST /api/chat/message ───────────────────────────────
router.post('/message', verifyToken, async (req, res) => {
  const { session_id, message } = req.body;
  const user_name = req.user.email;

  if (!session_id || !message)
    return res.status(400).json({ error: 'session_id and message required.' });

  try {
    const mlRes = await axios.post(
      `${process.env.ML_WORKER_URL}/chat/message`,
      { session_id, message, user_name },
      { timeout: 30000 }
    );
    res.json(mlRes.data);
  } catch (err) {
    console.error('Chat message error:', err.message);
    res.status(500).json({ error: 'Chatbot unavailable.' });
  }
});

// ── POST /api/chat/reset ─────────────────────────────────
router.post('/reset', verifyToken, async (req, res) => {
  const { session_id } = req.body;

  if (!session_id)
    return res.status(400).json({ error: 'session_id required.' });

  try {
    const mlRes = await axios.post(
      `${process.env.ML_WORKER_URL}/chat/reset?session_id=${session_id}`,
      {},
      { timeout: 30000 }
    );
    res.json(mlRes.data);
  } catch (err) {
    console.error('Chat reset error:', err.message);
    res.status(500).json({ error: 'Chatbot unavailable.' });
  }
});

// ── POST /api/chat — legacy DB-based quick advice ────────
// Keep this for backward compatibility
router.post('/', verifyToken, async (req, res) => {
  const { projectId } = req.body;

  if (!projectId)
    return res.status(400).json({ error: 'projectId is required.' });

  try {
    const shapResult = await pool.query(
      `SELECT se.feature_name FROM shap_explanations se
       JOIN predictions p ON se.prediction_id = p.prediction_id
       WHERE p.project_id = $1 ORDER BY se.feature_rank ASC LIMIT 5`,
      [projectId]
    );

    const features = shapResult.rows.map(r => r.feature_name);
    if (features.length === 0)
      return res.json({ reply: 'No analysis found. Please run an analysis first.' });

    const placeholders = features.map((_, i) => `$${i + 1}`).join(', ');
    const rulesResult = await pool.query(
      `SELECT risk_driver, mitigation_advice FROM mitigation_rules
       WHERE risk_driver IN (${placeholders}) AND is_active = true`,
      features
    );

    if (rulesResult.rows.length === 0)
      return res.json({ reply: 'No specific advice found for detected risk factors.' });

    const advice = rulesResult.rows.map(r =>
      `• ${r.risk_driver}: ${r.mitigation_advice}`
    ).join('\n');

    res.json({
      reply: `Based on your analysis, here are the top risks:\n\n${advice}`,
      features
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;