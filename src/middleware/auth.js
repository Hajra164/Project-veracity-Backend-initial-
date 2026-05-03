const jwt = require('jsonwebtoken');
const pool = require('../db');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    // Check blacklist
    const result = await pool.query('SELECT 1 FROM token_blacklist WHERE token = $1', [token]);
    if (result.rows.length > 0) {
      return res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ── DB se fresh role aur tier lo ──────────────────
    const userResult = await pool.query(
      'SELECT role, tier, is_active FROM users WHERE user_id = $1',
      [decoded.user_id]
    );
    if (!userResult.rows.length || !userResult.rows[0].is_active)
      return res.status(401).json({ error: 'User not found or deactivated.' });

    req.user = {
      ...decoded,
      role : userResult.rows[0].role,  // ← DB se fresh
      tier : userResult.rows[0].tier,  // ← DB se fresh ✅
    };
    // ──────────────────────────────────────────────────

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient role.' });
    }
    next();
  };
};

const requireTier = (tier) => {
  return (req, res, next) => {
    if (req.user.tier !== tier && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'This feature requires Pro tier.' });
    }
    next();
  };
};

/**
 * Guards PDF format access by role + tier.
 *
 * Rules:
 *   student            → PDF always allowed (free perk)
 *   user pro / admin   → PDF allowed
 *   user free          → PDF blocked
 *   project_manager pro → PDF allowed
 */
const requirePdfAccess = (req, res, next) => {
  const { role, tier } = req.user;

  // URL path se pdf detect karo
  const isPdfRequest = req.path.endsWith('/pdf') ||
                       req.query.format === 'pdf' ||
                       req.body?.format === 'pdf';

  // PDF request nahi → allow
  if (!isPdfRequest) return next();

  // Admins always pass
  if (role === 'admin') return next();

  // Students get PDF for free
  if (role === 'student') return next();

  // Pro users pass
  if (tier === 'pro') return next();

  // Everyone else blocked
  return res.status(403).json({
    error: 'PDF reports require Pro tier. Please upgrade your plan.',
  });
};

module.exports = { verifyToken, requireRole, requireTier, requirePdfAccess };
