// server/routes/guestRoutes.js
const express = require('express');
const { pool } = require('../config/db'); // MySQL connection
const router = express.Router();

// Get all tournaments
router.get('/tournaments', async (req, res) => {
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

// Get all teams
router.get('/teams', async (req, res) => {
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

// 1) Browse all match results of a given tournament sorted by date
router.get('/matches/tournament/:trId', async (req, res) => {
  const { trId } = req.params;
  try {
    const [matches] = await pool.query(`
      SELECT 
        t11.team_name AS team1, 
        t22.team_name AS team2, 
        mp.goal_score
      FROM 
        match_played mp
      JOIN tournament_team t1 ON mp.team_id1 = t1.team_id
      JOIN tournament_team t2 ON mp.team_id2 = t2.team_id
      JOIN team t11 ON t1.team_id = t11.team_id
      JOIN team t22 ON t2.team_id = t22.team_id
      WHERE t1.tr_id = ? 
      ORDER BY mp.play_date;
    `, [trId]);

    res.status(200).json({ success: true, data: matches });
  } catch (err) {
    console.error('Error fetching match results:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 2) Browse the player with the highest goal scored in all the tournaments
router.get('/top-scorer', async (req, res) => {
  try {
    const [topScorer] = await pool.query(`
      SELECT 
        p.kfupm_id, 
        p.name, 
        COUNT(*) AS goals_scored
      FROM 
        person p
      JOIN player pl ON p.kfupm_id = pl.player_id
      JOIN goal_details gd ON pl.player_id = gd.player_id
      GROUP BY p.kfupm_id, p.name
      ORDER BY goals_scored DESC
      LIMIT 1;
    `);

    res.status(200).json({ success: true, data: topScorer });
  } catch (err) {
    console.error('Error fetching top scorer:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 3) Browse the players who received red cards in each team
router.get('/red-cards', async (req, res) => {
  try {
    const [redCards] = await pool.query(`
      SELECT 
        p.kfupm_id, 
        p.name, 
        t.team_name,
        COUNT(*) AS red_cards_count
      FROM player_booked pb
      JOIN team t ON pb.team_id = t.team_id
      JOIN player pl ON pb.player_id = pl.player_id
      JOIN person p ON pl.player_id = p.kfupm_id
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

// 4) Browse all members of a selected team including manager, coach, captain, and players
router.get('/team/members/:teamId', async (req, res) => {
  const { teamId } = req.params;
  try {
    const [teamMembers] = await pool.query(`
      SELECT
        p.Name            AS member_name,
        CASE ts.support_type
          WHEN 'CH' THEN 'Coach'
          WHEN 'AC' THEN 'Assistant Coach'
        END                AS role
      FROM Person p
      JOIN team_support ts
        ON ts.support_id = p.kfupm_id
      WHERE ts.team_id = ?

      UNION ALL

      SELECT
        p.Name            AS member_name,
        'Captain'         AS role
      FROM Person p
      JOIN match_captain mc
        ON mc.player_captain = p.kfupm_id
      WHERE mc.team_id = ?

      UNION ALL

      SELECT
        p.Name            AS member_name,
        'Player'          AS role
      FROM Person p
      JOIN team_player tp
        ON tp.player_id = p.kfupm_id
      WHERE tp.team_id = ?;
    `, [teamId, teamId, teamId]);

    const managers  = teamMembers.filter(m => m.role === 'Coach');
    const coaches   = teamMembers.filter(m => m.role === 'Assistant Coach');
    const captains  = teamMembers.filter(m => m.role === 'Captain');
    const players   = teamMembers.filter(m => m.role === 'Player');

    res.status(200).json({
      success: true,
      data: { managers, coaches, captains, players }
    });
  } catch (err) {
    console.error('Error fetching team members:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



// 5) Extra: Browse all players in a given tournament sorted by their total goals
router.get('/tournament/:trId/players', async (req, res) => {
  const { trId } = req.params;
  try {
    const [players] = await pool.query(`
      SELECT 
        p.kfupm_id AS player_id,
        p.name AS player_name,
        t.team_name,
        COUNT(gd.goal_id) AS total_goals,
        SUM(CASE WHEN gd.goal_type = 'P' THEN 1 ELSE 0 END) AS penalty_goals,
        (COUNT(gd.goal_id) - SUM(CASE WHEN gd.goal_type = 'P' THEN 1 ELSE 0 END)) AS non_penalty_goals
      FROM PERSON p
      JOIN PLAYER pl ON p.kfupm_id = pl.player_id
      JOIN GOAL_DETAILS gd ON pl.player_id = gd.player_id
      JOIN TEAM t ON gd.team_id = t.team_id
      JOIN TOURNAMENT_TEAM tt ON t.team_id = tt.team_id
      WHERE tt.tr_id = ?
      GROUP BY p.kfupm_id, p.name, t.team_name
      ORDER BY total_goals DESC;
    `, [trId]);

    res.status(200).json({ success: true, data: players });
  } catch (err) {
    console.error('Error fetching players by goals:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

// 6) Browse the top 5 teams by the most wins in a tournament
router.get('/tournament/:trId/top-teams', async (req, res) => {
  const { trId } = req.params;
  try {
    const [topTeams] = await pool.query(`
      SELECT team_name, COUNT(*) AS wins
      FROM (
        SELECT t1.team_id
        FROM match_played mp
        JOIN tournament_team t1 ON mp.team_id1 = t1.team_id 
        WHERE t1.tr_id = ? AND mp.results = 'WIN'
        UNION ALL
        SELECT t2.team_id
        FROM match_played mp
        JOIN tournament_team t2 ON mp.team_id2 = t2.team_id 
        WHERE t2.tr_id = ? AND mp.results = 'LOSS'
      ) AS wins
      JOIN team ON team.team_id = wins.team_id
      GROUP BY team_name
      ORDER BY wins DESC
      LIMIT 5;
    `, [trId, trId]);

    res.status(200).json({ success: true, data: topTeams });
  } catch (err) {
    console.error('Error fetching top teams:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 7) Browse the most recent match played in a tournament
// Browse the most recent match played in a tournament (date only)
router.get('/tournament/:trId/recent-match', async (req, res) => {
  const { trId } = req.params;
  try {
    const [rows] = await pool.query(`
      SELECT 
        t1.team_name      AS team1,
        t2.team_name      AS team2,
        mp.goal_score     AS score,
        DATE(mp.play_date) AS match_date
      FROM MATCH_PLAYED mp
      JOIN TOURNAMENT_TEAM tt1 ON mp.team_id1 = tt1.team_id
      JOIN TEAM t1            ON tt1.team_id = t1.team_id
      JOIN TOURNAMENT_TEAM tt2 ON mp.team_id2 = tt2.team_id
      JOIN TEAM t2            ON tt2.team_id = t2.team_id
      WHERE tt1.tr_id = ?
      ORDER BY mp.play_date DESC
      LIMIT 1;
    `, [trId]);

    // rows[0] now has match_date formatted as 'YYYY-MM-DD'
    res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Error fetching recent match:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// 8) Browse the highest goal scorer for each team in a given tournament
router.get('/tournament/:trId/highest-scorers', async (req, res) => {
  const { trId } = req.params;
  try {
    const [highestScorers] = await pool.query(`
      WITH per_player AS (
        SELECT 
          t.team_id,
          t.team_name,
          p.kfupm_id,
          p.name        AS player_name,
          COUNT(gd.goal_id) AS total_goals
        FROM goal_details gd
        JOIN player pl    ON gd.player_id = pl.player_id
        JOIN person p     ON pl.player_id = p.kfupm_id
        JOIN tournament_team tt ON gd.team_id = tt.team_id
        JOIN team t       ON t.team_id = gd.team_id
        WHERE tt.tr_id = ?
        GROUP BY t.team_id, p.kfupm_id, p.name
      ),
      ranked AS (
        SELECT 
          *,
          ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY total_goals DESC) AS rn
        FROM per_player
      )
      SELECT team_name, player_name, total_goals
      FROM ranked
      WHERE rn = 1;
    `, [trId]);

    res.status(200).json({ success: true, data: highestScorers });
  } catch (err) {
    console.error('Error fetching highest scorers by team:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
