// server/routes/statsRoutes.js
const express = require('express');
const { pool } = require('../config/db');
const router = express.Router();

// --- 1️⃣ Top scorers across all tournaments ---
// GET /api/stats/top-scorers
router.get('/top-scorers', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        gd.player_id                       AS id,
        per.name                           AS player_name,
        pl.jersey_no                       AS jersey_number,
        pp.position_desc                   AS position,
        t.team_name                        AS team_name,
        COUNT(*)                           AS goals
      FROM goal_details gd
      JOIN player pl       ON gd.player_id = pl.player_id
      JOIN person per      ON pl.player_id = per.kfupm_id
      JOIN playing_position pp ON pl.position_to_play = pp.position_id
      JOIN team t          ON gd.team_id = t.team_id
      GROUP BY gd.player_id, per.name, pl.jersey_no, pp.position_desc, t.team_name
      ORDER BY goals DESC
      LIMIT 10
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Get top scorers error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- 2️⃣ Players with red cards ---
// GET /api/stats/red-cards
router.get('/red-cards', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        pb.player_id         AS id,
        per.name             AS player_name,
        t.team_name          AS team_name,
        COUNT(*)             AS red_cards
      FROM player_booked pb
      JOIN person per       ON pb.player_id = per.kfupm_id
      JOIN team t           ON pb.team_id = t.team_id
      WHERE pb.sent_off = 'Y'
      GROUP BY pb.player_id, per.name, t.team_name
      ORDER BY red_cards DESC
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Get red cards error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- 3️⃣ Tournament-specific stats ---
// GET /api/stats/tournament/:id
router.get('/tournament/:id', async (req, res) => {
  const trId = req.params.id;
  try {
    // Validate tournament exists
    const [tourn] = await pool.query(
      'SELECT tr_id AS id, tr_name AS name FROM tournament WHERE tr_id = ?',
      [trId]
    );
    if (!tourn.length) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    // Standings from tournament_team
    const [standings] = await pool.query(`
      SELECT
        tt.team_id          AS id,
        t.team_name         AS name,
        tt.points,
        tt.won,
        tt.draw,
        tt.lost,
        tt.goal_for         AS goals_for,
        tt.goal_against     AS goals_against,
        tt.goal_diff
      FROM tournament_team tt
      JOIN team t ON tt.team_id = t.team_id
      WHERE tt.tr_id = ?
      ORDER BY tt.points DESC, tt.goal_diff DESC, tt.goal_for DESC
    `, [trId]);

    // Top scorers in this tournament
    const [topScorers] = await pool.query(`
      SELECT
        gd.player_id        AS id,
        per.name            AS player_name,
        t.team_name         AS team_name,
        COUNT(*)            AS goals
      FROM goal_details gd
      JOIN tournament_team tt 
        ON gd.team_id = tt.team_id AND tt.tr_id = ?
      JOIN person per      ON gd.player_id = per.kfupm_id
      JOIN team t          ON gd.team_id = t.team_id
      GROUP BY gd.player_id, per.name, t.team_name
      ORDER BY goals DESC
      LIMIT 5
    `, [trId]);

    // 5 most recent matches (any status)
    const [recentMatches] = await pool.query(`
      SELECT
        mp.match_no         AS id,
        mp.play_date        AS date,
        home.team_name      AS home_team,
        away.team_name      AS away_team,
        mp.goal_score       AS score,
        mp.results          AS result
      FROM match_played mp
      JOIN tournament_team tt1 
        ON mp.team_id1 = tt1.team_id AND tt1.tr_id = ?
      JOIN tournament_team tt2 
        ON mp.team_id2 = tt2.team_id AND tt2.tr_id = ?
      JOIN team home       ON mp.team_id1 = home.team_id
      JOIN team away       ON mp.team_id2 = away.team_id
      ORDER BY mp.play_date DESC
      LIMIT 5
    `, [trId, trId]);

    // 5 upcoming matches
    const [upcomingMatches] = await pool.query(`
      SELECT
        mp.match_no         AS id,
        mp.play_date        AS date,
        home.team_name      AS home_team,
        away.team_name      AS away_team
      FROM match_played mp
      JOIN tournament_team tt1 
        ON mp.team_id1 = tt1.team_id AND tt1.tr_id = ?
      JOIN tournament_team tt2 
        ON mp.team_id2 = tt2.team_id AND tt2.tr_id = ?
      JOIN team home       ON mp.team_id1 = home.team_id
      JOIN team away       ON mp.team_id2 = away.team_id
      WHERE mp.play_date > NOW()
      ORDER BY mp.play_date ASC
      LIMIT 5
    `, [trId, trId]);

    res.json({
      success: true,
      data: {
        tournament: tourn[0],
        standings,
        topScorers,
        recentMatches,
        upcomingMatches
      }
    });
  } catch (err) {
    console.error('Get tournament stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
