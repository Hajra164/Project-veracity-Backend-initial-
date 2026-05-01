const express = require('express');
const router = express.Router();
const pool = require('../db');
const upload = require('../middleware/upload');
const { verifyToken, requireRole } = require('../middleware/auth');
const { analyzeProject } = require('../workers/analysisQueue');
const fs = require('fs');

// ─────────────────────────────────────────────
// HELPER: Audit Logger
// ─────────────────────────────────────────────
const logAudit = async (
  userId, action, resourceType, resourceId,
  status, ipAddress, userAgent, errorMessage = null
) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs 
        (user_id, action, resource_type, resource_id, status, ip_address, user_agent, error_message) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, action, resourceType, resourceId, status, ipAddress, userAgent, errorMessage]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
};
// ─────────────────────────────────────────────
// GET /api/projects/report/all
// Admin-only: system-wide report across ALL projects
// ─────────────────────────────────────────────
router.get('/report/all',
  verifyToken,
  requireRole('admin'),
  async (req, res) => {
    try {
      // All projects with owner info
      const projects = await pool.query(
        `SELECT p.project_id, p.project_name, p.is_archived,
                p.analysis_count, p.created_at,
                u.email, u.full_name, u.role AS user_role
         FROM projects p
         JOIN users u ON p.user_id = u.user_id
         ORDER BY p.created_at DESC`
      );

      // Risk level distribution
      const riskDist = await pool.query(
        `SELECT risk_level, COUNT(*) AS count
         FROM predictions
         GROUP BY risk_level`
      );

      // Total users per role
      const userStats = await pool.query(
        `SELECT role, COUNT(*) AS count FROM users GROUP BY role`
      );

      // Recent audit activity (last 50 events)
      const recentAudit = await pool.query(
        `SELECT user_id, action, resource_type, resource_id, status, created_at
         FROM audit_logs
         ORDER BY created_at DESC
         LIMIT 50`
      );

      // Monthly analysis volume
      const monthlyVolume = await pool.query(
        `SELECT DATE_TRUNC('month', created_at) AS month,
                COUNT(*) AS total_analyses
         FROM predictions
         GROUP BY month
         ORDER BY month DESC
         LIMIT 12`
      );

      return res.json({
        report_type: 'ADMIN_SYSTEM_REPORT',
        generated_at: new Date().toISOString(),
        total_projects: projects.rows.length,
        projects: projects.rows,
        risk_distribution: riskDist.rows,
        user_stats: userStats.rows,
        recent_audit_activity: recentAudit.rows,
        monthly_analysis_volume: monthlyVolume.rows
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error.' });
    }
  }
);
// ─────────────────────────────────────────────
// GET /api/projects
// user        → own projects only (non-archived)
// project_manager → all projects (non-archived) + user info
// admin       → ALL projects including archived + user info
// ─────────────────────────────────────────────
router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  try {
    let result;

    if (req.user.role === 'user' || req.user.role === 'student') {
      // Standard users: only their own non-archived projects
      result = await pool.query(
        `SELECT project_id, user_id, project_name, project_description,
                file_size_bytes, file_encoding, is_archived,
                latest_prediction_id, analysis_count, created_at, updated_at
         FROM projects
         WHERE user_id = $1 AND is_archived = false
         ORDER BY created_at DESC`,
        [userId]
      );

    } else if (req.user.role === 'project_manager') {
      // Project Managers: all non-archived projects with user info
      result = await pool.query(
        `SELECT p.project_id, p.user_id, p.project_name, p.project_description,
                p.file_size_bytes, p.file_encoding, p.is_archived,
                p.latest_prediction_id, p.analysis_count, p.created_at, p.updated_at,
                u.email, u.full_name
         FROM projects p
         JOIN users u ON p.user_id = u.user_id
         WHERE p.is_archived = false
         ORDER BY p.created_at DESC`
      );

    } else if (req.user.role === 'admin') {
      // Admin: ALL projects (including archived) with full user info
      result = await pool.query(
        `SELECT p.project_id, p.user_id, p.project_name, p.project_description,
                p.file_size_bytes, p.file_encoding, p.is_archived,
                p.latest_prediction_id, p.analysis_count, p.created_at, p.updated_at,
                p.archived_at,
                u.email, u.full_name, u.role AS user_role
         FROM projects p
         JOIN users u ON p.user_id = u.user_id
         ORDER BY p.created_at DESC`
      );

    } else {
      return res.status(403).json({ error: 'Access denied.' });
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─────────────────────────────────────────────
// POST /api/projects
// All authenticated roles can upload + trigger analysis
// ─────────────────────────────────────────────
router.post('/', verifyToken, upload.single('file'), async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const { project_name, project_description } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';

  if (!project_name)
    return res.status(400).json({ error: 'Project name is required.' });
  if (!req.file)
    return res.status(400).json({ error: 'No .py file uploaded.' });

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const fileSize = req.file.size;
    const filename = req.file.originalname;

    const result = await pool.query(
      `INSERT INTO projects 
        (user_id, project_name, project_description, source_code, file_size_bytes) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING project_id, user_id, project_name, project_description, file_size_bytes, created_at`,
      [userId, project_name, project_description || null, fileBuffer, fileSize]  // ✅ req.user.id (fixed)
    );

    const project = result.rows[0];

    await logAudit(
      userId,  // ✅ req.user.id (fixed)
      'PROJECT_UPLOAD', 'project', project.project_id,
      'SUCCESS', ip, userAgent
    );

    fs.unlinkSync(req.file.path);

    res.status(201).json({ message: 'Project created. Analysis started.', project });
// Fire-and-forget analysis worker
    analyzeProject(project.project_id, fileBuffer, filename, userId)
      .then(analysis => {
        if (analysis.success) {
          console.log(`✅ Analysis done: project ${project.project_id}, risk: ${analysis.riskLevel}`);
        } else {
          // ✅ NOW you'll see exactly why it fails
          console.error(`❌ Worker failed for project ${project.project_id}:`, analysis.error);
        }
      })
      .catch(err => {
        // ✅ Catches any unhandled crash inside the worker
        console.error(`❌ Worker crashed for project ${project.project_id}:`, err.message);
      });

  } catch (err) {
    console.error(err);
    await logAudit(
      userId,
      'PROJECT_UPLOAD', 'project', null,
      'FAILED', req.ip || 'unknown', req.headers['user-agent'] || 'unknown', err.message
    );
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─────────────────────────────────────────────
// GET /api/projects/:id/results
// user        → own project results only
// project_manager → any project results
// admin       → any project results (including archived)
// ─────────────────────────────────────────────
router.get('/:id/results', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const { id } = req.params;
  try {
    let projectQuery, projectParams;
if (req.user.role === 'user' || req.user.role === 'student') {
   projectQuery = `
        SELECT project_id, user_id, project_name, project_description,
               file_size_bytes, file_encoding, is_archived,
               latest_prediction_id, analysis_count,
               created_at, updated_at, archived_at
        FROM projects
        WHERE project_id = $1 AND user_id = $2`;
      projectParams = [id, userId];  // ✅ userId (fixed)

    } else if (req.user.role === 'project_manager') {
       projectQuery = `
        SELECT project_id, user_id, project_name, project_description,
               file_size_bytes, file_encoding, is_archived,
               latest_prediction_id, analysis_count,
               created_at, updated_at, archived_at
        FROM projects
        WHERE project_id = $1`;
      projectParams = [id];

    } else if (req.user.role === 'admin') {
      // Admin: all projects, no archived filter
       projectQuery = `
        SELECT project_id, user_id, project_name, project_description,
               file_size_bytes, file_encoding, is_archived,
               latest_prediction_id, analysis_count,
               created_at, updated_at, archived_at
        FROM projects
        WHERE project_id = $1`;
      projectParams = [id];

    } else {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const projectResult = await pool.query(projectQuery, projectParams);
    if (projectResult.rows.length === 0)
      return res.status(404).json({ error: 'Project not found.' });

    const prediction = await pool.query(
      'SELECT * FROM predictions WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
      [id]
    );

    let metrics = [];
    let shapExplanations = [];

    if (prediction.rows.length > 0) {
      const predictionId = prediction.rows[0].prediction_id;

      const metricsResult = await pool.query(
        'SELECT * FROM code_metrics WHERE prediction_id = $1',
        [predictionId]
      );
      metrics = metricsResult.rows;

      const shapResult = await pool.query(
        'SELECT * FROM shap_explanations WHERE prediction_id = $1 ORDER BY feature_rank ASC',
        [predictionId]
      );
      shapExplanations = shapResult.rows;
    }

    res.json({
      project: projectResult.rows[0],
      prediction: prediction.rows[0] || null,
      metrics,
      shap_explanations: shapExplanations
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─────────────────────────────────────────────
// GET /api/projects/:id/report
// Generates a structured JSON report per role:
//   user        → own project summary + prediction + SHAP
//   project_manager → full project data + team stats
//   admin       → complete report: all predictions, metrics,
//                  SHAP, audit trail, system-level stats
// ─────────────────────────────────────────────
router.get('/:id/report', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const { id } = req.params;
  try {

    // ── USER REPORT ──────────────────────────────
    if (req.user.role === 'user' || req.user.role === 'student') {
      const projectResult = await pool.query(
        `SELECT project_id, project_name, project_description,
                file_size_bytes, analysis_count, created_at, updated_at
         FROM projects
         WHERE project_id = $1 AND user_id = $2 AND is_archived = false`,
        [id, userId]
      );
      if (projectResult.rows.length === 0)
        return res.status(404).json({ error: 'Project not found.' });

      const prediction = await pool.query(
        'SELECT * FROM predictions WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
        [id]
      );

      let metrics = [], shapExplanations = [];
      if (prediction.rows.length > 0) {
        const predId = prediction.rows[0].prediction_id;
        const metricsRes = await pool.query(
          'SELECT * FROM code_metrics WHERE prediction_id = $1', [predId]
        );
        metrics = metricsRes.rows;

        const shapRes = await pool.query(
          'SELECT * FROM shap_explanations WHERE prediction_id = $1 ORDER BY feature_rank ASC',
          [predId]
        );
        shapExplanations = shapRes.rows;
      }

      return res.json({
        report_type: 'USER_PROJECT_REPORT',
        generated_at: new Date().toISOString(),
        project: projectResult.rows[0],
        latest_prediction: prediction.rows[0] || null,
        code_metrics: metrics,
        shap_top_drivers: shapExplanations
      });
    }

    // ── PROJECT MANAGER REPORT ────────────────────
    if (req.user.role === 'project_manager') {
      const projectResult = await pool.query(
        `SELECT p.project_id, p.project_name, p.project_description,
                p.file_size_bytes, p.analysis_count, p.is_archived,
                p.created_at, p.updated_at,
                u.email, u.full_name
         FROM projects p
         JOIN users u ON p.user_id = u.user_id
         WHERE p.project_id = $1`,
        [id]
      );
      if (projectResult.rows.length === 0)
        return res.status(404).json({ error: 'Project not found.' });

      // All predictions for this project (not just latest)
      const predictions = await pool.query(
        'SELECT prediction_id, risk_level, risk_score, created_at FROM predictions WHERE project_id = $1 ORDER BY created_at DESC',
        [id]
      );

      let metrics = [], shapExplanations = [];
      if (predictions.rows.length > 0) {
        const predId = predictions.rows[0].prediction_id;
        const metricsRes = await pool.query(
          'SELECT * FROM code_metrics WHERE prediction_id = $1', [predId]
        );
        metrics = metricsRes.rows;

        const shapRes = await pool.query(
          'SELECT * FROM shap_explanations WHERE prediction_id = $1 ORDER BY feature_rank ASC',
          [predId]
        );
        shapExplanations = shapRes.rows;
      }

      // Risk trend summary across all analyses
      const riskTrend = predictions.rows.map(p => ({
        prediction_id: p.prediction_id,
        risk_level: p.risk_level,
        risk_score: p.risk_score,
        analysed_at: p.created_at
      }));

      return res.json({
        report_type: 'PROJECT_MANAGER_REPORT',
        generated_at: new Date().toISOString(),
        project: projectResult.rows[0],
        total_analyses: predictions.rows.length,
        latest_prediction: predictions.rows[0] || null,
        risk_trend: riskTrend,
        latest_code_metrics: metrics,
        latest_shap_drivers: shapExplanations
      });
    }

    // ── ADMIN REPORT ──────────────────────────────
    if (req.user.role === 'admin') {
      // Full project record — admin sees archived too
      const projectResult = await pool.query(
       `SELECT p.project_id, p.user_id, p.project_name, p.project_description,
        p.file_size_bytes, p.file_encoding, p.is_archived,
        p.latest_prediction_id, p.analysis_count,
        p.created_at, p.updated_at, p.archived_at,
        u.email, u.full_name, u.role AS user_role
 FROM projects p JOIN users u ON p.user_id = u.user_id
 WHERE p.project_id = $1`,
        [id]
      );
      if (projectResult.rows.length === 0)
        return res.status(404).json({ error: 'Project not found.' });

      // All predictions
      const predictions = await pool.query(
        'SELECT * FROM predictions WHERE project_id = $1 ORDER BY created_at DESC',
        [id]
      );

      // All metrics for every prediction
      let allMetrics = [];
      let allShap = [];
      for (const pred of predictions.rows) {
        const mRes = await pool.query(
          'SELECT * FROM code_metrics WHERE prediction_id = $1', [pred.prediction_id]
        );
        allMetrics.push({ prediction_id: pred.prediction_id, metrics: mRes.rows });

        const sRes = await pool.query(
          'SELECT * FROM shap_explanations WHERE prediction_id = $1 ORDER BY feature_rank ASC',
          [pred.prediction_id]
        );
        allShap.push({ prediction_id: pred.prediction_id, shap_values: sRes.rows });
      }

      // Audit trail for this project
      const auditLogs = await pool.query(
        `SELECT action, status, ip_address, user_agent, error_message, created_at
         FROM audit_logs
         WHERE resource_type = 'project' AND resource_id = $1
         ORDER BY created_at DESC`,
        [id]
      );

      // System-level risk distribution across all projects
      const riskDistribution = await pool.query(
        `SELECT pred.risk_level, COUNT(*) AS count
         FROM predictions pred
         GROUP BY pred.risk_level`
      );

      return res.json({
        report_type: 'ADMIN_FULL_REPORT',
        generated_at: new Date().toISOString(),
        project: projectResult.rows[0],
        total_analyses: predictions.rows.length,
        all_predictions: predictions.rows,
        all_metrics: allMetrics,
        all_shap_explanations: allShap,
        audit_trail: auditLogs.rows,
        system_risk_distribution: riskDistribution.rows
      });
    }

    return res.status(403).json({ error: 'Access denied.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/projects/:id/predictions — predictions for project

router.get('/:id/predictions', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50,  parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;

  try {
    const project = await pool.query(
      'SELECT user_id FROM projects WHERE project_id = $1',
      [req.params.id]
    );
    if (!project.rows.length)
      return res.status(404).json({ error: 'Project not found.' });
    if (project.rows[0].user_id !== userId && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Access denied.' });

    const [data, count] = await Promise.all([
      pool.query(
        `SELECT prediction_id, risk_level, risk_score, model_version,
                inference_duration_ms, shap_computation_duration_ms,
                is_cached, created_at
         FROM predictions
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset]
      ),
      pool.query(
        'SELECT COUNT(*) AS total FROM predictions WHERE project_id = $1',
        [req.params.id]
      ),
    ]);

    const total = parseInt(count.rows[0].total);
    res.json({
      predictions: data.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});


// ─────────────────────────────────────────────
// PATCH /api/projects/:id/archive
// project_manager + admin only
// ─────────────────────────────────────────────
router.patch('/:id/archive',
  verifyToken,
  requireRole('project_manager', 'admin'),
  async (req, res) => {
    const { id } = req.params;
    try {
      const result = await pool.query(
        `UPDATE projects
         SET is_archived = true, archived_at = NOW(), updated_at = NOW()
         WHERE project_id = $1
         RETURNING project_id, project_name`,
        [id]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: 'Project not found.' });

      res.json({ message: 'Project archived.', project: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error.' });
    }
  }
);

// ─────────────────────────────────────────────
// PATCH /api/projects/:id/unarchive
// admin only
// ─────────────────────────────────────────────
router.patch('/:id/unarchive',
  verifyToken,
  requireRole('admin'),
  async (req, res) => {
    const { id } = req.params;
    try {
      const result = await pool.query(
        `UPDATE projects
         SET is_archived = false, archived_at = NULL, updated_at = NOW()
         WHERE project_id = $1
         RETURNING project_id, project_name`,
        [id]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: 'Project not found.' });

      res.json({ message: 'Project unarchived.', project: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error.' });
    }
  }
);


// ─────────────────────────────────────────────
// GET /api/projects/:id
// user        → own project only
// project_manager → any project + user info
// admin       → any project (including archived) + user info
// ─────────────────────────────────────────────
router.get('/:id', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const { id } = req.params;
  try {
    let query, params;

    if (req.user.role === 'user' || req.user.role === 'student') {
      query = `
        SELECT project_id, user_id, project_name, project_description,
               file_size_bytes, is_archived, latest_prediction_id,
               analysis_count, created_at, updated_at
        FROM projects
        WHERE project_id = $1 AND user_id = $2`;
      params = [id, userId];  // ✅ userId (fixed)

    } else if (req.user.role === 'project_manager') {
      query = `
        SELECT p.project_id, p.user_id, p.project_name, p.project_description,
               p.file_size_bytes, p.is_archived, p.latest_prediction_id,
               p.analysis_count, p.created_at, p.updated_at,
               u.email, u.full_name
        FROM projects p
        JOIN users u ON p.user_id = u.user_id
        WHERE p.project_id = $1 AND p.is_archived = false`;
      params = [id];

    } else if (req.user.role === 'admin') {
      // Admin sees everything — including archived projects
      query = `
        SELECT p.project_id, p.user_id, p.project_name, p.project_description,
               p.file_size_bytes, p.is_archived, p.latest_prediction_id,
               p.analysis_count, p.created_at, p.updated_at, p.archived_at,
               u.email, u.full_name, u.role AS user_role
        FROM projects p
        JOIN users u ON p.user_id = u.user_id
        WHERE p.project_id = $1`;
      params = [id];

    } else {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Project not found.' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─────────────────────────────────────────────
// PUT /api/projects/:id
// Update project name or description
// user → own project only
// admin/pm → any project
// ─────────────────────────────────────────────
router.put('/:id', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const { id } = req.params;
  const { project_name, project_description } = req.body;

  if (!project_name && project_description === undefined) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  try {
    let result;

    if (req.user.role === 'user' || req.user.role === 'student') {
      // Users can only update their own projects
      result = await pool.query(
        `UPDATE projects
         SET    project_name        = COALESCE($1, project_name),
                project_description = COALESCE($2, project_description),
                updated_at          = NOW()
         WHERE  project_id = $3 AND user_id = $4
         RETURNING project_id, project_name, project_description, updated_at`,
        [project_name || null, project_description || null, id, userId]
      );
    } else {
      // PM and admin can update any project
      result = await pool.query(
        `UPDATE projects
         SET    project_name        = COALESCE($1, project_name),
                project_description = COALESCE($2, project_description),
                updated_at          = NOW()
         WHERE  project_id = $3
         RETURNING project_id, project_name, project_description, updated_at`,
        [project_name || null, project_description || null, id]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    return res.status(200).json({ project: result.rows[0] });

  } catch (err) {
    console.error('PUT /projects/:id error:', err.message);
    return res.status(500).json({ error: 'Failed to update project.' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/projects/:id
// Soft delete — archives the project
// user → own project only
// admin/pm → any project
// ─────────────────────────────────────────────
router.delete('/:id', verifyToken, async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const { id } = req.params;

  try {
    let result;

    if (req.user.role === 'user' || req.user.role === 'student') {
      // Users can only delete their own projects
      result = await pool.query(
        `UPDATE projects
         SET    is_archived = true,
                archived_at = NOW(),
                updated_at  = NOW()
         WHERE  project_id  = $1
           AND  user_id     = $2
           AND  is_archived = false
         RETURNING project_id`,
        [id, userId]
      );
    } else {
      // PM and admin can delete any project
      result = await pool.query(
        `UPDATE projects
         SET    is_archived = true,
                archived_at = NOW(),
                updated_at  = NOW()
         WHERE  project_id  = $1
           AND  is_archived = false
         RETURNING project_id`,
        [id]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found or already archived.' });
    }

    return res.status(200).json({
      success : true,
      message : 'Project deleted successfully.',
    });

  } catch (err) {
    console.error('DELETE /projects/:id error:', err.message);
    return res.status(500).json({ error: 'Failed to delete project.' });
  }
});


module.exports = router;
