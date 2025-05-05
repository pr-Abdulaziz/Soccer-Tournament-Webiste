const jwt    = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();
function auth (req, res, next) {
  try {
    // Expecting header:  Authorization: Bearer <token>
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ success:false, message:'No token, authorization denied' });
    }

    // Verify & attach user info
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success:false, message:'Token is not valid' });
  }
}

function adminOnly (req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ success:false, message:'Access denied. Admin only' });
}

module.exports = { auth, adminOnly };