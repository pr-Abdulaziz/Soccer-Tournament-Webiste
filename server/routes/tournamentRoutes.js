const express = require('express');
const pool = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');


const router = express.Router();

// @route   GET /api/tournaments
// @desc    Get all tournaments
// @access  Public
router.get('/', async (req, res) => {
  try {
    const [tournaments] = await pool.query(`
      SELECT t.*, COUNT(DISTINCT tm.id) as team_count, COUNT(DISTINCT m.id) as match_count
      FROM tournaments t
      LEFT JOIN teams tm ON t.id = tm.tournament_id
      LEFT JOIN matches m ON t.id = m.tournament_id
      GROUP BY t.id
      ORDER BY t.start_date DESC
    `);
    
    res.status(200).json({
      success: true,
      count: tournaments.length,
      data: tournaments
    });
  } catch (error) {
    console.error('Get tournaments error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/tournaments/:id
// @desc    Get tournament by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const [tournaments] = await pool.query(
      'SELECT * FROM tournaments WHERE id = ?',
      [req.params.id]
    );
    
    if (tournaments.length === 0) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    
    // Get teams in tournament
    const [teams] = await pool.query(
      'SELECT * FROM teams WHERE tournament_id = ? ORDER BY points DESC',
      [req.params.id]
    );
    
    // Get matches in tournament
    const [matches] = await pool.query(`
      SELECT m.*, 
        home.name as home_team_name, 
        away.name as away_team_name
      FROM matches m
      JOIN teams home ON m.home_team_id = home.id
      JOIN teams away ON m.away_team_id = away.id
      WHERE m.tournament_id = ?
      ORDER BY m.match_date ASC
    `, [req.params.id]);
    
    const tournament = tournaments[0];
    tournament.teams = teams;
    tournament.matches = matches;
    
    res.status(200).json({
      success: true,
      data: tournament
    });
  } catch (error) {
    console.error('Get tournament error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/tournaments
// @desc    Create a tournament
// @access  Private (Admin only)
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, description, start_date, end_date, location, status } = req.body;
    
    // Validate required fields
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'Please provide name, start date and end date' });
    }
    
    // Create tournament
    const [result] = await pool.query(
      'INSERT INTO tournaments (name, description, start_date, end_date, location, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, description, start_date, end_date, location, status || 'upcoming', req.user.id]
    );
    
    // Get created tournament
    const [tournament] = await pool.query(
      'SELECT * FROM tournaments WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json({
      success: true,
      data: tournament[0]
    });
  } catch (error) {
    console.error('Create tournament error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/tournaments/:id
// @desc    Update a tournament
// @access  Private (Admin only)
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, description, start_date, end_date, location, status } = req.body;
    
    // Check if tournament exists
    const [tournaments] = await pool.query(
      'SELECT * FROM tournaments WHERE id = ?',
      [req.params.id]
    );
    
    if (tournaments.length === 0) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    
    // Update tournament
    await pool.query(
      'UPDATE tournaments SET name = ?, description = ?, start_date = ?, end_date = ?, location = ?, status = ? WHERE id = ?',
      [
        name || tournaments[0].name,
        description !== undefined ? description : tournaments[0].description,
        start_date || tournaments[0].start_date,
        end_date || tournaments[0].end_date,
        location !== undefined ? location : tournaments[0].location,
        status || tournaments[0].status,
        req.params.id
      ]
    );
    
    // Get updated tournament
    const [updatedTournament] = await pool.query(
      'SELECT * FROM tournaments WHERE id = ?',
      [req.params.id]
    );
    
    res.status(200).json({
      success: true,
      data: updatedTournament[0]
    });
  } catch (error) {
    console.error('Update tournament error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/tournaments/:id
// @desc    Delete a tournament
// @access  Private (Admin only)
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    // Check if tournament exists
    const [tournaments] = await pool.query(
      'SELECT * FROM tournaments WHERE id = ?',
      [req.params.id]
    );
    
    if (tournaments.length === 0) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    
    // Delete tournament (cascades to teams, matches, etc.)
    await pool.query('DELETE FROM tournaments WHERE id = ?', [req.params.id]);
    
    res.status(200).json({
      success: true,
      message: 'Tournament deleted successfully'
    });
  } catch (error) {
    console.error('Delete tournament error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;