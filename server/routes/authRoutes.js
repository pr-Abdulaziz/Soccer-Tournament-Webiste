const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../config/db');
const { auth } = require('../middleware/auth');
const dotenv  = require('dotenv');
dotenv.config();
const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role = 'guest' } = req.body;

    /* ---------- 1.  Basic validation ----------------------------- */
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please enter all fields' });
    }

    const emailRE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRE.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email' });
    }

    if (!['admin', 'guest'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    /* ---------- 2.  “Only‑one‑admin” guard ----------------------- */
    if (role === 'admin') {
      const [admins] = await pool.query('SELECT id FROM users WHERE role = "admin" LIMIT 1');
      if (admins.length) {
        return res.status(403).json({
          success: false,
          message: 'Admin account already exists – contact the existing administrator.',
        });
      }
    }

    /* ---------- 3.  Duplicate username / email? ------------------ */
    const [dupes] = await pool.query(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );
    if (dupes.length) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    /* ---------- 4.  Hash password & insert ----------------------- */
    const hash = await bcrypt.hash(password, 10);

    const [insert] = await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES (?,?,?,?)',
      [username, email, hash, role]
    );

    /* ---------- 5.  Fetch inserted row (minus pwd) --------------- */
    const [rows] = await pool.query(
      'SELECT id, username, email, role, created_at FROM users WHERE id = ?',
      [insert.insertId]
    );

    /* ---------- 6.  Sign JWT & respond --------------------------- */
    const token = jwt.sign(
      { id: rows[0].id, username, email, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      success: true,
      token,
      user: rows[0],
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ success: false, message: 'Server error', err });
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success:false, message:'Please enter all fields' });

  const q = 'SELECT * FROM users WHERE email = ?';
  pool.query(q, [email], (err, rows) => {
    if (err)  return res.status(500).json({ success:false, message:'DB error', err });
    if (!rows.length)
      return res.status(400).json({ success:false, message:'Invalid credentials' });

    const user = rows[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err || !isMatch)
        return res.status(400).json({ success:false, message:'Invalid credentials' });

      const token = jwt.sign(
        { id:user.id, username:user.username, email:user.email, role:user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      delete user.password;
      return res.status(200).json({ success:true, token, user });
    });
  });
});

router.get('/user', auth, (req, res) => {
  const q = 'SELECT id,username,email,role,created_at FROM users WHERE id = ?';
  pool.query(q, [req.user.id], (err, rows) => {
    if (err)   return res.status(500).json({ success:false, message:'DB error', err });
    if (!rows.length)
      return res.status(404).json({ success:false, message:'User not found' });

    return res.status(200).json({ success:true, user: rows[0] });
  });
});

module.exports = router;