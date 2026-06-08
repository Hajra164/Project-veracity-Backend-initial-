require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const reportRoutes = require('./reports');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const chatRoutes = require('./routes/chat');
const dashboardRoutes  = require('./routes/dashboard');
const predictionRoutes = require('./routes/predictions');
const analysisRoutes = require('./routes/analysis');
const paymentRoutes = require('./routes/payment');
const refactorRoutes = require('./routes/refactor');

require('./db');
require('./workers/analysisQueue');

const app = express();

app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    // Allow Postman and server-to-server calls (no origin)
    if (!origin) return callback(null, true);
 
    const allowed = [
      'http://localhost:3000',
      'http://localhost:5000',
      'https://veracity-delta.vercel.app',
      'https://project-veracity-backend-initial-production-be6f.up.railway.app',
      'https://project-veracity-backend-initial-production-71b7.up.railway.app',
     
    ];
 
    // Allow any Vercel URL — covers all preview + production URLs
   if (origin.endsWith('.vercel.app') || allowed.includes(origin)) {
      return callback(null, true);
    }
 
    return callback(new Error('CORS not allowed: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/dashboard',   dashboardRoutes);
app.use('/api/predictions', predictionRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/refactor', refactorRoutes);

// Add this before your other routes
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Veracity Backend' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'File too large. Max 1MB.' });
  if (err.message === 'Only .py files are allowed')
    return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Unexpected server error.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
