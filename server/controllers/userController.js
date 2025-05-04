// server/controllers/userController.js
const bcrypt   = require('bcryptjs');
const mongoose = require('mongoose');
const User     = require('../models/userSchema');

const stripPassword = doc => doc ? { ...doc.toObject(), password: undefined } : doc;


// Users Endpoint
exports.getMe = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('-password').populate("tasks").populate("events");
    if (!me) return res.status(404).json({ error: 'User not found' });
    res.json(me);
  } catch (err) {
    console.error('getMe →', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.updateMe = async (req, res) => {
  try {
    const { username, email, settings, leaderboard, password, currentPassword } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // change password
    if (password || currentPassword) {
      if (!password || !currentPassword)
        return res.status(400).json({ error: 'Provide both currentPassword & password' });

      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) return res.status(401).json({ error: 'Current password incorrect' });

      if (password.length < 8)
        return res.status(400).json({ error: 'New password must be ≥ 8 chars' });

      user.password = await bcrypt.hash(password, 10);
    }

    // simple field updates
    if (username) user.username = username;
    if (email)    user.email    = email;
    if (settings) user.settings = { ...user.settings, ...settings };
    if (leaderboard) user.leaderboard = { ...user.leaderboard, ...leaderboard };

    const saved = await user.save();
    res.json(stripPassword(saved));

  } catch (err) {
    console.error('updateMe: ', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Admin Endpoint
exports.getAllUsers = async (_req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    console.error('getAllUsers: ', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.adminUpdateUser = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ error: 'Bad user id' });

    const body = { ...req.body };
    delete body._id;

    if (body.password) {
      body.password = await bcrypt.hash(body.password, 10);
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      body,
      { new: true, runValidators: true, select: '-password' }
    );

    if (!updated) return res.status(404).json({ error: 'User not found' });

    res.json(updated);
  } catch (err) {
    console.error('adminUpdateUser: ', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.adminDeleteUser = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ error: 'Bad user id' });

    await User.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('adminDeleteUser →', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
