const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

// Refuse to start with a missing or guessable JWT secret: anyone who knows it
// can forge an admin token. (The old placeholder value is public in git history.)
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32 || /^your[_-]/i.test(JWT_SECRET)) {
  console.error(
    '❌ JWT_SECRET is missing or too weak. Set it in server/.env to a random value of at least 32 characters, e.g.\n' +
    "   node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  );
  process.exit(1);
}

// Routes
const authRoutes = require('./routes/authRoutes');
const guestRoutes = require('./routes/guestRoutes');
const adminRoutes = require('./routes/adminRoutes');

// Database connection
const { initDB } = require('./config/db');

// Create Express app
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5000;

// Set TRUST_PROXY (e.g. TRUST_PROXY=1) only when running behind a reverse proxy,
// so rate limiting sees the real client IP instead of the proxy's.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
}

// Only the configured frontend origin(s) may call the API from a browser.
// CLIENT_ORIGIN accepts a comma-separated list.
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// Basic protection against scraping / request floods
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later' }
  })
);

// Initialize database
initDB();

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/guest', guestRoutes);
app.use('/api/admin', adminRoutes);

// Unknown routes
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// Last-resort error handler: never send stack traces or internal details to clients
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status =
    Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('Unhandled error:', err);
  res.status(status).json({
    success: false,
    message: status < 500 ? 'Invalid request' : 'Server error'
  });
});

// start your server on the *HTTP* port, not the MySQL port:
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
