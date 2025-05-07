const express = require('express');
const { pool } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();

// Helper to load tournament for a given team
const getTournamentJoin = `
  JOIN tournament_team tt ON ht.team_id = tt.team_id
  JOIN tournament t ON tt.tr_id = t.tr_id
`;

/**
 * @route   GET /api/matches
 * @desc    List all matches, with optional filters by tournament, team or status
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    let sql = `
      SELECT 
        mp.match_no      AS id,
        ht.team_name     AS home_team_name,
        at.team_name     AS away_team_name,
        t.tr_name        AS tournament_name,
        mp.play_stage    AS stage,
        mp.play_date     AS match_date,
        mp.goal_score    AS score,       -- e.g. "2-1"
        mp.results       AS result,      -- e.g. "WIN","DRAW","LOSS"
        mp.decided_by    AS decided_by,  -- N or P
        mp.venue_id      AS venue_id,
        mp.audience      AS audience,
        mp.player_of_match AS player_of_match
      FROM match_played mp
      JOIN team ht ON mp.team_id1 = ht.team_id
      JOIN team at ON mp.team_id2 = at.team_id
      ${getTournamentJoin}
      WHERE 1=1
    `;
    const params = [];

    // Filter by tournament
    if (req.query.tr_id) {
      sql += ' AND t.tr_id = ?';
      params.push(req.query.tr_id);
    }

    // Filter by team
    if (req.query.team_id) {
      sql += ' AND (mp.team_id1 = ? OR mp.team_id2 = ?)';
      params.push(req.query.team_id, req.query.team_id);
    }

    // Filter by result status
    if (req.query.result) {
      sql += ' AND mp.results = ?';
      params.push(req.query.result.toUpperCase());
    }

    // Sorting
    if (req.query.sort_by === 'date_desc') {
      sql += ' ORDER BY mp.play_date DESC';
    } else {
      sql += ' ORDER BY mp.play_date ASC';
    }

    const [matches] = await pool.query(sql, params);
    return res.json({ success: true, count: matches.length, data: matches });
  } catch (err) {
    console.error('Get matches error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/matches/:id
 * @desc    Get a single match with its detailed events
 * @access  Public
 */
router.get('/:id', async (req, res) => {
  try {
    // 1) load the match itself
    const [rows] = await pool.query(
      `
      SELECT 
        mp.match_no      AS id,
        ht.team_name     AS home_team_name,
        at.team_name     AS away_team_name,
        t.tr_name        AS tournament_name,
        mp.play_stage,
        mp.play_date,
        mp.goal_score AS score,
        mp.results,
        mp.decided_by,
        mp.venue_id,
        mp.audience,
        mp.player_of_match
      FROM match_played mp
      JOIN team ht ON mp.team_id1 = ht.team_id
      JOIN team at ON mp.team_id2 = at.team_id
      JOIN tournament_team tt ON ht.team_id = tt.team_id
      JOIN tournament t ON tt.tr_id = t.tr_id
      WHERE mp.match_no = ?
      `
    , [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }
    const match = rows[0];

    // 2) load per-team details (goals, penalties, bookings, etc.)
    const [details] = await pool.query(
      `
      SELECT 
        md.team_id,
        t.team_name,
        md.win_lose,
        md.decided_by,
        md.goal_score      AS goals,
        md.penalty_score   AS penalties,
        md.player_gk       AS goalkeeper
      FROM match_details md
      JOIN team t ON md.team_id = t.team_id
      WHERE md.match_no = ?
      `
    , [req.params.id]);

    // 3) load goal-by-goal
    const [goals] = await pool.query(
      `
      SELECT 
        gd.goal_id,
        gd.team_id,
        t.team_name,
        gd.player_id,
        p.name         AS player_name,
        gd.goal_time,
        gd.goal_type,
        gd.play_stage,
        gd.goal_schedule,
        gd.goal_half
      FROM goal_details gd
      JOIN player p ON gd.player_id = p.player_id
      JOIN team t   ON gd.team_id   = t.team_id
      WHERE gd.match_no = ?
      ORDER BY gd.goal_time ASC
      `
    , [req.params.id]);

    // 4) load penalty shootout kicks
    const [shootout] = await pool.query(
      `
      SELECT 
        ps.kick_id,
        ps.team_id,
        t.team_name,
        ps.player_id,
        p.name AS player_name,
        ps.score_goal,
        ps.kick_no
      FROM penalty_shootout ps
      JOIN player p ON ps.player_id = p.player_id
      JOIN team t   ON ps.team_id   = t.team_id
      WHERE ps.match_no = ?
      ORDER BY ps.kick_no ASC
      `
    , [req.params.id]);

    // Package everything
    match.details   = details;
    match.goals     = goals;
    match.shootout  = shootout;
    return res.json({ success: true, data: match });
  } catch (err) {
    console.error('Get match error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/matches
 * @desc    Create a new match
 * @access  Admin only
 */
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const {
      play_stage,
      play_date,
      team_id1,
      team_id2,
      results = 'DRAW',
      decided_by = 'N',
      goal_score = '0-0',
      venue_id,
      audience = 0,
      player_of_match,
      stop1_sec = 0,
      stop2_sec = 0
    } = req.body;

    // basic validation
    if (!play_stage || !play_date || !team_id1 || !team_id2 || !venue_id || !player_of_match) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (team_id1 === team_id2) {
      return res.status(400).json({ success: false, message: 'Teams must be different' });
    }

    // also ensure both teams participate in the same tournament
    const [tt1] = await pool.query(
      `SELECT tr_id FROM tournament_team WHERE team_id = ?`,
      [team_id1]
    );
    const [tt2] = await pool.query(
      `SELECT tr_id FROM tournament_team WHERE team_id = ?`,
      [team_id2]
    );
    if (!tt1.length || !tt2.length || tt1[0].tr_id !== tt2[0].tr_id) {
      return res.status(400).json({ success: false, message: 'Teams are not in the same tournament' });
    }

    // insert
    const [ins] = await pool.query(
      `INSERT INTO match_played
         (play_stage, play_date, team_id1, team_id2, results, decided_by, goal_score,
          venue_id, audience, player_of_match, stop1_sec, stop2_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [play_stage, play_date, team_id1, team_id2, results, decided_by, goal_score,
       venue_id, audience, player_of_match, stop1_sec, stop2_sec]
    );

    // return the newly created match
    const [rows] = await pool.query(
      `SELECT match_no AS id, play_stage, play_date, team_id1, team_id2,
              results, decided_by, goal_score, venue_id, audience, player_of_match
       FROM match_played
       WHERE match_no = ?`,
      [ins.insertId]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Create match error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   PUT /api/matches/:id/result
 * @desc    Update only the result fields of a match
 * @access  Admin only
 */
router.put('/:id/result', auth, adminOnly, async (req, res) => {
  try {
    const { results, decided_by, goal_score } = req.body;
    if (!results || !decided_by || !goal_score) {
      return res.status(400).json({ success: false, message: 'Missing result fields' });
    }
    // ensure exists
    const [m] = await pool.query(
      `SELECT match_no FROM match_played WHERE match_no = ?`,
      [req.params.id]
    );
    if (!m.length) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }
    // update
    await pool.query(
      `UPDATE match_played
         SET results = ?, decided_by = ?, goal_score = ?
       WHERE match_no = ?`,
      [results, decided_by, goal_score, req.params.id]
    );
    return res.json({ success: true, message: 'Result updated' });
  } catch (err) {
    console.error('Update result error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
