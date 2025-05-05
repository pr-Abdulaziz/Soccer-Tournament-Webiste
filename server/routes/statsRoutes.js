const express = require('express');
const pool = require('../config/db');


const router = express.Router();

// @route   GET /api/stats/top-scorers
// @desc    Get top goal scorers across all tournaments
// @access  Public
router.get('/top-scorers', async (req, res) => {
  try {
    const [players] = await pool.query(`
      SELECT p.id, p.name, p.jersey_number, p.position, p.goals, 
        t.name as team_name, tournament.name as tournament_name
      FROM players p
      JOIN teams t ON p.team_id = t.id
      JOIN tournaments tournament ON t.tournament_id = tournament.id
      WHERE p.goals > 0
      ORDER BY p.goals DESC
      LIMIT 10
    `);
    
    res.status(200).json({
      success: true,
      count: players.length,
      data: players
    });
  } catch (error) {
    console.error('Get top scorers error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/stats/red-cards
// @desc    Get players with red cards
// @access  Public
router.get('/red-cards', async (req, res) => {
  try {
    const tournamentId = req.query.tournament_id;
    
    let query = `
      SELECT p.id, p.name, p.jersey_number, p.position, p.red_cards, 
        t.name as team_name, tournament.name as tournament_name
      FROM players p
      JOIN teams t ON p.team_id = t.id
      JOIN tournaments tournament ON t.tournament_id = tournament.id
      WHERE p.red_cards > 0
    `;
    
    const params = [];
    
    if (tournamentId) {
      query += ' AND tournament.id = ?';
      params.push(tournamentId);
    }
    
    query += ' ORDER BY p.red_cards DESC, t.name ASC';
    
    const [players] = await pool.query(query, params);
    
    res.status(200).json({
      success: true,
      count: players.length,
      data: players
    });
  } catch (error) {
    console.error('Get red cards error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/stats/tournament/:id
// @desc    Get tournament statistics
// @access  Public
router.get('/tournament/:id', async (req, res) => {
  try {
    // Validate tournament exists
    const [tournaments] = await pool.query('SELECT * FROM tournaments WHERE id = ?', [req.params.id]);
    
    if (tournaments.length === 0) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    
    // Get team standings
    const [teams] = await pool.query(`
      SELECT t.id, t.name, t.points,
        COUNT(DISTINCT m.id) as matches_played,
        SUM(CASE 
          WHEN (m.home_team_id = t.id AND m.home_score > m.away_score) OR 
               (m.away_team_id = t.id AND m.away_score > m.home_score) 
          THEN 1 ELSE 0 
        END) as wins,
        SUM(CASE 
          WHEN (m.home_score = m.away_score AND m.status = 'completed') 
          THEN 1 ELSE 0 
        END) as draws,
        SUM(CASE 
          WHEN (m.home_team_id = t.id AND m.home_score < m.away_score) OR 
               (m.away_team_id = t.id AND m.away_score < m.home_score) 
          THEN 1 ELSE 0 
        END) as losses,
        SUM(CASE 
          WHEN m.home_team_id = t.id THEN m.home_score 
          WHEN m.away_team_id = t.id THEN m.away_score 
          ELSE 0 
        END) as goals_for,
        SUM(CASE 
          WHEN m.home_team_id = t.id THEN m.away_score 
          WHEN m.away_team_id = t.id THEN m.home_score 
          ELSE 0 
        END) as goals_against
      FROM teams t
      LEFT JOIN matches m ON (t.id = m.home_team_id OR t.id = m.away_team_id) 
                          AND m.status = 'completed'
      WHERE t.tournament_id = ?
      GROUP BY t.id
      ORDER BY t.points DESC, (goals_for - goals_against) DESC, goals_for DESC
    `, [req.params.id]);
    
    // Get top scorers in this tournament
    const [topScorers] = await pool.query(`
      SELECT p.id, p.name, p.jersey_number, p.goals, t.name as team_name
      FROM players p
      JOIN teams t ON p.team_id = t.id
      WHERE t.tournament_id = ? AND p.goals > 0
      ORDER BY p.goals DESC
      LIMIT 5
    `, [req.params.id]);
    
    // Get most recent matches
    const [recentMatches] = await pool.query(`
      SELECT m.id, m.match_date, m.home_score, m.away_score, m.status,
        home.name as home_team_name, away.name as away_team_name
      FROM matches m
      JOIN teams home ON m.home_team_id = home.id
      JOIN teams away ON m.away_team_id = away.id
      WHERE m.tournament_id = ?
      ORDER BY m.match_date DESC
      LIMIT 5
    `, [req.params.id]);
    
    // Get upcoming matches
    const [upcomingMatches] = await pool.query(`
      SELECT m.id, m.match_date, m.location, m.status,
        home.name as home_team_name, away.name as away_team_name
      FROM matches m
      JOIN teams home ON m.home_team_id = home.id
      JOIN teams away ON m.away_team_id = away.id
      WHERE m.tournament_id = ? AND m.status = 'scheduled' AND m.match_date > NOW()
      ORDER BY m.match_date ASC
      LIMIT 5
    `, [req.params.id]);
    
    res.status(200).json({
      success: true,
      data: {
        tournament: tournaments[0],
        standings: teams,
        topScorers,
        recentMatches,
        upcomingMatches
      }
    });
  } catch (error) {
    console.error('Get tournament stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;