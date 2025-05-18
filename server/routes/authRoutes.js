
const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { pool }  = require('../config/db');
const { auth }  = require('../middleware/auth');
const router    = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role = 'guest' } = req.body;
    if (!username || !email || !password)
      return res
        .status(400)
        .json({ success: false, message: 'Please enter all fields' });

    // Basic email & role checks
    const emailRE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRE.test(email))
      return res.status(400).json({ success: false, message: 'Invalid email' });
    if (!['admin','guest'].includes(role))
      return res.status(400).json({ success: false, message: 'Invalid role' });

    // Only one admin allowed
    if (role === 'admin') {
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

    const token = jwt.sign(
      { id: user.id, username, email, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return res.status(201).json({ success: true, token, user });
  } catch (err) {
    console.error('Registration error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ success: false, message: 'Please enter all fields' });

    const [[user]] = await pool.query(
      `SELECT * FROM users WHERE email = ?`,
      [email]
    );
    if (!user)
      return res
        .status(400)
        .json({ success: false, message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(400)
        .json({ success: false, message: 'Invalid credentials' });

    delete user.password;
    const token = jwt.sign(
      { id: user.id, username: user.username, email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
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
