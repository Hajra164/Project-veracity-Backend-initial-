'use strict';

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const pool    = require('../db');
const { verifyToken } = require('../middleware/auth');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

// ─────────────────────────────────────────────
// POST /api/refactor/:projectId
// Generate improved version of user code
// ─────────────────────────────────────────────
router.post('/:projectId', verifyToken, async (req, res) => {
  const userId    = req.user.user_id || req.user.id;
  const projectId = req.params.projectId;
  const tier      = req.user.tier;
  const role      = req.user.role;

  // ── Pro only (students also allowed) ─────────
  if (tier === 'free' && role !== 'admin' && role !== 'student') {
    return res.status(403).json({
      error            : 'Code refactoring requires Pro tier.',
      upgrade_required : true
    });
  }

  try {
    // ── Fetch project ─────────────────────────
    let projectResult;
    if (role === 'admin' || role === 'project_manager') {
      projectResult = await pool.query(
        `SELECT source_code, project_name, latest_prediction_id
         FROM projects
         WHERE project_id = $1`,
        [projectId]
      );
    } else {
      projectResult = await pool.query(
        `SELECT source_code, project_name, latest_prediction_id
         FROM projects
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, userId]
      );
    }

    if (!projectResult.rows.length)
      return res.status(404).json({ error: 'Project not found.' });

    const project = projectResult.rows[0];

    // ── Buffer fix ────────────────────────────
    const sourceCode = Buffer.isBuffer(project.source_code)
      ? project.source_code.toString('utf8')
      : String(project.source_code);

    // ── SHAP context ──────────────────────────
    let shapContext = '';
    if (project.latest_prediction_id) {
      const shapResult = await pool.query(
        `SELECT feature_name, shap_value, feature_value
         FROM shap_explanations
         WHERE prediction_id = $1
         ORDER BY feature_rank ASC LIMIT 5`,
        [project.latest_prediction_id]
      );

      const metricsResult = await pool.query(
        `SELECT metric_name, metric_value
         FROM code_metrics
         WHERE prediction_id = $1`,
        [project.latest_prediction_id]
      );

      shapContext = `
Top Risk Factors (SHAP):
${shapResult.rows.map(r =>
  `- ${r.feature_name}: ${r.shap_value > 0 ? 'increases' : 'decreases'} risk (value: ${r.feature_value})`
).join('\n')}

Current Metrics:
${metricsResult.rows.map(r =>
  `- ${r.metric_name}: ${r.metric_value}`
).join('\n')}`;
    }

    // ── Groq prompt ───────────────────────────
    const prompt = `You are an expert Python code quality engineer.

Analyze and improve the following Python code to reduce complexity and bug risk.

${shapContext}

ORIGINAL CODE:
\`\`\`python
${sourceCode}
\`\`\`

Your task:
1. Reduce cyclomatic complexity (break large functions)
2. Improve readability (better variable names, add docstrings)
3. Reduce nesting levels (use early returns, guard clauses)
4. Keep the same functionality — do NOT change behavior

Respond in this EXACT format:
---IMPROVED_CODE---
[your improved python code here]
---EXPLANATION---
[bullet points explaining what you changed and why]
---METRICS_ESTIMATE---
[estimate: CC Before/After, LOC change, complexity reduction %]`;

    // ── Call Groq ─────────────────────────────
    const groqResponse = await axios.post(
      GROQ_URL,
      {
        model      : GROQ_MODEL,
        messages   : [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens : 2048,
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type' : 'application/json',
        },
        timeout: 25000,
      }
    );

    const rawResponse = groqResponse.data.choices[0].message.content;

    // ── Parse response ────────────────────────
    const improvedCodeMatch = rawResponse.match(
      /---IMPROVED_CODE---([\s\S]*?)---EXPLANATION---/
    );
    const explanationMatch = rawResponse.match(
      /---EXPLANATION---([\s\S]*?)---METRICS_ESTIMATE---/
    );
    const metricsMatch = rawResponse.match(
      /---METRICS_ESTIMATE---([\s\S]*?)$/
    );

    const improvedCode = improvedCodeMatch?.[1]?.trim()
      .replace(/```python\n?/, '').replace(/\n?```$/, '').trim()
      || rawResponse;
    const explanation     = explanationMatch?.[1]?.trim() || 'Improvements applied.';
    const metricsEstimate = metricsMatch?.[1]?.trim()     || 'Metrics improved.';

    // ── Audit log ─────────────────────────────
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, resource_type, resource_id, status, ip_address)
       VALUES ($1, 'CODE_REFACTOR', 'project', $2, 'SUCCESS', $3)`,
      [userId, projectId, req.ip]
    );

    return res.status(200).json({
      project_id      : projectId,
      project_name    : project.project_name,
      original_code   : sourceCode,
      improved_code   : improvedCode,
      explanation     : explanation,
      metrics_estimate: metricsEstimate,
      generated_at    : new Date().toISOString(),
    });

  } catch (err) {
    console.error('Refactor error:', err.message);
    if (err.response?.status === 429)
      return res.status(429).json({ error: 'AI rate limit. Please wait.' });
    return res.status(500).json({ error: 'Failed to generate refactored code.' });
  }
});

module.exports = router;
