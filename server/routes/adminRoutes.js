const express = require('express');
const { pool } = require('../config/db');
const router = express.Router();

// Admin authentication middleware
const adminAuth = (req, res, next) => {
  // JWT/session validation for admin role would go here
  // For now, just passing through
  next();
};

// 1. Add new tournament
router.post('/dashboard/tournaments', adminAuth, async (req, res) => {
  const { tr_id, tr_name, start_date, end_date } = req.body;

  // Validate required fields
  if (!tr_id || !tr_name || !start_date || !end_date) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required: tr_id, tr_name, start_date, end_date'
    });
  }

  try {
    // Check if tournament already exists
    const [existing] = await pool.query(
      'SELECT 1 FROM tournament WHERE tr_id = ?',
      [tr_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Tournament already exists with this ID'
      });
    }

    // Insert new tournament
    await pool.query(
      `INSERT INTO tournament (tr_id, tr_name, start_date, end_date)
       VALUES (?, ?, ?, ?)`,
      [tr_id, tr_name, start_date, end_date]
    );

    res.status(201).json({
      success: true,
      message: 'Tournament created successfully',
      data: { tr_id, tr_name, start_date, end_date }
    });
  } catch (err) {
    console.error('Error creating tournament:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating tournament',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// 2. Add team to tournament
router.post('/dashboard/tournaments/:trId/teams', adminAuth, async (req, res) => {
  const { trId } = req.params;
  const { team_id, team_group } = req.body;
  const group_position = req.body.group_position || null;

  // Validate required fields
  if (!team_id || !team_group) {
    return res.status(400).json({
      success: false,
      message: 'Required fields: team_id, team_group'
    });
  }

  try {
    // Validate tournament exists
    const [tournament] = await pool.query(
      'SELECT 1 FROM tournament WHERE tr_id = ?',
      [trId]
    );
    
    if (tournament.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tournament not found' 
      });
    }

    // Validate team exists
    const [team] = await pool.query(
      'SELECT 1 FROM team WHERE team_id = ?',
      [team_id]
    );
    
    if (team.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Team not found' 
      });
    }

    // Check if team is already in tournament
    const [existing] = await pool.query(
      `SELECT 1 FROM tournament_team 
       WHERE team_id = ? AND tr_id = ?`,
      [team_id, trId]
    );
    
    if (existing.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: 'Team already registered in this tournament' 
      });
    }

    // Determine group position if not provided
    let finalGroupPosition = group_position;
    if (!finalGroupPosition) {
      const [positions] = await pool.query(
        `SELECT MAX(group_position) as max_position 
         FROM tournament_team 
         WHERE tr_id = ? AND team_group = ?`,
        [trId, team_group]
      );
      
      finalGroupPosition = positions[0].max_position ? 
        parseInt(positions[0].max_position) + 1 : 1;
    }

    // Add team with default stats
    await pool.query(
      `INSERT INTO tournament_team (
        team_id, tr_id, team_group, group_position,
        match_played, won, draw, lost,
        goal_for, goal_against, goal_diff, points
      ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)`,
      [team_id, trId, team_group, finalGroupPosition]
    );

    res.status(201).json({
      success: true,
      message: 'Team added to tournament successfully',
      data: { 
        team_id, 
        tr_id: trId, 
        team_group, 
        group_position: finalGroupPosition 
      }
    });
  } catch (err) {
    console.error('Error adding team to tournament:', err);
    res.status(500).json({
      success: false,
      message: 'Error adding team to tournament',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// 3. Select match captain for a team
router.post('/dashboard/matches/:matchId/captain', adminAuth, async (req, res) => {
  const { matchId } = req.params;
  const { team_id, player_id } = req.body;

  // Validate required fields
  if (!team_id || !player_id) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required: team_id, player_id'
    });
  }

  try {
    // Validate match exists
    const [match] = await pool.query(
      'SELECT team_id1, team_id2 FROM match_played WHERE match_no = ?',
      [matchId]
    );
    
    if (match.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Match not found'
      });
    }

    // Validate team is playing in this match
    if (match[0].team_id1 != team_id && match[0].team_id2 != team_id) {
      return res.status(400).json({
        success: false,
        message: 'Team is not participating in this match'
      });
    }

    // Validate player exists
    const [playerExists] = await pool.query(
      'SELECT 1 FROM player WHERE player_id = ?',
      [player_id]
    );
    
    if (playerExists.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Player not found'
      });
    }

    // Validate player belongs to team (in any tournament)
    const [playerInTeam] = await pool.query(
      `SELECT 1 FROM team_player 
       WHERE team_id = ? AND player_id = ?`,
      [team_id, player_id]
    );
    
    if (playerInTeam.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Player is not registered with this team'
      });
    }

    // Update or insert captain
    await pool.query(
      `INSERT INTO match_captain (match_no, team_id, player_captain)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE player_captain = ?`,
      [matchId, team_id, player_id, player_id]
    );

    res.status(200).json({
      success: true,
      message: 'Team captain set successfully',
      data: { match_no: matchId, team_id, player_captain: player_id }
    });
  } catch (err) {
    console.error('Error setting team captain:', err);
    res.status(500).json({
      success: false,
      message: 'Error setting team captain',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// 4. Approve player to join team in a tournament
router.post('/dashboard/approvals', adminAuth, async (req, res) => {
  const { tr_id, team_id, player_id } = req.body;
  
  // Validate required fields
  if (!tr_id || !team_id || !player_id) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required: tr_id, team_id, player_id'
    });
  }

  try {
    // Check if tournament exists
    const [tournament] = await pool.query(
      'SELECT 1 FROM tournament WHERE tr_id = ?',
      [tr_id]
    );
    
    if (tournament.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tournament not found'
      });
    }

    // Check if team exists
    const [team] = await pool.query(
      'SELECT 1 FROM team WHERE team_id = ?',
      [team_id]
    );
    
    if (team.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    // Check if team is registered for tournament
    const [teamInTournament] = await pool.query(
      'SELECT 1 FROM tournament_team WHERE tr_id = ? AND team_id = ?',
      [tr_id, team_id]
    );
    
    if (teamInTournament.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Team is not registered for this tournament'
      });
    }

    // Check if player exists
    const [player] = await pool.query(
      'SELECT 1 FROM player WHERE player_id = ?',
      [player_id]
    );
    
    if (player.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Player not found'
      });
    }

    // Check if player is already approved for this team in this tournament
    const [existing] = await pool.query(
      `SELECT 1 FROM team_player 
       WHERE tr_id = ? AND team_id = ? AND player_id = ?`,
      [tr_id, team_id, player_id]
    );
    
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Player already approved for this team in this tournament'
      });
    }

    // Approve player
    await pool.query(
      `INSERT INTO team_player (player_id, team_id, tr_id)
       VALUES (?, ?, ?)`,
      [player_id, team_id, tr_id]
    );

    res.status(201).json({
      success: true,
      message: 'Player approved successfully',
      data: { tr_id, team_id, player_id }
    });
  } catch (err) {
    console.error('Error approving player:', err);
    res.status(500).json({
      success: false,
      message: 'Error approving player',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// 5. Delete tournament
router.delete('/dashboard/tournaments/:trId', adminAuth, async (req, res) => {
  const { trId } = req.params;

  try {
    // Check if tournament exists
    const [tournament] = await pool.query(
      'SELECT tr_name FROM tournament WHERE tr_id = ?',
      [trId]
    );
    
    if (tournament.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tournament not found'
      });
    }

    // Check for dependencies before deletion
    
    // Check for registered teams
    const [teams] = await pool.query(
      'SELECT 1 FROM tournament_team WHERE tr_id = ?',
      [trId]
    );
    
    if (teams.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete tournament with registered teams'
      });
    }
    
    // Check for team players
    const [players] = await pool.query(
      'SELECT 1 FROM team_player WHERE tr_id = ?',
      [trId]
    );
    
    if (players.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete tournament with registered players'
      });
    }
    
    // Check for matches linked to this tournament
    const [matches] = await pool.query(
      `SELECT 1 FROM match_played mp
       JOIN tournament_team tt ON (mp.team_id1 = tt.team_id OR mp.team_id2 = tt.team_id)
       WHERE tt.tr_id = ?
       LIMIT 1`,
      [trId]
    );
    
    if (matches.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete tournament with scheduled matches'
      });
    }

    // Delete tournament
    await pool.query(
      'DELETE FROM tournament WHERE tr_id = ?',
      [trId]
    );

    res.status(200).json({
      success: true,
      message: `Tournament "${tournament[0].tr_name}" deleted successfully`
    });
  } catch (err) {
    console.error('Error deleting tournament:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting tournament',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Supporting routes for the dashboard

// Get all tournaments
router.get('/dashboard/tournaments', adminAuth, async (req, res) => {
  try {
    const [tournaments] = await pool.query('SELECT * FROM tournament ORDER BY start_date DESC');
    res.json({ 
      success: true, 
      count: tournaments.length,
      data: tournaments 
    });
  } catch (err) {
    console.error('Error fetching tournaments:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching tournaments',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Get all teams
router.get('/dashboard/teams', adminAuth, async (req, res) => {
  try {
    const [teams] = await pool.query('SELECT * FROM team ORDER BY team_name');
    res.json({ 
      success: true, 
      count: teams.length,
      data: teams 
    });
  } catch (err) {
    console.error('Error fetching teams:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching teams',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Get all players with their positions
router.get('/dashboard/players', adminAuth, async (req, res) => {
  try {
    const [players] = await pool.query(
      `SELECT p.player_id, pr.name, p.jersey_no, p.position_to_play, 
              pp.position_desc
       FROM player p
       JOIN person pr ON p.player_id = pr.kfupm_id
       JOIN playing_position pp ON p.position_to_play = pp.position_id
       ORDER BY pr.name`
    );
    res.json({ 
      success: true, 
      count: players.length,
      data: players 
    });
  } catch (err) {
    console.error('Error fetching players:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching players',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Get all matches
router.get('/dashboard/matches', adminAuth, async (req, res) => {
  try {
    const [matches] = await pool.query(
      `SELECT m.match_no, m.play_stage, m.play_date, 
              t1.team_name as team1_name, t2.team_name as team2_name,
              m.results, m.goal_score, v.venue_name
       FROM match_played m
       JOIN team t1 ON m.team_id1 = t1.team_id
       JOIN team t2 ON m.team_id2 = t2.team_id
       JOIN venue v ON m.venue_id = v.venue_id
       ORDER BY m.play_date DESC`
    );
    res.json({ 
      success: true, 
      count: matches.length,
      data: matches 
    });
  } catch (err) {
    console.error('Error fetching matches:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching matches',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

module.exports = router;