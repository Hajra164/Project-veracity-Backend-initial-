const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
  // Don't crash — just log it
});

pool.query('SELECT 1')
  .then(() => console.log('✅ Connected to Neon PostgreSQL'))
  .catch((err) => console.error('❌ Database connection failed:', err.message));

module.exports = pool;