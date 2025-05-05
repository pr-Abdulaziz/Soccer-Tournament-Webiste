const express = require('express');
const pool = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    let query = `
      SELECT p.*, t.name as team_name, tournament.name as tournament_name
      FROM players p
      LEFT JOIN teams t ON p.team_id = t.id
      LEFT JOIN tournaments tournament ON t.tournament_id = tournament.id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Apply filters
    if (req.query.team_id) {
      query += ' AND p.team_id = ?';
      params.push(req.query.team_id);
    }
    
    if (req.query.tournament_id) {
      query += ' AND t.tournament_id = ?';
      params.push(req.query.tournament_id);
    }
    
    if (req.query.is_approved) {
      query += ' AND p.is_approved = ?';
      params.push(req.query.is_approved === 'true' ? 1 : 0);
    }
    
    if (req.query.is_captain) {
      query += ' AND p.is_captain = ?';
      params.push(req.query.is_captain === 'true' ? 1 : 0);
    }
    
    if (req.query.has_red_cards) {
      query += ' AND p.red_cards > 0';
    }
    
    // Add sorting
    query += ' ORDER BY p.goals DESC, p.name ASC';
    
    // Execute query
    const [players] = await pool.query(query, params);
    
    res.status(200).json({
      success: true,
      count: players.length,
      data: players
    });
  } catch (error) {
    console.error('Get players error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/players/:id
// @desc    Get player by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const [players] = await pool.query(`
      SELECT p.*, t.name as team_name, tournament.name as tournament_name
      FROM players p
      LEFT JOIN teams t ON p.team_id = t.id
      LEFT JOIN tournaments tournament ON t.tournament_id = tournament.id
      WHERE p.id = ?
    `, [req.params.id]);
    
    if (players.length === 0) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    
    res.status(200).json({
      success: true,
      data: players[0]
    });
  } catch (error) {
    console.error('Get player error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/players
// @desc    Create a player
// @access  Public (for joining) / Private (for admin creation)
router.post('/', async (req, res) => {
  try {
    const { name, jersey_number, position, team_id } = req.body;
    
    // Validate required fields
    if (!name || !team_id) {
      return res.status(400).json({ success: false, message: 'Please provide player name and team ID' });
    }
    
    // Check if team exists
    const [teams] = await pool.query('SELECT * FROM teams WHERE id = ?', [team_id]);
    
    if (teams.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    
    // Check if jersey number is already taken in this team
    if (jersey_number) {
      const [existingPlayers] = await pool.query(
        'SELECT * FROM players WHERE team_id = ? AND jersey_number = ?',
        [team_id, jersey_number]
      );
      
      if (existingPlayers.length > 0) {
        return res.status(400).json({ success: false, message: 'Jersey number already taken in this team' });
      }
    }
    
    // Set is_approved based on user role
    const isApproved = req.user && req.user.role === 'admin' ? true : false;
    
    // Create player
    const [result] = await pool.query(
      'INSERT INTO players (name, jersey_number, position, team_id, is_approved) VALUES (?, ?, ?, ?, ?)',
      [name, jersey_number, position, team_id, isApproved]
    );
    
    // Get created player
    const [player] = await pool.query(`
      SELECT p.*, t.name as team_name
      FROM players p
      JOIN teams t ON p.team_id = t.id
      WHERE p.id = ?
    `, [result.insertId]);
    
    res.status(201).json({
      success: true,
      data: player[0],
      message: isApproved ? 'Player created successfully' : 'Player created and pending approval'
    });
  } catch (error) {
    console.error('Create player error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/players/:id/approve
// @desc    Approve a player
// @access  Private (Admin only)
router.put('/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    // Check if player exists
    const [players] = await pool.query('SELECT * FROM players WHERE id = ?', [req.params.id]);
    
    if (players.length === 0) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    
    if (players[0].is_approved) {
      return res.status(400).json({ success: false, message: 'Player is already approved' });
    }
    
    // Approve player
    await pool.query(
      'UPDATE players SET is_approved = true WHERE id = ?',
      [req.params.id]
    );
    
    res.status(200).json({
      success: true,
      message: 'Player approved successfully'
    });
  } catch (error) {
    console.error('Approve player error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/players/:id
// @desc    Update player details
// @access  Private (Admin only)
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, jersey_number, position } = req.body;
    
    // Check if player exists
    const [players] = await pool.query('SELECT * FROM players WHERE id = ?', [req.params.id]);
    
    if (players.length === 0) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    
    // Check if jersey number is already taken (if changing)
    if (jersey_number && jersey_number !== players[0].jersey_number) {
      const [existingPlayers] = await pool.query(
        'SELECT * FROM players WHERE team_id = ? AND jersey_number = ? AND id != ?',
        [players[0].team_id, jersey_number, req.params.id]
      );
      
      if (existingPlayers.length > 0) {
        return res.status(400).json({ success: false, message: 'Jersey number already taken in this team' });
      }
    }
    
    // Update player
    await pool.query(
      'UPDATE players SET name = ?, jersey_number = ?, position = ? WHERE id = ?',
      [
        name || players[0].name,
        jersey_number !== undefined ? jersey_number : players[0].jersey_number,
        position !== undefined ? position : players[0].position,
        req.params.id
      ]
    );
    
    // Get updated player
    const [updatedPlayer] = await pool.query(`
      SELECT p.*, t.name as team_name
      FROM players p
      JOIN teams t ON p.team_id = t.id
      WHERE p.id = ?
    `, [req.params.id]);
    
    res.status(200).json({
      success: true,
      data: updatedPlayer[0]
    });
  } catch (error) {
    console.error('Update player error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/players/:id
// @desc    Delete a player
// @access  Private (Admin only)
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    // Check if player exists
    const [players] = await pool.query('SELECT * FROM players WHERE id = ?', [req.params.id]);
    
    if (players.length === 0) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    
    // If player is a captain, remove captain_id from team
    if (players[0].is_captain) {
      await pool.query(
        'UPDATE teams SET captain_id = NULL WHERE captain_id = ?',
        [req.params.id]
      );
    }
    
    // Delete player
    await pool.query('DELETE FROM players WHERE id = ?', [req.params.id]);
    
    res.status(200).json({
      success: true,
      message: 'Player deleted successfully'
    });
  } catch (error) {
    console.error('Delete player error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;