// routes/settingsRoutes.js
const express = require('express');
const router = express.Router();
const { protectRoute } = require('../middleware/protectRoute');

// Import controller functions
const {
  getSettings,
  updateProfile,
  updateAppearance,
  updatePomodoro,
  updateProductivity,
  updateNotifications,
  updateIntegrations
} = require('../controllers/settingsController');

// GET /api/settings - Get all user settings
router.get('/', protectRoute, getSettings);

// PATCH /api/settings/profile - Update profile settings
router.patch('/profile', protectRoute, updateProfile);

// PATCH /api/settings/appearance - Update appearance settings
router.patch('/appearance', protectRoute, updateAppearance);

// PATCH /api/settings/pomodoro - Update pomodoro settings
router.patch('/pomodoro', protectRoute, updatePomodoro);

// PATCH /api/settings/productivity - Update productivity settings
router.patch('/productivity', protectRoute, updateProductivity);

// PATCH /api/settings/notifications - Update notification settings
router.patch('/notifications', protectRoute, updateNotifications);

// PATCH /api/settings/integrations - Update integration settings
router.patch('/integrations', protectRoute, updateIntegrations);

module.exports = router;