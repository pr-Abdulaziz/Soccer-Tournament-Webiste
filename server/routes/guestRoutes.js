const express = require('express');
const { pool } = require('../config/db'); // MySQL connection
const router = express.Router();

// Dashboard home - Get all tournaments for selection
router.get('/dashboard/tournaments', async (req, res) => {
  try {
    const [tournaments] = await pool.query(
      'SELECT tr_id, tr_name, start_date, end_date FROM tournament'
    );
    res.status(200).json({ success: true, data: tournaments });
  } catch (err) {
    console.error('Error fetching tournaments:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Dashboard home - Get all teams for selection
router.get('/dashboard/teams', async (req, res) => {
  try {
    const [teams] = await pool.query(
      'SELECT team_id, team_name FROM team'
    );
    res.status(200).json({ success: true, data: teams });
  } catch (err) {
    console.error('Error fetching teams:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 1) Dashboard - Browse all match results of a given tournament sorted by date
router.get('/dashboard/matches/tournament/:trId', async (req, res) => {
  const { trId } = req.params;

  if (!trId || isNaN(Number(trId))) {
    return res.status(400).json({
      success: false,
      message: 'Invalid tournament ID'
    });
  }

  try {
    const [matches] = await pool.query(`
      SELECT 
        t11.team_name              AS team1,
        t22.team_name              AS team2,
        mp.goal_score,
        DATE_FORMAT(mp.play_date, '%Y-%m-%d') AS match_date
      FROM MATCH_PLAYED mp
      ,   tournament_team t1
      ,   tournament_team t2
      ,   team t11
      ,   team t22
      WHERE mp.team_id1   = t1.team_id
        AND mp.team_id2   = t2.team_id
        AND t1.team_id    = t11.team_id
        AND t2.team_id    = t22.team_id
        AND t1.tr_id      = t2.tr_id
        AND t1.tr_id      = ?
        AND t2.tr_id      = ?
      ORDER BY mp.play_date ASC;
    `, [trId, trId]);

    res.status(200).json({ success: true, data: matches });
  } catch (err) {
    console.error('Error fetching match results:', err);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});


// 2) Dashboard - Browse the player with the highest goal scored in all the tournaments
router.get('/dashboard/top-scorer', async (req, res) => {
  try {
    const [topScorer] = await pool.query(`
      SELECT 
        p.kfupm_id, 
        p.name, 
        COUNT(*) AS goals_scored,
        t.team_name AS team
      FROM 
        person p
      JOIN player pl ON p.kfupm_id = pl.player_id
      JOIN goal_details gd ON pl.player_id = gd.player_id
      JOIN team t ON gd.team_id = t.team_id
      GROUP BY p.kfupm_id, p.name, t.team_name
      ORDER BY goals_scored DESC
      LIMIT 5;
    `);

    res.status(200).json({ success: true, data: topScorer });
  } catch (err) {
    console.error('Error fetching top scorer:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 3) Dashboard - Browse the players who received red cards in each team
router.get('/dashboard/red-cards', async (req, res) => {
  try {
    const [redCards] = await pool.query(`
      SELECT 
        p.kfupm_id, 
        p.name, 
        t.team_name,
        COUNT(*) AS red_cards_count,
        MAX(DATE_FORMAT(mp.play_date, '%Y-%m-%d')) AS last_red_card_date
      FROM player_booked pb
      JOIN team t ON pb.team_id = t.team_id
      JOIN player pl ON pb.player_id = pl.player_id
      JOIN person p ON pl.player_id = p.kfupm_id
      JOIN match_played mp ON pb.match_no = mp.match_no
      WHERE pb.sent_off = 'Y'
      GROUP BY p.kfupm_id, p.name, t.team_name
      ORDER BY red_cards_count DESC;
    `);

    res.status(200).json({ success: true, data: redCards });
  } catch (err) {
    console.error('Error fetching red cards:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 4) Dashboard - Browse all members of a selected team including manager, coach, captain, and players
router.get('/dashboard/team/members/:teamId', async (req, res) => {
  const { teamId } = req.params;
  
  // Input validation
  if (!teamId || isNaN(parseInt(teamId))) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid team ID' 
    });
  }
  
  try {
    // Get team name first
    const [teamInfo] = await pool.query(`
      SELECT team_name FROM team WHERE team_id = ?
    `, [teamId]);
    
    if (teamInfo.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Team not found' 
      });
    }
    
    // Get support staff (coaches, managers)
    const [supportStaff] = await pool.query(`
      SELECT
        p.kfupm_id,
        p.name AS member_name,
        s.support_desc AS role,
        ts.support_type AS role_code
      FROM person p
      JOIN team_support ts ON ts.support_id = p.kfupm_id
      JOIN support s ON ts.support_type = s.support_type
      WHERE ts.team_id = ?
    `, [teamId]);

    // Get captains
    const [captains] = await pool.query(`
      SELECT
        p.kfupm_id,
        p.name AS member_name,
        'Captain' AS role,
        mc.match_no
      FROM person p
      JOIN match_captain mc ON mc.player_captain = p.kfupm_id
      WHERE mc.team_id = ?
    `, [teamId]);

    // Get players
    const [players] = await pool.query(`
      SELECT
        p.kfupm_id,
        p.name AS member_name,
        pp.position_desc AS position,
        pl.jersey_no
      FROM person p
      JOIN player pl ON pl.player_id = p.kfupm_id
      JOIN playing_position pp ON pl.position_to_play = pp.position_id
      JOIN team_player tp ON tp.player_id = p.kfupm_id
      WHERE tp.team_id = ?
      GROUP BY p.kfupm_id, p.name, pp.position_desc, pl.jersey_no
    `, [teamId]);

    // Categorize support staff
    const coaches = supportStaff.filter(s => s.role_code === 'CH');
    const assistantCoaches = supportStaff.filter(s => s.role_code === 'AC');
    const managers = [...coaches]; // In this schema, coaches can be considered as managers

    res.status(200).json({
      success: true,
      data: {
        team: teamInfo[0],
        managers,
        coaches,
        assistantCoaches,
        captains,
        players
      }
    });
  } catch (err) {
    console.error('Error fetching team members:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 5) Dashboard - Browse all players in a given tournament sorted by their total goals
router.get('/dashboard/tournament/:trId/players', async (req, res) => {
  const { trId } = req.params;
  
  // Input validation
  if (!trId || isNaN(parseInt(trId))) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid tournament ID' 
    });
  }
  
  try {
    const [players] = await pool.query(`
      SELECT 
        p.kfupm_id AS player_id,
        p.name AS player_name,
        t.team_name,
        COUNT(gd.goal_id) AS total_goals,
        SUM(CASE WHEN gd.goal_type = 'P' THEN 1 ELSE 0 END) AS penalty_goals,
        (COUNT(gd.goal_id) - SUM(CASE WHEN gd.goal_type = 'P' THEN 1 ELSE 0 END)) AS non_penalty_goals,
        pl.position_to_play AS position
      FROM person p
      JOIN player pl ON p.kfupm_id = pl.player_id
      JOIN goal_details gd ON pl.player_id = gd.player_id
      JOIN team t ON gd.team_id = t.team_id
      JOIN tournament_team tt ON t.team_id = tt.team_id
      WHERE tt.tr_id = ?
      GROUP BY p.kfupm_id, p.name, t.team_name, pl.position_to_play
      ORDER BY total_goals DESC;
    `, [trId]);

    res.status(200).json({ success: true, data: players });
  } catch (err) {
    console.error('Error fetching players by goals:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 6) Dashboard - Browse the top 5 teams by the most wins in a tournament
router.get('/dashboard/tournament/:trId/top-teams', async (req, res) => {
  const { trId } = req.params;
  
  // Input validation
  if (!trId || isNaN(parseInt(trId))) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid tournament ID' 
    });
  }
  
  try {
    const [topTeams] = await pool.query(`
      SELECT 
        t.team_name, 
        tt.won AS wins,
        tt.draw AS draws,
        tt.lost AS losses,
        tt.goal_for AS goals_for,
        tt.goal_against AS goals_against,
        tt.points
      FROM tournament_team tt
      JOIN team t ON tt.team_id = t.team_id
      WHERE tt.tr_id = ?
      ORDER BY tt.points DESC, tt.goal_diff DESC
      LIMIT 5;
    `, [trId]);

    res.status(200).json({ success: true, data: topTeams });
  } catch (err) {
    console.error('Error fetching top teams:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 7) Dashboard - Browse the most recent match played in a tournament
router.get('/dashboard/tournament/:trId/recent-match', async (req, res) => {
  const { trId } = req.params;
  
  // Input validation
  if (!trId || isNaN(parseInt(trId))) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid tournament ID' 
    });
  }
  
  try {
    const [recentMatch] = await pool.query(`
      SELECT 
        mp.match_no,
        t1.team_name AS team1,
        t2.team_name AS team2,
        mp.goal_score AS score,
        DATE_FORMAT(mp.play_date, '%Y-%m-%d') AS match_date,
        mp.audience,
        v.venue_name,
        p.name AS player_of_match
      FROM match_played mp
      JOIN team t1 ON mp.team_id1 = t1.team_id
      JOIN team t2 ON mp.team_id2 = t2.team_id
      JOIN tournament_team tt1 ON mp.team_id1 = tt1.team_id
      JOIN tournament_team tt2 ON mp.team_id2 = tt2.team_id
      JOIN venue v ON mp.venue_id = v.venue_id
      JOIN person p ON mp.player_of_match = p.kfupm_id
      WHERE tt1.tr_id = ? AND tt2.tr_id = ?
      ORDER BY mp.play_date DESC
      LIMIT 1;
    `, [trId, trId]);

    // If no match found
    if (recentMatch.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matches found for this tournament'
      });
    }

    res.status(200).json({ success: true, data: recentMatch[0] });
  } catch (err) {
    console.error('Error fetching recent match:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 8) Dashboard - Browse the highest goal scorer for each team in a given tournament
router.get('/dashboard/tournament/:trId/highest-scorers', async (req, res) => {
  const { trId } = req.params;
  
  // Input validation
  if (!trId || isNaN(parseInt(trId))) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid tournament ID' 
    });
  }
  
  try {
    // We could use window functions, but MySQL might not support them depending on version
    // Using a subquery approach that works across MySQL versions
    const [highestScorers] = await pool.query(`
      SELECT 
        t.team_id,
        t.team_name,
        p.kfupm_id,
        p.name AS player_name,
        COUNT(gd.goal_id) AS total_goals,
        pl.jersey_no,
        pl.position_to_play
      FROM goal_details gd
      JOIN player pl ON gd.player_id = pl.player_id
      JOIN person p ON pl.player_id = p.kfupm_id
      JOIN team t ON gd.team_id = t.team_id
      JOIN tournament_team tt ON t.team_id = tt.team_id AND tt.tr_id = ?
      GROUP BY t.team_id, t.team_name, p.kfupm_id, p.name, pl.jersey_no, pl.position_to_play
      HAVING total_goals = (
        SELECT MAX(goal_count)
        FROM (
          SELECT COUNT(gd2.goal_id) AS goal_count
          FROM goal_details gd2
          WHERE gd2.team_id = t.team_id
          GROUP BY gd2.player_id
        ) AS max_goals
      )
      ORDER BY t.team_name, total_goals DESC;
    `, [trId]);

    res.status(200).json({ success: true, data: highestScorers });
  } catch (err) {
    console.error('Error fetching highest scorers by team:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 9) Dashboard - Get tournament standings/table
router.get('/dashboard/tournament/:trId/standings', async (req, res) => {
  const { trId } = req.params;
  
  // Input validation
  if (!trId || isNaN(parseInt(trId))) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid tournament ID' 
    });
  }
  
  try {
    const [standings] = await pool.query(`
      SELECT 
        t.team_name,
        tt.team_group AS 'group',
        tt.match_played,
        tt.won,
        tt.draw,
        tt.lost,
        tt.goal_for,
        tt.goal_against,
        tt.goal_diff,
        tt.points,
        tt.group_position
      FROM tournament_team tt
      JOIN team t ON tt.team_id = t.team_id
      WHERE tt.tr_id = ?
      ORDER BY tt.team_group, tt.group_position;
    `, [trId]);

    res.status(200).json({ success: true, data: standings });
  } catch (err) {
    console.error('Error fetching tournament standings:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// Add this route to guestRoutes.js
router.get('/dashboard/red-cards/team/:teamId', async (req, res) => {
  const { teamId } = req.params;
  
  if (!teamId || isNaN(Number(teamId))) {
    return res.status(400).json({
      success: false,
      message: 'Invalid team ID'
    });
  }

  try {
    const [redCardsByTeam] = await pool.query(`
      SELECT 
        p.kfupm_id, 
        p.name, 
        COUNT(*) AS red_cards_count,
        MAX(DATE_FORMAT(mp.play_date, '%Y-%m-%d')) AS last_red_card_date
      FROM player_booked pb
      JOIN player pl ON pb.player_id = pl.player_id
      JOIN person p ON pl.player_id = p.kfupm_id
      JOIN match_played mp ON pb.match_no = mp.match_no
      WHERE pb.sent_off = 'Y' AND pb.team_id = ?
      GROUP BY p.kfupm_id, p.name
      ORDER BY red_cards_count DESC;
    `, [teamId]);

    res.status(200).json({ success: true, data: redCardsByTeam });
  } catch (err) {
    console.error('Error fetching red cards by team:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


module.exports = router;
