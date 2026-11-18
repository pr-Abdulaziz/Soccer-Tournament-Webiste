
const crypto    = require('crypto');
const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool }  = require('../config/db');
const { auth }  = require('../middleware/auth');
const router    = express.Router();

// Slow down password guessing and mass account creation
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later' }
});

const MIN_PASSWORD_LENGTH = 8;

// Compared against when the e-mail is unknown, so a failed login takes the same
// time whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// Admin sign-up needs the ADMIN_SIGNUP_CODE from server/.env.
// If that variable is not set, nobody can register as admin through the API.
function isValidAdminCode(code) {
  const expected = process.env.ADMIN_SIGNUP_CODE;
  if (!expected || typeof code !== 'string') return false;
  const a = crypto.createHash('sha256').update(code).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password, role = 'guest', adminCode } = req.body;
    if (
      typeof username !== 'string' || !username.trim() ||
      typeof email !== 'string' || !email ||
      typeof password !== 'string' || !password
    )
      return res
        .status(400)
        .json({ success: false, message: 'Please enter all fields' });

    // Basic email, password & role checks
    const emailRE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email.length > 254 || !emailRE.test(email))
      return res.status(400).json({ success: false, message: 'Invalid email' });
    if (password.length < MIN_PASSWORD_LENGTH)
      return res.status(400).json({
        success: false,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
      });
    if (!['admin','guest'].includes(role))
      return res.status(400).json({ success: false, message: 'Invalid role' });

    // Admin accounts need the secret sign-up code, and only one admin is allowed
    if (role === 'admin') {
      if (!isValidAdminCode(adminCode))
        return res.status(403).json({
          success: false,
          message: 'Admin registration is not allowed'
        });

      const [admins] = await pool.query(
        `SELECT id FROM users WHERE role='admin' LIMIT 1`
      );
      if (admins.length)
        return res.status(403).json({
          success: false,
          message:
            'Admin account already exists – contact the existing administrator.'
        });
    }

    // Duplicate?
    const [dupes] = await pool.query(
      `SELECT id FROM users WHERE email = ? OR username = ?`,
      [email, username]
    );
    if (dupes.length)
      return res
        .status(409)
        .json({ success: false, message: 'User already exists' });

    // Hash + insert
    const hash = await bcrypt.hash(password, 10);
    const [insertResult] = await pool.query(
      `INSERT INTO users
         (username, email, password, role)
       VALUES (?,?,?,?)`,
      [username, email, hash, role]
    );

    // Fetch back user (minus pwd) & sign JWT
    const [[user]] = await pool.query(
      `SELECT id, username, email, role, created_at
         FROM users
        WHERE id = ?`,
      [insertResult.insertId]
    );

    const token = signToken(user);

    return res.status(201).json({ success: true, token, user });
  } catch (err) {
    console.error('Registration error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || !email || typeof password !== 'string' || !password)
      return res
        .status(400)
        .json({ success: false, message: 'Please enter all fields' });

    const [[user]] = await pool.query(
      `SELECT * FROM users WHERE email = ?`,
      [email]
    );

    const isMatch = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
    if (!user || !isMatch)
      return res
        .status(400)
        .json({ success: false, message: 'Invalid credentials' });

    delete user.password;
    const token = signToken(user);
    return res.status(200).json({ success: true, token, user });
  } catch (err) {
    console.error('Login error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Server error' });
  }
});

// GET /api/auth/user
router.get('/user', auth, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      `SELECT id, username, email, role, created_at
         FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, user });
  } catch (err) {
    console.error('Get user error:', err);
    res
      .status(500)
      .json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
