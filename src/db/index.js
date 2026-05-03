const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,    // ← verify-full behavior explicitly
   
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,  // ← increase from 5000 to 10000
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

pool.query('SELECT 1')
  .then(() => console.log('✅ Connected to Neon PostgreSQL'))
  .catch((err) => console.error('❌ Database connection failed:', err.message));

// ── Keepalive ping every 4 minutes ──────────────────────────
// Prevents Neon free tier from sleeping
setInterval(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('🔄 DB keepalive ping');
  } catch (err) {
    console.error('❌ Keepalive failed:', err.message);
  }
}, 4 * 60 * 1000); // every 4 minutes

module.exports = pool;
