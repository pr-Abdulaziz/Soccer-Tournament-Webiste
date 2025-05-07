// routes/tournamentRoutes.js

const express = require('express');
const { pool } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/tournaments
// @desc    List all tournaments, with team_count and match_count
// @access  Public
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        t.tr_id        AS id,
        t.tr_name      AS name,
        t.start_date,
        t.end_date,
        COUNT(DISTINCT tt.team_id) AS team_count,
        /* count any match where either side plays in this tournament */
        (
          SELECT COUNT(DISTINCT mp.match_no)
          FROM match_played mp
          JOIN tournament_team tt2
            ON (mp.team_id1 = tt2.team_id OR mp.team_id2 = tt2.team_id)
           AND tt2.tr_id = t.tr_id
        ) AS match_count
      FROM tournament t
      LEFT JOIN tournament_team tt
        ON tt.tr_id = t.tr_id
      GROUP BY t.tr_id
      ORDER BY t.start_date DESC
      `
    );

    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (err) {
    console.error('Get tournaments error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/tournaments/:id
// @desc    Get one tournament, plus its teams and matches
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const trId = req.params.id;

    // 1) tournament details
    const [tournaments] = await pool.query(
      `
      SELECT
        tr_id   AS id,
        tr_name AS name,
        start_date,
        end_date
      FROM tournament
      WHERE tr_id = ?
      `,
      [trId]
    );
    if (!tournaments.length) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    const tournament = tournaments[0];

    // 2) teams in this tournament
    const [teams] = await pool.query(
      `
      SELECT
        t.team_id    AS id,
        t.team_name  AS name,
        tt.team_group,
        tt.points
      FROM team t
      JOIN tournament_team tt
        ON tt.team_id = t.team_id
       AND tt.tr_id   = ?
      ORDER BY tt.points DESC, tt.goal_diff DESC
      `,
      [trId]
    );

    // 3) matches where both sides belong to this tournament
    const [matches] = await pool.query(
      `
      SELECT
        mp.match_no   AS id,
        mp.play_stage AS stage,
        mp.play_date  AS date,
        ht.team_name  AS home_team,
        at.team_name  AS away_team,
        mp.goal_score AS score,
        mp.results    AS result
      FROM match_played mp
      JOIN team ht
        ON mp.team_id1 = ht.team_id
      JOIN team at
        ON mp.team_id2 = at.team_id
      /* ensure both home & away are in this tournament */
      JOIN tournament_team tt1
        ON tt1.team_id = ht.team_id
       AND tt1.tr_id   = ?
      JOIN tournament_team tt2
        ON tt2.team_id = at.team_id
       AND tt2.tr_id   = ?
      ORDER BY mp.play_date ASC
      `,
      [trId, trId]
    );

    tournament.teams   = teams;
    tournament.matches = matches;

    res.status(200).json({ success: true, data: tournament });
  } catch (err) {
    console.error('Get tournament error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/tournaments
// @desc    Create a new tournament
// @access  Private (admin only)
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, start_date, and end_date'
      });
    }

    const [result] = await pool.query(
      `
      INSERT INTO tournament (tr_name, start_date, end_date)
      VALUES (?, ?, ?)
      `,
      [name, start_date, end_date]
    );

    const insertedId = result.insertId;
    const [rows] = await pool.query(
      `
      SELECT tr_id AS id, tr_name AS name, start_date, end_date
      FROM tournament
      WHERE tr_id = ?
      `,
      [insertedId]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Create tournament error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/tournaments/:id
// @desc    Update a tournament
// @access  Private (admin only)
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const trId = req.params.id;
    const { name, start_date, end_date } = req.body;

    const [exists] = await pool.query(
      `SELECT 1 FROM tournament WHERE tr_id = ?`,
      [trId]
    );
    if (!exists.length) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    await pool.query(
      `
      UPDATE tournament
         SET tr_name    = COALESCE(?, tr_name),
             start_date = COALESCE(?, start_date),
             end_date   = COALESCE(?, end_date)
       WHERE tr_id = ?
      `,
      [name, start_date, end_date, trId]
    );

    const [rows] = await pool.query(
      `
      SELECT tr_id AS id, tr_name AS name, start_date, end_date
      FROM tournament
      WHERE tr_id = ?
      `,
      [trId]
    );

    res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Update tournament error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/tournaments/:id
// @desc    Delete a tournament
// @access  Private (admin only)
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const trId = req.params.id;

    const [exists] = await pool.query(
      `SELECT 1 FROM tournament WHERE tr_id = ?`,
      [trId]
    );
    if (!exists.length) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    await pool.query(
      `DELETE FROM tournament WHERE tr_id = ?`,
      [trId]
    );

    res.status(200).json({ success: true, message: 'Tournament deleted successfully' });
  } catch (err) {
    console.error('Delete tournament error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
