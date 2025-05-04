const express = require('express');
const {
  getAllUsers,
  getMe,
  updateMe,
  adminUpdateUser,
  adminDeleteUser
} = require('../controllers/userController');

const { protectRoute } = require('../middleware/protectRoute');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

// Login for user
router.get('/me', protectRoute, getMe);
router.patch('/me', protectRoute, updateMe);

// Only for Admin
router.get('/', protectRoute, isAdmin, getAllUsers);
router.patch('/:id', protectRoute, isAdmin, adminUpdateUser);
router.delete('/:id', protectRoute, isAdmin, adminDeleteUser);

module.exports = router;