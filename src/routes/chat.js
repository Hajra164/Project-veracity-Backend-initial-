'use strict';

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const pool    = require('../db');
const { verifyToken } = require('../middleware/auth');

require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ── In-memory session store ───────────────────
// Stores conversation history per session
const sessions = new Map();

// ── Credit limits ─────────────────────────────
const CHAT_LIMITS = {
  free    : 5,
  pro     : Infinity,
  student : Infinity,
  admin   : Infinity,
  project_manager: Infinity,
};

// ─────────────────────────────────────────────
// HELPER — call Groq LLaMA3
// ─────────────────────────────────────────────
async function callGroq(messages) {
  const response = await axios.post(
    GROQ_URL,
    {
      model      : GROQ_MODEL,
      messages,
      temperature: 0.7,
      max_tokens : 1024,
    },
    {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type' : 'application/json',
      },
      timeout: 30000,
    }
  );
  return response.data.choices[0].message.content;
}

// ─────────────────────────────────────────────
// HELPER — build system prompt with project context
// ─────────────────────────────────────────────
function buildSystemPrompt(context) {
  return `You are Vera, an expert AI assistant for Veracity — a software code quality analysis platform.

Your role is to help developers understand their code analysis results and improve code quality.

${context ? `Current project context:
- Project: ${context.project_name || 'Unknown'}
- Risk Level: ${context.risk_level || 'Unknown'}
- Risk Score: ${context.risk_score ? (context.risk_score * 100).toFixed(1) + '%' : 'Unknown'}
- Top Risk Factors: ${context.top_features ? context.top_features.map(f => f.feature || f).join(', ') : 'None'}
- Mitigation Suggestions: ${context.mitigations ? context.mitigations.join(', ') : 'None'}
` : ''}

Guidelines:
- Be concise, technical, and helpful
- Focus on code quality, software engineering best practices
- Explain SHAP values and risk factors in simple terms when asked
- Provide actionable advice to reduce risk score
- If asked about unrelated topics, politely redirect to code quality
- Keep responses under 300 words unless detailed explanation is needed
- Use bullet points for lists of recommendations`;
}

// ─────────────────────────────────────────────
// HELPER — check daily chat limit
// ─────────────────────────────────────────────
async function checkChatLimit(userId, tier) {
  const limit = CHAT_LIMITS[tier] || 5;
  if (limit === Infinity) return { allowed: true, used: 0, limit };

  const today = new Date().toISOString().split('T')[0];
  const result = await pool.query(
    `SELECT COUNT(*) AS count
     FROM audit_logs
     WHERE user_id = $1
       AND action = 'CHAT_MESSAGE'
       AND created_at::date = $2`,
    [userId, today]
  );

  const used = parseInt(result.rows[0].count, 10);
  return {
    allowed : used < limit,
    used,
    limit,
    remaining: limit - used,
  };
}

// ═══════════════════════════════════════════════════════════════
//  POST /api/chat/start
//  Initialize chat session with project context
// ═══════════════════════════════════════════════════════════════
router.post('/start', verifyToken, async (req, res) => {
  const { session_id, project_id, risk_level, top_features } = req.body;
  const userId = req.user.user_id;
  const tier   = req.user.tier || 'free';

  if (!session_id)
    return res.status(400).json({ error: 'session_id is required.' });

  try {
    // ── Check chat limit ──────────────────────
    const limitCheck = await checkChatLimit(userId, tier);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error    : `Daily chat limit reached (${limitCheck.limit} messages/day). Upgrade to Pro for unlimited chat.`,
        limit    : limitCheck.limit,
        used     : limitCheck.used,
        remaining: 0,
      });
    }

    // ── Fetch project context from DB if project_id provided ──
    let context = { risk_level, top_features };

    if (project_id) {
      // chat/start mein ye query update karo
          const projectResult = await pool.query(
          `SELECT p.project_name,
          pr.risk_level, pr.risk_score,
          array_agg(se.feature_name ORDER BY se.shap_value DESC) AS features
          FROM   projects p
          LEFT   JOIN predictions pr ON pr.prediction_id = p.latest_prediction_id
          LEFT   JOIN shap_explanations se ON se.prediction_id = pr.prediction_id
                AND se.is_top_5 = true
                AND se.shap_value > 0    -- ← sirf positive SHAP
         WHERE  p.project_id = $1
         GROUP  BY p.project_name, pr.risk_level, pr.risk_score`,
         [project_id]
         );

      if (projectResult.rows.length) {
        const row = projectResult.rows[0];

        // Get mitigations
        // ── Fetch feature values for threshold check ──
        const featureValResult = await pool.query(
        `SELECT feature_name, feature_value
         FROM shap_explanations
         WHERE prediction_id = (
         SELECT latest_prediction_id FROM projects WHERE project_id = $1
         ) AND shap_value > 0
         ORDER BY shap_value DESC LIMIT 5`,
         [project_id]
          );

        const featureValues = Object.fromEntries(
        featureValResult.rows.map(r => [r.feature_name, parseFloat(r.feature_value)])
        );

        const featureNames = featureValResult.rows.map(r => r.feature_name);

        // ── Fetch matched mitigations with threshold check ──
       const mitResult = await pool.query(
       `SELECT risk_driver, mitigation_advice, threshold_high
       FROM mitigation_rules
       WHERE risk_driver = ANY($1) AND is_active = true`,
       [featureNames]
       );

       const validMitigations = mitResult.rows
       .filter(r => (featureValues[r.risk_driver] || 0) > r.threshold_high)
       .map(r => r.mitigation_advice);

       context = {
       project_name : row.project_name,
       risk_level   : row.risk_level,
       risk_score   : row.risk_score,
       top_features : featureNames,
       mitigations  : validMitigations.length
       ? validMitigations
       : ['Your code metrics are within safe limits. Good job!'],

            // ← ADD THIS for dropdown
      risk_factors : mitResult.rows
      .filter(r => (featureValues[r.risk_driver] || 0) > r.threshold_high)
      .map(r => ({
      feature  : r.risk_driver,
      value    : featureValues[r.risk_driver],
      threshold: r.threshold_high,
      advice   : r.mitigation_advice
      }))
        };
      }
    }

    // ── Build initial conversation ────────────
    const systemPrompt = buildSystemPrompt(context);
    const history = [
      { role: 'system', content: systemPrompt },
    ];

    // ── Generate welcome message ──────────────
    const welcomeMessages = [...history, {
      role   : 'user',
      content: 'Hello, I just started a session. Give me a brief welcome and summary of my project status.',
    }];

    const welcome = await callGroq(welcomeMessages);

    // ── Store session ─────────────────────────
    sessions.set(session_id, {
      userId,
      context,
      history: [
        ...history,
        { role: 'assistant', content: welcome },
      ],
      createdAt: Date.now(),
    });

    // ── Log to audit ──────────────────────────
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, resource_type, resource_id, status, ip_address)
       VALUES ($1, 'CHAT_START', 'chat', $2, 'SUCCESS', $3)`,
      [userId, project_id || null, req.ip]
    );

    return res.status(200).json({
      session_id,
      message  : welcome,
      context,
      limit   : {
        used     : limitCheck.used,
        remaining: limitCheck.limit === Infinity ? 'unlimited' : limitCheck.remaining,
        limit    : limitCheck.limit === Infinity ? 'unlimited' : limitCheck.limit,
      },
    });

  } catch (err) {
    console.error('Chat start error:', err.message);
    return res.status(500).json({ error: 'Failed to start chat session.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/chat/message
//  Send message and get LLM response
// ═══════════════════════════════════════════════════════════════
router.post('/message', verifyToken, async (req, res) => {
  const { session_id, message } = req.body;
  const userId = req.user.user_id;
  const tier   = req.user.tier || 'free';

  if (!session_id || !message)
    return res.status(400).json({ error: 'session_id and message are required.' });

  const safeMessage = String(message).trim();
  if (!safeMessage)
    return res.status(400).json({ error: 'Message cannot be empty.' });

  try {
    // ── Check daily limit ─────────────────────
    const limitCheck = await checkChatLimit(userId, tier);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error    : `Daily chat limit reached (${limitCheck.limit} messages/day). Upgrade to Pro for unlimited chat.`,
        remaining: 0,
      });
    }

    // ── Get or create session ─────────────────
    let session = sessions.get(session_id);
    if (!session) {
      // Session expired or not found — create minimal one
      session = {
        userId,
        context : {},
        history : [{ role: 'system', content: buildSystemPrompt(null) }],
        createdAt: Date.now(),
      };
      sessions.set(session_id, session);
    }

    // ── Add user message to history ───────────
    session.history.push({ role: 'user', content: safeMessage });

    // ── Keep history manageable (last 20 messages + system) ──
    const systemMsg = session.history[0];
    const recentHistory = session.history.slice(-20);
    if (recentHistory[0].role !== 'system') {
      recentHistory.unshift(systemMsg);
    }

    // ── Call Groq ─────────────────────────────
    const reply = await callGroq(recentHistory);

    // ── Add reply to history ──────────────────
    session.history.push({ role: 'assistant', content: reply });

    // ── Log to audit ──────────────────────────
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, resource_type, resource_id, status, ip_address)
       VALUES ($1, 'CHAT_MESSAGE', 'chat', NULL, 'SUCCESS', $2)`,
      [userId, req.ip]
    );

    return res.status(200).json({
      session_id,
      message : reply,
      limit   : {
       used     : limitCheck.used,
       remaining: limitCheck.limit === Infinity ? 'unlimited' : limitCheck.remaining,
       limit    : limitCheck.limit === Infinity ? 'unlimited' : limitCheck.limit,
      },
    });

  } catch (err) {
    console.error('Chat message error:', err.message);

    // Handle Groq API errors gracefully
    if (err.response?.status === 429) {
      return res.status(429).json({ error: 'AI service rate limit reached. Please wait a moment.' });
    }

    return res.status(500).json({ error: 'Failed to get response.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/chat/reset
//  Clear session history
// ═══════════════════════════════════════════════════════════════
router.post('/reset', verifyToken, async (req, res) => {
  const { session_id } = req.body;

  if (!session_id)
    return res.status(400).json({ error: 'session_id is required.' });

  try {
    const session = sessions.get(session_id);

    if (session) {
      // Keep context but clear history
      const systemPrompt = buildSystemPrompt(session.context);
      session.history = [{ role: 'system', content: systemPrompt }];
      sessions.set(session_id, session);
    }

    return res.status(200).json({
      session_id,
      message: 'Chat session reset successfully.',
    });

  } catch (err) {
    console.error('Chat reset error:', err.message);
    return res.status(500).json({ error: 'Failed to reset session.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/chat  — legacy backward compatibility
//  Keep this so existing frontend calls don't break
// ═══════════════════════════════════════════════════════════════
router.post('/', verifyToken, async (req, res) => {
  const { projectId, message } = req.body;
  const userId = req.user.user_id;

  if (!projectId)
    return res.status(400).json({ error: 'projectId is required.' });

  try {
    // ── Fetch only positive SHAP features (actual risk factors) ──
    const shapResult = await pool.query(
      `SELECT se.feature_name, se.shap_value, se.feature_value
       FROM   shap_explanations se
       JOIN   predictions p ON se.prediction_id = p.prediction_id
       WHERE  p.project_id = $1
         AND  se.shap_value > 0
       ORDER  BY se.shap_value DESC LIMIT 5`,
      [projectId]
    );

    const features      = shapResult.rows.map(r => r.feature_name);
    const featureValues = Object.fromEntries(
      shapResult.rows.map(r => [r.feature_name, parseFloat(r.feature_value)])
    );

    // ── Fetch mitigations with threshold ─────
    const mitResult = await pool.query(
      `SELECT risk_driver, mitigation_advice, threshold_high
       FROM   mitigation_rules
       WHERE  risk_driver = ANY($1) AND is_active = true`,
      [features]
    );

    // ── Only show advice if feature exceeds threshold ──
    const validMitigations = mitResult.rows.filter(r => {
      const featureVal = featureValues[r.risk_driver] || 0;
      return featureVal > r.threshold_high;
    });

    const contextStr = validMitigations.length
      ? validMitigations.map(r => `${r.risk_driver}: ${r.mitigation_advice}`).join('\n')
      : 'Your code metrics are within safe limits. Good job!';

    const messages = [
      {
        role   : 'system',
        content: buildSystemPrompt({ top_features: features }),
      },
      {
        role   : 'user',
        content: message || `What are the main risks in my project and how can I fix them? Top features: ${features.join(', ')}. Known mitigations:\n${contextStr}`,
      },
    ];

    const reply = await callGroq(messages);

    return res.json({ reply, features, mitigations: validMitigations });

  } catch (err) {
    console.error('Legacy chat error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Cleanup old sessions every hour ──────────
setInterval(() => {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > ONE_HOUR) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

module.exports = router;
