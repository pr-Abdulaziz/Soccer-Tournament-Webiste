// server/routes/matchRoutes.js

const express = require('express');
const { pool } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/matches
 * List all matches, with optional filters:
 *   - ?tournament_id=#
 *   - ?team_id=#
 *   - ?status=upcoming|completed
 *   - ?sort_by=date_desc
 */
router.get('/', async (req, res) => {
  try {
    let sql = `
      SELECT
        mp.match_no                                AS id,
        t.tr_name                                  AS tournament_name,
        mp.play_stage                              AS stage,
        mp.play_date                               AS match_date,
        home.team_name                             AS home_team,
        away.team_name                             AS away_team,
        CAST(SUBSTRING_INDEX(mp.goal_score,'-',1)  AS UNSIGNED) AS home_score,
        CAST(SUBSTRING_INDEX(mp.goal_score,'-',-1) AS UNSIGNED) AS away_score,
        CASE WHEN mp.results IS NULL THEN 'upcoming' ELSE 'completed' END AS status,
        mp.results,
        mp.decided_by,
        v.venue_name                               AS venue,
        mp.audience,
        mp.player_of_match,
        mp.stop1_sec,
        mp.stop2_sec
      FROM match_played mp
      JOIN team         home ON mp.team_id1 = home.team_id
      JOIN team         away ON mp.team_id2 = away.team_id
      /* derive tournament via home team */
      JOIN tournament_team tt  ON mp.team_id1 = tt.team_id
      JOIN tournament      t   ON tt.tr_id     = t.tr_id
      JOIN venue         v    ON mp.venue_id  = v.venue_id
      WHERE 1=1
    `;
    const params = [];

    // filter by tournament
    if (req.query.tournament_id) {
      sql += ' AND t.tr_id = ?';
      params.push(req.query.tournament_id);
    }

    // filter by team
    if (req.query.team_id) {
      sql += ' AND (mp.team_id1 = ? OR mp.team_id2 = ?)';
      params.push(req.query.team_id, req.query.team_id);
    }

    // filter by status
    if (req.query.status === 'upcoming') {
      sql += ' AND mp.results IS NULL';
    } else if (req.query.status === 'completed') {
      sql += ' AND mp.results IS NOT NULL';
    }

    // sort
    if (req.query.sort_by === 'date_desc') {
      sql += ' ORDER BY mp.play_date DESC';
    } else {
      sql += ' ORDER BY mp.play_date ASC';
    }

    const [matches] = await pool.query(sql, params);
    res.json({ success: true, count: matches.length, data: matches });
  } catch (err) {
    console.error('Get matches error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/matches/:id
 * Get one match plus its events (team results, goals, shootout)
 */
router.get('/:id', async (req, res) => {
  try {
    const matchId = req.params.id;

    // 1) match header
    const [hdrs] = await pool.query(
      `
      SELECT
        mp.match_no                                AS id,
        t.tr_name                                  AS tournament_name,
        mp.play_stage                              AS stage,
        mp.play_date                               AS match_date,
        home.team_name                             AS home_team,
        away.team_name                             AS away_team,
        CAST(SUBSTRING_INDEX(mp.goal_score,'-',1)  AS UNSIGNED) AS home_score,
        CAST(SUBSTRING_INDEX(mp.goal_score,'-',-1) AS UNSIGNED) AS away_score,
        CASE WHEN mp.results IS NULL THEN 'upcoming' ELSE 'completed' END AS status,
        mp.results,
        mp.decided_by,
        v.venue_name                               AS venue,
        mp.audience,
        mp.player_of_match,
        mp.stop1_sec,
        mp.stop2_sec
      FROM match_played mp
      JOIN team         home ON mp.team_id1 = home.team_id
      JOIN team         away ON mp.team_id2 = away.team_id
      JOIN tournament_team tt  ON mp.team_id1 = tt.team_id
      JOIN tournament      t   ON tt.tr_id     = t.tr_id
      JOIN venue         v    ON mp.venue_id  = v.venue_id
      WHERE mp.match_no = ?
      `,
      [matchId]
    );
    if (!hdrs.length) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }
    const match = hdrs[0];

    // 2) per‐team result details
    const [details] = await pool.query(
      `
      SELECT
        md.team_id,
        tm.team_name,
        md.win_lose,
        md.decided_by,
        md.goal_score   AS goals,
        md.penalty_score AS penalties,
        md.player_gk    AS goalkeeper
      FROM match_details md
      JOIN team tm ON md.team_id = tm.team_id
      WHERE md.match_no = ?
      `,
      [matchId]
    );

    // 3) goal breakdown
    const [goals] = await pool.query(
      `
      SELECT
        gd.goal_id      AS id,
        gd.team_id,
        tm.team_name,
        gd.player_id,
        pr.name         AS player_name,
        gd.goal_time    AS minute,
        gd.goal_type,
        gd.play_stage,
        gd.goal_schedule,
        gd.goal_half
      FROM goal_details gd
      JOIN player pl   ON gd.player_id = pl.player_id
      JOIN person pr   ON pl.player_id = pr.kfupm__id
      JOIN team tm     ON gd.team_id = tm.team_id
      WHERE gd.match_no = ?
      ORDER BY gd.goal_time ASC
      `,
      [matchId]
    );

    // 4) penalty shootout
    const [shootout] = await pool.query(
      `
      SELECT
        ps.kick_id      AS id,
        ps.team_id,
        tm.team_name,
        ps.player_id,
        pr.name         AS player_name,
        ps.score_goal = 'Y' AS scored,
        ps.kick_no
      FROM penalty_shootout ps
      JOIN player pl   ON ps.player_id = pl.player_id
      JOIN person pr   ON pl.player_id = pr.kfupm__id
      JOIN team tm     ON ps.team_id = tm.team_id
      WHERE ps.match_no = ?
      ORDER BY ps.kick_no ASC
      `,
      [matchId]
    );

    match.details  = details;
    match.goals    = goals;
    match.shootout = shootout;

    res.json({ success: true, data: match });
  } catch (err) {
    console.error('Get match error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/matches
 * Create a new match (Admin only)
 */
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const {
      play_stage,
      play_date,
      team_id1,
      team_id2,
      results,
      decided_by,
      goal_score,
      venue_id,
      audience,
      player_of_match,
      stop1_sec,
      stop2_sec
    } = req.body;

    if (!play_stage || !play_date || !team_id1 || !team_id2 || !venue_id || !player_of_match) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (team_id1 === team_id2) {
      return res.status(400).json({ success: false, message: 'Home and away must differ' });
    }

    // ensure both teams in same tournament
    const [[t1]] = await pool.query(
      `SELECT tr_id FROM tournament_team WHERE team_id = ?`,
      [team_id1]
    );
    const [[t2]] = await pool.query(
      `SELECT tr_id FROM tournament_team WHERE team_id = ?`,
      [team_id2]
    );
    if (!t1 || !t2 || t1.tr_id !== t2.tr_id) {
      return res.status(400).json({ success: false, message: 'Teams not in same tournament' });
    }

    const [ins] = await pool.query(
      `
      INSERT INTO match_played
        (play_stage, play_date, team_id1, team_id2, results,
         decided_by, goal_score, venue_id, audience, player_of_match,
         stop1_sec, stop2_sec)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        play_stage, play_date, team_id1, team_id2,
        results || null, decided_by || null, goal_score || '0-0',
        venue_id, audience || 0, player_of_match,
        stop1_sec || 0, stop2_sec || 0
      ]
    );

    const [newMatch] = await pool.query(
      `SELECT match_no AS id, play_stage, play_date, team_id1, team_id2,
              results, decided_by, goal_score, venue_id, audience, player_of_match
       FROM match_played
       WHERE match_no = ?`,
      [ins.insertId]
    );

    res.status(201).json({ success: true, data: newMatch[0] });
  } catch (err) {
    console.error('Create match error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/matches/:id/result
 * Update only the result fields of a match (Admin only)
 */
router.put('/:id/result', auth, adminOnly, async (req, res) => {
  try {
    const { results, decided_by, goal_score } = req.body;
    if (results == null || decided_by == null || !goal_score) {
      return res.status(400).json({ success: false, message: 'Missing result data' });
    }

    const [[exists]] = await pool.query(
      `SELECT match_no FROM match_played WHERE match_no = ?`,
      [req.params.id]
    );
    if (!exists) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }

    await pool.query(
      `
      UPDATE match_played
        SET results    = ?,
            decided_by = ?,
            goal_score = ?
      WHERE match_no = ?
      `,
      [results, decided_by, goal_score, req.params.id]
    );

    res.json({ success: true, message: 'Match result updated' });
  } catch (err) {
    console.error('Update match result error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
