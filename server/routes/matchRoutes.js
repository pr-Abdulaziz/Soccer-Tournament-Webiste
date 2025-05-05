const express = require('express')
const pool= require('../config/db');    // adjust as needed
const { auth, adminOnly } = require('../middleware/auth');
const { sendMatchReminder } = require('../lib/email');
const router = express.Router();


router.get('/', async (req, res) => {
  try {
    let query = `
      SELECT m.*, 
        home.name as home_team_name, 
        away.name as away_team_name,
        t.name as tournament_name
      FROM matches m
      JOIN teams home ON m.home_team_id = home.id
      JOIN teams away ON m.away_team_id = away.id
      JOIN tournaments t ON m.tournament_id = t.id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Apply filters
    if (req.query.tournament_id) {
      query += ' AND m.tournament_id = ?';
      params.push(req.query.tournament_id);
    }
    
    if (req.query.team_id) {
      query += ' AND (m.home_team_id = ? OR m.away_team_id = ?)';
      params.push(req.query.team_id, req.query.team_id);
    }
    
    if (req.query.status) {
      query += ' AND m.status = ?';
      params.push(req.query.status);
    }
    
    // Add sorting
    if (req.query.sort_by === 'date_desc') {
      query += ' ORDER BY m.match_date DESC';
    } else {
      query += ' ORDER BY m.match_date ASC';
    }
    
    // Execute query
    const [matches] = await pool.query(query, params);
    
    res.status(200).json({
      success: true,
      count: matches.length,
      data: matches
    });
  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/matches/:id
// @desc    Get match by ID with details
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    // Get match details
    const [matches] = await pool.query(`
      SELECT m.*, 
        home.name as home_team_name, 
        away.name as away_team_name,
        t.name as tournament_name,
        t.location as tournament_location
      FROM matches m
      JOIN teams home ON m.home_team_id = home.id
      JOIN teams away ON m.away_team_id = away.id
      JOIN tournaments t ON m.tournament_id = t.id
      WHERE m.id = ?
    `, [req.params.id]);
    
    if (matches.length === 0) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }
    
    const match = matches[0];
    
    // Get match events
    const [events] = await pool.query(`
      SELECT e.*, p.name as player_name, p.jersey_number, t.name as team_name
      FROM match_events e
      JOIN players p ON e.player_id = p.id
      JOIN teams t ON p.team_id = t.id
      WHERE e.match_id = ?
      ORDER BY e.minute ASC
    `, [req.params.id]);
    
    match.events = events;
    
    res.status(200).json({
      success: true,
      data: match
    });
  } catch (error) {
    console.error('Get match error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/matches
// @desc    Create a match
// @access  Private (Admin only)
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { tournament_id, home_team_id, away_team_id, match_date, location } = req.body;
    
    // Validate required fields
    if (!tournament_id || !home_team_id || !away_team_id || !match_date) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide tournament ID, home team ID, away team ID, and match date' 
      });
    }
    
    // Check if teams are different
    if (home_team_id === away_team_id) {
      return res.status(400).json({ success: false, message: 'Home and away teams must be different' });
    }
    
    // Check if tournament exists
    const [tournaments] = await pool.query('SELECT * FROM tournaments WHERE id = ?', [tournament_id]);
    
    if (tournaments.length === 0) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    
    // Check if teams exist and belong to the tournament
    const [teams] = await pool.query(
      'SELECT * FROM teams WHERE id IN (?, ?) AND tournament_id = ?',
      [home_team_id, away_team_id, tournament_id]
    );
    
    if (teams.length !== 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Both teams must exist and belong to the specified tournament' 
      });
    }
    
    // Create match
    const [result] = await pool.query(
      'INSERT INTO matches (tournament_id, home_team_id, away_team_id, match_date, location) VALUES (?, ?, ?, ?, ?)',
      [tournament_id, home_team_id, away_team_id, match_date, location]
    );
    
    // Get created match
    const [match] = await pool.query(`
      SELECT m.*, 
        home.name as home_team_name, 
        away.name as away_team_name
      FROM matches m
      JOIN teams home ON m.home_team_id = home.id
      JOIN teams away ON m.away_team_id = away.id
      WHERE m.id = ?
    `, [result.insertId]);
    
    res.status(201).json({
      success: true,
      data: match[0]
    });
  } catch (error) {
    console.error('Create match error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/matches/:id/result
// @desc    Update match result
// @access  Private (Admin only)
router.put('/:id/result', auth, adminOnly, async (req, res) => {
  try {
    const { home_score, away_score } = req.body;
    
    if (home_score === undefined || away_score === undefined) {
      return res.status(400).json({ success: false, message: 'Please provide home and away scores' });
    }
    
    // Check if match exists
    const [matches] = await pool.query('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    
    if (matches.length === 0) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }
    
    // Update match result and set status to completed
    await pool.query(
      'UPDATE matches SET home_score = ?, away_score = ?, status = ? WHERE id = ?',
      [home_score, away_score, 'completed', req.params.id]
    );
    
    // Get updated match
    const [updatedMatch] = await pool.query(`
      SELECT m.*, 
        home.name as home_team_name, 
        away.name as away_team_name
      FROM matches m
      JOIN teams home ON m.home_team_id = home.id
      JOIN teams away ON m.away_team_id = away.id
      WHERE m.id = ?
    `, [req.params.id]);
    
    res.status(200).json({
      success: true,
      data: updatedMatch[0],
      message: 'Match result updated successfully. Team points have been updated.'
    });
  } catch (error) {
    console.error('Update match result error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/matches/:id/events
// @desc    Add match event (goal, card)
// @access  Private (Admin only)
router.post('/:id/events', auth, adminOnly, async (req, res) => {
  try {
    const { player_id, event_type, minute } = req.body;
    
    // Validate inputs
    if (!player_id || !event_type || !minute) {
      return res.status(400).json({
        success: false,
        message: 'Please provide player ID, event type, and minute'
      });
    }
    
    // Validate event type
    const validEventTypes = ['goal', 'yellow_card', 'red_card'];
    if (!validEventTypes.includes(event_type)) {
      return res.status(400).json({
        success: false,
        message: 'Event type must be goal, yellow_card, or red_card'
      });
    }
    
    // Check if match exists
    const [matches] = await pool.query('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    
    if (matches.length === 0) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }
    
    // Check if player exists and belongs to one of the teams in the match
    const [players] = await pool.query(`
      SELECT p.* FROM players p
      JOIN teams t ON p.team_id = t.id
      WHERE p.id = ? AND (
        t.id = ? OR t.id = ?
      )
    `, [player_id, matches[0].home_team_id, matches[0].away_team_id]);
    
    if (players.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Player not found or not part of the teams playing this match' 
      });
    }
    
    // Create match event
    const [result] = await pool.query(
      'INSERT INTO match_events (match_id, player_id, event_type, minute) VALUES (?, ?, ?, ?)',
      [req.params.id, player_id, event_type, minute]
    );
    
    // Get created event
    const [event] = await pool.query(`
      SELECT e.*, p.name as player_name, p.jersey_number, t.name as team_name
      FROM match_events e
      JOIN players p ON e.player_id = p.id
      JOIN teams t ON p.team_id = t.id
      WHERE e.id = ?
    `, [result.insertId]);
    
    res.status(201).json({
      success: true,
      data: event[0],
      message: `${event_type.replace('_', ' ')} recorded successfully`
    });
  } catch (error) {
    console.error('Add match event error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/matches/:id/reminder
// @desc    Send match reminder emails
// @access  Private (Admin only)
router.post('/:id/reminder', auth, adminOnly, async (req, res) => {
  try {
    // Get match details
    const [matches] = await pool.query(`
      SELECT m.*, 
        home.name as home_team_name, home.id as home_team_id,
        away.name as away_team_name, away.id as away_team_id,
        t.name as tournament_name
      FROM matches m
      JOIN teams home ON m.home_team_id = home.id
      JOIN teams away ON m.away_team_id = away.id
      JOIN tournaments t ON m.tournament_id = t.id
      WHERE m.id = ?
    `, [req.params.id]);
    
    if (matches.length === 0) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }
    
    const match = matches[0];
    
    // Check if match is in the future
    if (new Date(match.match_date) < new Date()) {
      return res.status(400).json({ success: false, message: 'Cannot send reminders for past matches' });
    }
    
    // Get players from both teams
    const homeTeamId = match.home_team_id;
    const awayTeamId = match.away_team_id;
    
    const [homePlayers] = await pool.query(
      'SELECT * FROM players WHERE team_id = ? AND is_approved = true',
      [homeTeamId]
    );
    
    const [awayPlayers] = await pool.query(
      'SELECT * FROM players WHERE team_id = ? AND is_approved = true',
      [awayTeamId]
    );
    
    // Get team details
    const [homeTeam] = await pool.query('SELECT * FROM teams WHERE id = ?', [homeTeamId]);
    const [awayTeam] = await pool.query('SELECT * FROM teams WHERE id = ?', [awayTeamId]);
    
    // Send emails
    try {
      await sendMatchReminder(match, homeTeam[0], homePlayers);
      await sendMatchReminder(match, awayTeam[0], awayPlayers);
      
      // Record notification
      await pool.query(
        'INSERT INTO notifications (match_id, team_id, status) VALUES (?, ?, ?)',
        [match.id, homeTeamId, 'sent']
      );
      
      await pool.query(
        'INSERT INTO notifications (match_id, team_id, status) VALUES (?, ?, ?)',
        [match.id, awayTeamId, 'sent']
      );
      
      res.status(200).json({
        success: true,
        message: 'Match reminders sent successfully to both teams'
      });
    } catch (error) {
      console.error('Send email error:', error);
      
      // Record failed notification
      await pool.query(
        'INSERT INTO notifications (match_id, team_id, status) VALUES (?, ?, ?)',
        [match.id, homeTeamId, 'failed']
      );
      
      await pool.query(
        'INSERT INTO notifications (match_id, team_id, status) VALUES (?, ?, ?)',
        [match.id, awayTeamId, 'failed']
      );
      
      res.status(500).json({ success: false, message: 'Failed to send email reminders' });
    }
  } catch (error) {
    console.error('Match reminder error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;