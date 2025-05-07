// server/routes/statsRoutes.js

const express = require('express');
const { pool } = require('../config/db');
const router = express.Router();

/**
 * GET /api/stats/top-scorers
 * Top 10 goal scorers across all tournaments.
 */
router.get('/top-scorers', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        per.kfupm_id               AS id,
        per.name                   AS name,
        pl.jersey_no               AS jersey,
        pp.position_desc           AS position,
        t.team_name                AS team_name,
        tr.tr_name                 AS tournament_name,
        COUNT(*)                   AS goals
      FROM goal_details gd
      JOIN player pl
        ON gd.player_id = pl.player_id
      JOIN person per
        ON pl.player_id = per.kfupm_id
      JOIN playing_position pp
        ON pl.position_to_play = pp.position_id
      JOIN team_player tp
        ON gd.player_id = tp.player_id
       AND gd.team_id   = tp.team_id
      JOIN team t
        ON tp.team_id    = t.team_id
      JOIN tournament tr
        ON tp.tr_id      = tr.tr_id
      GROUP BY gd.player_id, tp.tr_id
      ORDER BY goals DESC
      LIMIT 10
    `);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Get top scorers error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/stats/red-cards
 * All players who received red cards, optional ?tr_id= filter.
 */
router.get('/red-cards', async (req, res) => {
  const { tr_id } = req.query;

  try {
    let sql = `
      SELECT
        per.kfupm_id               AS id,
        per.name                   AS name,
        pl.jersey_no               AS jersey,
        pp.position_desc           AS position,
        t.team_name                AS team_name,
        tr.tr_name                 AS tournament_name,
        COUNT(*)                   AS red_cards
      FROM player_booked pb
      JOIN player pl
        ON pb.player_id = pl.player_id
      JOIN person per
        ON pl.player_id = per.kfupm_id
      JOIN playing_position pp
        ON pl.position_to_play = pp.position_id
      JOIN team_player tp
        ON pb.player_id = tp.player_id
       AND pb.team_id    = tp.team_id
      JOIN team t
        ON tp.team_id    = t.team_id
      JOIN tournament tr
        ON tp.tr_id      = tr.tr_id
      WHERE pb.sent_off = 'Y'
    `;

    const params = [];
    if (tr_id) {
      sql += ' AND tp.tr_id = ?';
      params.push(tr_id);
    }

    sql += `
      GROUP BY pb.player_id, tp.tr_id
      ORDER BY red_cards DESC, per.name ASC
    `;

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Get red cards error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/stats/tournament/:id
 * Detailed stats for a single tournament:
 *  - standings
 *  - top 5 scorers
 *  - 5 recent completed matches
 *  - 5 upcoming matches
 */
router.get('/tournament/:id', async (req, res) => {
  const trId = req.params.id;

  try {
    // 1) Verify tournament
    const [tours] = await pool.query(
      `SELECT tr_id AS id, tr_name AS name, start_date, end_date
       FROM tournament
       WHERE tr_id = ?`,
      [trId]
    );
    if (!tours.length) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    const tournament = tours[0];

    // 2) Standings
    const [standings] = await pool.query(`
      SELECT
        t.team_id            AS id,
        t.team_name          AS name,
        tt.team_group        AS \`group\`,
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
      JOIN team t
        ON tt.team_id = t.team_id
      WHERE tt.tr_id = ?
      ORDER BY tt.points DESC, tt.goal_diff DESC, tt.goal_for DESC
    `, [trId]);
    tournament.standings = standings;

    // 3) Top 5 scorers
    const [topScorers] = await pool.query(`
      SELECT
        per.kfupm_id               AS id,
        per.name                   AS name,
        pl.jersey_no               AS jersey,
        pp.position_desc           AS position,
        t.team_name                AS team_name,
        COUNT(*)                   AS goals
      FROM goal_details gd
      JOIN team_player tp
        ON gd.player_id = tp.player_id
       AND gd.team_id    = tp.team_id
      JOIN player pl
        ON gd.player_id = pl.player_id
      JOIN person per
        ON pl.player_id = per.kfupm_id
      JOIN playing_position pp
        ON pl.position_to_play = pp.position_id
      JOIN team t
        ON tp.team_id    = t.team_id
      WHERE tp.tr_id = ?
      GROUP BY gd.player_id
      ORDER BY goals DESC
      LIMIT 5
    `, [trId]);
    tournament.topScorers = topScorers;

    // 4) 5 recent completed matches
    const [recentMatches] = await pool.query(`
      SELECT
        mp.match_no               AS id,
        mp.play_stage             AS stage,
        mp.play_date              AS date,
        home.team_name            AS home_team,
        away.team_name            AS away_team,
        -- split goal_score 'X-Y'
        CAST(SUBSTRING_INDEX(mp.goal_score,'-',1)  AS UNSIGNED) AS home_score,
        CAST(SUBSTRING_INDEX(mp.goal_score,'-',-1) AS UNSIGNED) AS away_score,
        v.venue_name              AS venue
      FROM match_played mp
      JOIN tournament_team tt1
        ON mp.team_id1 = tt1.team_id
       AND tt1.tr_id    = ?
      JOIN team home
        ON mp.team_id1 = home.team_id
      JOIN team away
        ON mp.team_id2 = away.team_id
      JOIN venue v
        ON mp.venue_id = v.venue_id
      WHERE mp.results IN ('WIN','LOSS','DRAW')
      ORDER BY mp.play_date DESC
      LIMIT 5
    `, [trId]);
    tournament.recentMatches = recentMatches;

    // 5) 5 upcoming matches
    const [upcomingMatches] = await pool.query(`
      SELECT
        mp.match_no    AS id,
        mp.play_stage  AS stage,
        mp.play_date   AS date,
        home.team_name AS home_team,
        away.team_name AS away_team,
        v.venue_name   AS venue
      FROM match_played mp
      JOIN tournament_team tt1
        ON mp.team_id1 = tt1.team_id
       AND tt1.tr_id    = ?
      JOIN team home
        ON mp.team_id1 = home.team_id
      JOIN team away
        ON mp.team_id2 = away.team_id
      JOIN venue v
        ON mp.venue_id = v.venue_id
      WHERE mp.play_date > NOW()
      ORDER BY mp.play_date ASC
      LIMIT 5
    `, [trId]);
    tournament.upcomingMatches = upcomingMatches;

    res.json({ success: true, data: tournament });
  } catch (err) {
    console.error('Get tournament stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
