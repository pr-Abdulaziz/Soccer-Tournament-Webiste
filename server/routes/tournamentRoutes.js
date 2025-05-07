// server/routes/tournamentRoutes.js
const express = require('express');
const { pool } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();

// GET /api/tournaments
// — Returns all tournaments with team and match counts
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        t.tr_id      AS id,
        t.tr_name    AS name,
        t.start_date,
        t.end_date,
        COUNT(DISTINCT tt.team_id) AS team_count,
        (
          SELECT COUNT(DISTINCT m.match_no)
          FROM match_played m
          JOIN tournament_team tt2
            ON tt2.tr_id = t.tr_id
           AND (m.team_id1 = tt2.team_id OR m.team_id2 = tt2.team_id)
        ) AS match_count
      FROM tournament t
      LEFT JOIN tournament_team tt
        ON tt.tr_id = t.tr_id
      GROUP BY t.tr_id
      ORDER BY t.start_date DESC
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Get tournaments error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/tournaments/:id
// — Returns one tournament, its standings, and its matches
router.get('/:id', async (req, res) => {
  const trId = req.params.id;
  try {
    // 1) Tournament basic info
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

    // 2) Standings from tournament_team
    const [standings] = await pool.query(
      `SELECT
         t.team_id      AS id,
         t.team_name    AS name,
         tt.team_group  AS \`group\`,
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
       ORDER BY tt.points DESC, tt.goal_diff DESC, tt.goal_for DESC`,
      [trId]
    );
    tournament.standings = standings;

    // 3) Matches (distinct by match_no), linked via tournament_team
    const [matches] = await pool.query(
      `SELECT DISTINCT
         m.match_no                            AS id,
         m.play_stage                          AS stage,
         m.play_date                           AS date,
         home.team_name                        AS home_team_name,
         away.team_name                        AS away_team_name,
         CAST(SUBSTRING_INDEX(m.goal_score,'-',1) AS UNSIGNED)  AS home_score,
         CAST(SUBSTRING_INDEX(m.goal_score,'-',-1) AS UNSIGNED) AS away_score,
         m.results                             AS result,
         v.venue_name                          AS location
       FROM match_played m
       JOIN tournament_team tt
         ON tt.tr_id = ?
        AND (m.team_id1 = tt.team_id OR m.team_id2 = tt.team_id)
       JOIN team home
         ON m.team_id1 = home.team_id
       JOIN team away
         ON m.team_id2 = away.team_id
       JOIN venue v
         ON m.venue_id = v.venue_id
       ORDER BY m.play_date ASC`,
      [trId]
    );
    tournament.matches = matches;

    res.json({ success: true, data: tournament });
  } catch (err) {
    console.error('Get tournament error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/tournaments
// — Create a new tournament
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;
    if (!name || !start_date || !end_date) {
      return res
        .status(400)
        .json({ success: false, message: 'Please provide name, start_date and end_date' });
    }
    const [ins] = await pool.query(
      `INSERT INTO tournament (tr_name, start_date, end_date)
       VALUES (?, ?, ?)`,
      [name, start_date, end_date]
    );
    const trId = ins.insertId;
    const [newTour] = await pool.query(
      `SELECT tr_id AS id, tr_name AS name, start_date, end_date
       FROM tournament
       WHERE tr_id = ?`,
      [trId]
    );
    res.status(201).json({ success: true, data: newTour[0] });
  } catch (err) {
    console.error('Create tournament error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/tournaments/:id
// — Update an existing tournament
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;
    const trId = req.params.id;

    const [exists] = await pool.query(
      `SELECT tr_id FROM tournament WHERE tr_id = ?`,
      [trId]
    );
    if (!exists.length) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    await pool.query(
      `UPDATE tournament
       SET tr_name    = COALESCE(?, tr_name),
           start_date = COALESCE(?, start_date),
           end_date   = COALESCE(?, end_date)
       WHERE tr_id = ?`,
      [name, start_date, end_date, trId]
    );

    const [updated] = await pool.query(
      `SELECT tr_id AS id, tr_name AS name, start_date, end_date
       FROM tournament
       WHERE tr_id = ?`,
      [trId]
    );
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    console.error('Update tournament error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/tournaments/:id
// — Delete a tournament (cascades via FKs)
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const trId = req.params.id;
    const [exists] = await pool.query(
      `SELECT tr_id FROM tournament WHERE tr_id = ?`,
      [trId]
    );
    if (!exists.length) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    await pool.query(`DELETE FROM tournament WHERE tr_id = ?`, [trId]);
    res.json({ success: true, message: 'Tournament deleted' });
  } catch (err) {
    console.error('Delete tournament error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

