const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const DBA_ONLY = [verifyToken, requireRole('admin')];


// GET /api/admin/users — list all users
router.get('/users', ...DBA_ONLY, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, email, full_name, role, tier, is_active,
              is_email_verified, created_at, last_login_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});


// GET /api/admin/users/:id — single user detail
router.get('/users/:id', ...DBA_ONLY, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, email, full_name, role, tier, is_active,
              is_email_verified, created_at, last_login_at
       FROM users WHERE user_id = $1`,
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'User not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/admin/users/:id — update role/tier/status
router.put('/users/:id', ...DBA_ONLY, async (req, res) => {
  const { role, tier, is_active } = req.body;
  const validRoles = ['user', 'student', 'project_manager', 'admin'];
  const validTiers = ['free', 'pro'];

  if (role && !validRoles.includes(role))
    return res.status(400).json({ error: 'Invalid role.' });
  if (tier && !validTiers.includes(tier))
    return res.status(400).json({ error: 'Invalid tier.' });
  if (!role && !tier && is_active === undefined)
    return res.status(400).json({ error: 'Nothing to update.' });

  try {
    const result = await pool.query(
      `UPDATE users
       SET role      = COALESCE($1, role),
           tier      = COALESCE($2, tier),
           is_active = COALESCE($3, is_active),
           updated_at = NOW()
       WHERE user_id = $4
       RETURNING user_id, email, full_name, role, tier, is_active`,
      [role || null, tier || null, is_active ?? null, req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User updated.', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/admin/users/:id — hard delete user
router.delete('/users/:id', ...DBA_ONLY, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM users WHERE user_id = $1 RETURNING user_id, email',
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User deleted.', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/admin/projects — paginated all projects
router.get('/projects', ...DBA_ONLY, async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;

  try {
    const [data, count] = await Promise.all([
      pool.query(
        `SELECT p.project_id, p.project_name, p.project_description,
                p.file_size_bytes, p.is_archived, p.analysis_count,
                p.latest_prediction_id, p.created_at, p.updated_at,
                u.user_id, u.email, u.full_name, u.role AS user_role
         FROM projects p
         JOIN users u ON p.user_id = u.user_id
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) AS total FROM projects'),
    ]);

    const total = parseInt(count.rows[0].total);
    res.json({
      projects: data.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});
// ── GET /api/admin/logs/:id — single log detail ──────────
router.get('/logs/:id', ...DBA_ONLY, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.email AS user_name, u.role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.user_id
      WHERE a.audit_log_id = $1`, [req.params.id]);

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Log not found.' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/admin/users/:id/role — change user role
router.patch('/users/:id/role', ...DBA_ONLY, async (req, res) => {
  const { role } = req.body;
  const validRoles = ['user', 'project_manager', 'admin'];
  if (!validRoles.includes(role))
    return res.status(400).json({ error: 'Invalid role.' });

  try {
    await pool.query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE user_id = $2',
      [role, req.params.id]
    );
    res.json({ message: `Role updated to ${role}.` });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/admin/users/:id/toggle — activate/deactivate user
router.patch('/users/:id/toggle', ...DBA_ONLY, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = NOT is_active, updated_at = NOW()
       WHERE user_id = $1 RETURNING is_active`,
      [req.params.id]
    );
    const status = result.rows[0].is_active ? 'activated' : 'deactivated';
    res.json({ message: `User ${status}.` });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/admin/analytics — system stats
router.get('/analytics', ...DBA_ONLY, async (req, res) => {
  try {
    const [users, projects, predictions] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, role FROM users GROUP BY role'),
      pool.query('SELECT COUNT(*) as total FROM projects WHERE is_archived = false'),
      pool.query(
        `SELECT risk_level, COUNT(*) as count 
         FROM predictions GROUP BY risk_level`
      )
    ]);

    res.json({
      users: users.rows,
      total_projects: projects.rows[0].total,
      predictions_by_risk: predictions.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});
// ── GET /api/admin/dashboard ─────────────────────────────
router.get('/dashboard', ...DBA_ONLY, async (req, res) => {
  try {
    const [scans, riskDist, trends, failedLogs, users, projects] = await Promise.all([

      pool.query('SELECT COUNT(*) AS total FROM predictions'),

      pool.query(`
        SELECT risk_level, COUNT(*) AS value
        FROM predictions GROUP BY risk_level`),

      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS date,
               COUNT(*) AS scans,
               ROUND(AVG(risk_score)::numeric, 2) AS avg_risk
        FROM predictions
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at) ASC
        LIMIT 12`),

      pool.query(`
       SELECT COUNT(*) AS count FROM audit_logs
       WHERE status = 'FAILED'
       AND action LIKE 'PROJECT_%'`),


      pool.query('SELECT COUNT(*) AS total FROM users'),

      pool.query(`
       SELECT 
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_archived = false) AS active,
       COUNT(*) FILTER (WHERE is_archived = true) AS archived
       FROM projects`)
    ]);

   const totalScans  = parseInt(scans.rows[0].total);
   const failedCount = parseInt(failedLogs.rows[0].count);
   const successCount = Math.max(0, totalScans - failedCount);

    // Map colors for frontend pie chart
    const colorMap = {
      LOW:      '#14a085',
      MEDIUM:   '#f59e0b',
      HIGH:     '#ff9500',
      CRITICAL: '#ff4444'
    };

    res.json({
      totalScans,
      successfulScans: successCount,
      failedScans:     failedCount,
      totalUsers:       parseInt(users.rows[0].total),
      totalProjects:    parseInt(projects.rows[0].total),
      activeProjects:   parseInt(projects.rows[0].active),
      archivedProjects: parseInt(projects.rows[0].archived),
      avgRisk:          totalScans > 0
        ? parseFloat((riskDist.rows.reduce((sum, r) => {
            const w = r.risk_level === 'HIGH' ? 0.65
                    : r.risk_level === 'CRITICAL' ? 0.88
                    : r.risk_level === 'MEDIUM' ? 0.37 : 0.12;
            return sum + (w * parseInt(r.value));
          }, 0) / totalScans).toFixed(2))
        : 0,
      riskDistribution: riskDist.rows.map(r => ({
        name:  r.risk_level,
        value: parseInt(r.value),
        color: colorMap[r.risk_level] || '#999'
      })),
      scanTrends: trends.rows
    });
  } catch (err) {
    console.error('Admin dashboard error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/admin/logs — paginated audit logs ───────────
router.get('/logs', ...DBA_ONLY, async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;

  try {
    const [data, count] = await Promise.all([
      pool.query(`
        SELECT
          a.audit_log_id  AS id,
          a.user_id,
          a.action,
          a.resource_type,
          a.resource_id   AS project_id,
          a.status,
          a.ip_address,
          a.error_message,
          a.created_at    AS timestamp,
          u.email         AS user_name,
          u.role
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.user_id
        ORDER BY a.created_at DESC
        LIMIT $1 OFFSET $2`, [limit, offset]),

      pool.query('SELECT COUNT(*) AS total FROM audit_logs')
    ]);

    const total = parseInt(count.rows[0].total);
    res.json({
      logs:  data.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Admin logs error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/admin/metrics ───────────────────────────────────
// Returns distinct metric names + their stats from code_metrics
router.get('/metrics', ...DBA_ONLY, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        cm.metric_name                            AS name,
        ROUND(AVG(cm.metric_value)::numeric, 4)  AS avg_value,
        ROUND(MIN(cm.metric_value)::numeric, 4)  AS min_value,
        ROUND(MAX(cm.metric_value)::numeric, 4)  AS max_value,
        COUNT(*)::int                             AS total_records,
        cm.extraction_method,
        cm.metric_unit
      FROM code_metrics cm
      GROUP BY cm.metric_name, cm.extraction_method, cm.metric_unit
      ORDER BY cm.metric_name ASC`
    );

    res.json({ metrics: result.rows });
  } catch (err) {
    console.error('GET /admin/metrics error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/admin/metrics/rules ────────────────────────────
// Returns mitigation rules — the actual configurable thresholds
router.get('/metrics/rules', ...DBA_ONLY, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        rule_id         AS id,
        risk_driver     AS metric_name,
        threshold_low,
        threshold_high,
        mitigation_advice,
        priority,
        is_active,
        version,
        created_at,
        updated_at
      FROM mitigation_rules
      ORDER BY priority DESC, risk_driver ASC`
    );

    res.json({ rules: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('GET /admin/metrics/rules error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PUT /api/admin/metrics/rules/:id ────────────────────────
// Update threshold, advice, priority, or active status
router.put('/metrics/rules/:id', ...DBA_ONLY, async (req, res) => {
  const { threshold_low, threshold_high, mitigation_advice, priority, is_active } = req.body;

  const validPriorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  if (priority && !validPriorities.includes(priority))
    return res.status(400).json({ error: 'Invalid priority. Must be CRITICAL, HIGH, MEDIUM or LOW.' });

  if (
    threshold_low  === undefined &&
    threshold_high === undefined &&
    mitigation_advice === undefined &&
    priority       === undefined &&
    is_active      === undefined
  ) return res.status(400).json({ error: 'Nothing to update.' });

  // Validate threshold range if both provided
  if (threshold_low !== undefined && threshold_high !== undefined) {
    if (parseFloat(threshold_low) >= parseFloat(threshold_high))
      return res.status(400).json({ error: 'threshold_low must be less than threshold_high.' });
  }

  try {
    const result = await pool.query(`
      UPDATE mitigation_rules
      SET
        threshold_low     = COALESCE($1, threshold_low),
        threshold_high    = COALESCE($2, threshold_high),
        mitigation_advice = COALESCE($3, mitigation_advice),
        priority          = COALESCE($4, priority),
        is_active         = COALESCE($5, is_active),
        version           = version + 1,
        updated_at        = NOW()
      WHERE rule_id = $6
      RETURNING
        rule_id         AS id,
        risk_driver     AS metric_name,
        threshold_low,
        threshold_high,
        mitigation_advice,
        priority,
        is_active,
        version,
        updated_at`,
      [
        threshold_low  ?? null,
        threshold_high ?? null,
        mitigation_advice || null,
        priority       || null,
        is_active      ?? null,
        req.params.id
      ]
    );

    if (!result.rows.length)
      return res.status(404).json({ error: 'Rule not found.' });

    res.json({ message: 'Rule updated.', rule: result.rows[0] });
  } catch (err) {
    console.error('PUT /admin/metrics/rules/:id error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});
module.exports = router;
