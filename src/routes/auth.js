'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

// Import centralized auth middleware
const { verifyToken } = require('../middleware/auth');

// Helper function to insert audit log
const logAudit = async (userId, action, resourceType, resourceId, status, ipAddress, userAgent, errorMessage = null) => {
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


//http://localhost:5000/api/auth/register     endpoint
// ── REGISTER ───────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, role: requestedRole } = req.body;

  const SELF_REGISTER_ROLES = ['user', 'student'];
  const role = SELF_REGISTER_ROLES.includes(requestedRole) ? requestedRole : 'user';
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const existing = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, tier) 
       VALUES ($1, $2, $3, $4) 
       RETURNING user_id, email, role, tier`,
      [email, hash, role, 'free']
    );

    const newUser = result.rows[0];

    await logAudit(newUser.user_id, 'REGISTER', 'user', newUser.user_id, 'SUCCESS', ip, userAgent);

    res.status(201).json({ message: 'User registered.', user: newUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── LOGIN ───────────────────────────────────────────────
//http://localhost:5000/api/auth/login        endpoint

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = result.rows[0];

    if (user.failed_login_attempts >= 5) {
      await logAudit(user.user_id, 'LOGIN_BLOCKED', 'user', user.user_id, 'FAILED', ip, userAgent, 'Account locked');
      return res.status(423).json({ error: 'Account locked. Contact admin.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await pool.query(
        'UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE user_id = $1',
        [user.user_id]
      );
      await logAudit(user.user_id, 'LOGIN_FAILED', 'user', user.user_id, 'FAILED', ip, userAgent, 'Invalid password');
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, last_login_at = CURRENT_TIMESTAMP, last_login_ip = $1 WHERE user_id = $2',
      [ip, user.user_id]
    );

    // ✅ FIXED: use user_id instead of userId
    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role, tier: user.tier },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    await logAudit(user.user_id, 'LOGIN_SUCCESS', 'user', user.user_id, 'SUCCESS', ip, userAgent);

    res.json({ token, user: { id: user.user_id, email: user.email, role: user.role, tier: user.tier } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── LOGOUT ───────────────────────────────────────────────
// http://localhost:5000/api/auth/logout   endpoint

router.post('/logout', verifyToken, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';
  const userId = req.user.user_id || req.user.userId;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  try {
    // Add token to blacklist
    // ✅ fixed
await pool.query(
  `INSERT INTO token_blacklist (token, user_id) 
   VALUES ($1, $2) 
   ON CONFLICT (token) DO NOTHING`,
  [token, userId]
);

    await logAudit(userId, 'LOGOUT', 'user', userId, 'SUCCESS', ip, userAgent);

    return res.status(200).json({ message: 'Logged out successfully. Token revoked.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Logout failed.' });
  }
});
// ── VERIFY TOKEN ─────────────────────────────────────────────
// GET http://localhost:5000/api/auth/verify

router.get('/verify', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, email, full_name, role, tier,
              is_active, is_email_verified, last_login_at
       FROM   users
       WHERE  user_id   = $1
         AND  is_active = true`,
      [req.user.user_id]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'User not found or deactivated.' });
    }

    const user = result.rows[0];

    return res.status(200).json({
      id               : user.user_id,
      email            : user.email,
      full_name        : user.full_name,
      role             : user.role,
      tier             : user.tier,
      is_active        : user.is_active,
      is_email_verified: user.is_email_verified,
      last_login_at    : user.last_login_at,
    });

  } catch (err) {
    console.error('Verify error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET OWN PROFILE ───────────────────────────────────────────
// GET /api/auth/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, email, full_name, role, tier, is_active, is_email_verified, last_login_at
       FROM users WHERE user_id = $1 AND is_active = true`,
      [req.user.user_id]
    );

    if (!result.rows.length)
      return res.status(404).json({ error: 'User not found.' });

    const user = result.rows[0];
    return res.status(200).json({
      id:                user.user_id,
      email:             user.email,
      full_name:         user.full_name,
      role:              user.role,
      tier:              user.tier,
      is_active:         user.is_active,
      is_email_verified: user.is_email_verified,
      last_login_at:     user.last_login_at,
    });
  } catch (err) {
    console.error('GET /me error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── UPDATE OWN PROFILE ────────────────────────────────────────
// PUT /api/auth/me
router.put('/me', verifyToken, async (req, res) => {
  const { full_name, password } = req.body;
  const userId = req.user.user_id;

  if (full_name === undefined && password === undefined)
    return res.status(400).json({ error: 'Nothing to update. Provide full_name or password.' });

  if (password !== undefined && password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (full_name !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(full_name);
    }

    if (password !== undefined) {
      const hash = await bcrypt.hash(password, 12);
      fields.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    values.push(userId);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE user_id = $${idx}
       RETURNING user_id, email, full_name, role, tier, is_active`,
      values
    );

    if (!result.rows.length)
      return res.status(404).json({ error: 'User not found.' });

    const user = result.rows[0];
    return res.status(200).json({
      id:        user.user_id,
      email:     user.email,
      full_name: user.full_name,
      role:      user.role,
      tier:      user.tier,
      is_active: user.is_active,
    });
  } catch (err) {
    console.error('PUT /me error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
