const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

function auth (req, res, next) {
  const token = (req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token, authorization denied' });
  }

  let decoded;
  try {
    // Pin the algorithm so a token signed any other way is rejected
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token is not valid' });
  }

  req.user = decoded;
  next();
}

function adminOnly (req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied. Admin only' });
}

module.exports = { auth, adminOnly };
