const express = require('express');
const pool = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/teams
// @desc    Get all teams
// @access  Public
router.get('/', async (req, res) => {
  try {
    const [teams] = await pool.query(`
      SELECT t.*, tournament.name as tournament_name, 
        captain.name as captain_name, captain.jersey_number as captain_jersey
      FROM teams t
      LEFT JOIN tournaments tournament ON t.tournament_id = tournament.id
      LEFT JOIN players captain ON t.captain_id = captain.id
      ORDER BY t.name ASC
    `);
    
    res.status(200).json({
      success: true,
      count: teams.length,
      data: teams
    });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/teams/:id
// @desc    Get team by ID with all members
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    // Get team details
    const [teams] = await pool.query(`
      SELECT t.*, tournament.name as tournament_name, 
        captain.name as captain_name, captain.jersey_number as captain_jersey
      FROM teams t
      LEFT JOIN tournaments tournament ON t.tournament_id = tournament.id
      LEFT JOIN players captain ON t.captain_id = captain.id
      WHERE t.id = ?
    `, [req.params.id]);
    
    if (teams.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    
    const team = teams[0];
    
    // Get all approved players in the team
    const [players] = await pool.query(`
      SELECT id, name, jersey_number, position, is_captain, goals, red_cards, yellow_cards
      FROM players
      WHERE team_id = ? AND is_approved = true
      ORDER BY jersey_number ASC
    `, [req.params.id]);
    
    // Get pending players
    const [pendingPlayers] = await pool.query(`
      SELECT id, name, jersey_number, position
      FROM players
      WHERE team_id = ? AND is_approved = false
      ORDER BY created_at DESC
    `, [req.params.id]);
    
    team.players = players;
    team.pendingPlayers = pendingPlayers;
    
    res.status(200).json({
      success: true,
      data: team
    });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/teams
// @desc    Create a team
// @access  Private (Admin only)
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, logo_url, tournament_id, manager_name, coach_name } = req.body;
    
    // Validate required fields
    if (!name || !tournament_id) {
      return res.status(400).json({ success: false, message: 'Please provide team name and tournament ID' });
    }
    
    // Check if tournament exists
    const [tournaments] = await pool.query(
      'SELECT * FROM tournaments WHERE id = ?',
      [tournament_id]
    );
    
    if (tournaments.length === 0) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    
    // Check if team name already exists in this tournament
    const [existingTeams] = await pool.query(
      'SELECT * FROM teams WHERE name = ? AND tournament_id = ?',
      [name, tournament_id]
    );
    
    if (existingTeams.length > 0) {
      return res.status(400).json({ success: false, message: 'Team with this name already exists in the tournament' });
    }
    
    // Create team
    const [result] = await pool.query(
      'INSERT INTO teams (name, logo_url, tournament_id, manager_name, coach_name) VALUES (?, ?, ?, ?, ?)',
      [name, logo_url, tournament_id, manager_name, coach_name]
    );
    
    // Get created team
    const [team] = await pool.query(`
      SELECT t.*, tournament.name as tournament_name
      FROM teams t
      JOIN tournaments tournament ON t.tournament_id = tournament.id
      WHERE t.id = ?
    `, [result.insertId]);
    
    res.status(201).json({
      success: true,
      data: team[0]
    });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/teams/:id/captain
// @desc    Set team captain
// @access  Private (Admin only)
router.put('/:id/captain', auth, adminOnly, async (req, res) => {
  try {
    const { player_id } = req.body;
    
    if (!player_id) {
      return res.status(400).json({ success: false, message: 'Please provide player ID' });
    }
    
    // Check if team exists
    const [teams] = await pool.query('SELECT * FROM teams WHERE id = ?', [req.params.id]);
    
    if (teams.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    
    // Check if player exists and belongs to this team
    const [players] = await pool.query(
      'SELECT * FROM players WHERE id = ? AND team_id = ?',
      [player_id, req.params.id]
    );
    
    if (players.length === 0) {
      return res.status(404).json({ success: false, message: 'Player not found in this team' });
    }
    
    // Reset is_captain for all players in the team
    await pool.query(
      'UPDATE players SET is_captain = false WHERE team_id = ?',
      [req.params.id]
    );
    
    // Set new captain
    await pool.query(
      'UPDATE players SET is_captain = true WHERE id = ?',
      [player_id]
    );
    
    // Update captain_id in team
    await pool.query(
      'UPDATE teams SET captain_id = ? WHERE id = ?',
      [player_id, req.params.id]
    );
    
    // Get updated team with captain
    const [updatedTeam] = await pool.query(`
      SELECT t.*, p.name as captain_name, p.jersey_number as captain_jersey
      FROM teams t
      LEFT JOIN players p ON t.captain_id = p.id
      WHERE t.id = ?
    `, [req.params.id]);
    
    res.status(200).json({
      success: true,
      data: updatedTeam[0],
      message: 'Team captain updated successfully'
    });
  } catch (error) {
    console.error('Set captain error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/teams/:id
// @desc    Update team details
// @access  Private (Admin only)
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, logo_url, manager_name, coach_name } = req.body;
    
    // Check if team exists
    const [teams] = await pool.query('SELECT * FROM teams WHERE id = ?', [req.params.id]);
    
    if (teams.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    
    // Update team
    await pool.query(
      'UPDATE teams SET name = ?, logo_url = ?, manager_name = ?, coach_name = ? WHERE id = ?',
      [
        name || teams[0].name,
        logo_url !== undefined ? logo_url : teams[0].logo_url,
        manager_name !== undefined ? manager_name : teams[0].manager_name,
        coach_name !== undefined ? coach_name : teams[0].coach_name,
        req.params.id
      ]
    );
    
    // Get updated team
    const [updatedTeam] = await pool.query(`
      SELECT t.*, tournament.name as tournament_name, 
        captain.name as captain_name, captain.jersey_number as captain_jersey
      FROM teams t
      LEFT JOIN tournaments tournament ON t.tournament_id = tournament.id
      LEFT JOIN players captain ON t.captain_id = captain.id
      WHERE t.id = ?
    `, [req.params.id]);
    
    res.status(200).json({
      success: true,
      data: updatedTeam[0]
    });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/teams/:id
// @desc    Delete a team
// @access  Private (Admin only)
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    // Check if team exists
    const [teams] = await pool.query('SELECT * FROM teams WHERE id = ?', [req.params.id]);
    
    if (teams.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    
    // Delete team (cascades to players)
    await pool.query('DELETE FROM teams WHERE id = ?', [req.params.id]);
    
    res.status(200).json({
      success: true,
      message: 'Team deleted successfully'
    });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;