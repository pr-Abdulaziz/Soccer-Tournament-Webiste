const express = require('express');
const { pool } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/players
 * @desc    List all players, optionally filtered by team or tournament
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    let sql = `
      SELECT 
        per.kfupm_id      AS id,
        per.name          AS name,
        per.date_of_birth AS dob,
        pl.jersey_no      AS jersey,
        pp.position_desc  AS position,
        tp.team_id        AS team_id,
        t.team_name       AS team_name,
        tp.tr_id          AS tournament_id,
        tr.tr_name        AS tournament_name
      FROM person per
      JOIN player pl          ON per.kfupm_id = pl.player_id
      JOIN playing_position pp ON pl.position_to_play = pp.position_id
      LEFT JOIN team_player tp ON pl.player_id = tp.player_id
      LEFT JOIN team t         ON tp.team_id   = t.team_id
      LEFT JOIN tournament tr  ON tp.tr_id     = tr.tr_id
      WHERE 1=1
    `;
    const params = [];

    // Filter by team?
    if (req.query.team_id) {
      sql += ' AND tp.team_id = ?';
      params.push(req.query.team_id);
    }

    // Filter by tournament?
    if (req.query.tr_id) {
      sql += ' AND tp.tr_id = ?';
      params.push(req.query.tr_id);
    }

    // Order by name
    sql += ' ORDER BY per.name ASC';

    const [players] = await pool.query(sql, params);
    return res.json({ success: true, count: players.length, data: players });
  } catch (err) {
    console.error('Get players error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/players/:id
 * @desc    Get a single player by KFUPM ID
 * @access  Public
 */
router.get('/:id', async (req, res) => {
  try {
    const sql = `
      SELECT 
        per.kfupm_id      AS id,
        per.name          AS name,
        per.date_of_birth AS dob,
        pl.jersey_no      AS jersey,
        pp.position_desc  AS position
      FROM person per
      JOIN player pl          ON per.kfupm_id = pl.player_id
      JOIN playing_position pp ON pl.position_to_play = pp.position_id
      WHERE per.kfupm_id = ?
    `;
    const [rows] = await pool.query(sql, [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Get player error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/players
 * @desc    Register a new player and assign them to a team/tournament
 * @access  Admin only
 */
router.post('/', auth, adminOnly, async (req, res) => {
  const { id, name, date_of_birth, jersey_no, position_id, team_id, tr_id } = req.body;
  if (!id || !name || !date_of_birth || !jersey_no || !position_id || !team_id || !tr_id) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    // 1️⃣ Insert into PERSON
    await pool.query(
      'INSERT INTO person (kfupm_id, name, date_of_birth) VALUES (?, ?, ?)',
      [id, name, date_of_birth]
    );

    // 2️⃣ Insert into PLAYER
    await pool.query(
      'INSERT INTO player (player_id, jersey_no, position_to_play) VALUES (?, ?, ?)',
      [id, jersey_no, position_id]
    );

    // 3️⃣ Assign to team & tournament
    await pool.query(
      'INSERT INTO team_player (player_id, team_id, tr_id) VALUES (?, ?, ?)',
      [id, team_id, tr_id]
    );

    // 4️⃣ Fetch and return the new record
    const [newPlayer] = await pool.query(
      `SELECT per.kfupm_id AS id, per.name, per.date_of_birth AS dob,
              pl.jersey_no AS jersey, pp.position_desc AS position,
              tp.team_id, t.team_name, tp.tr_id AS tournament_id, tr.tr_name AS tournament_name
       FROM person per
       JOIN player pl          ON per.kfupm_id = pl.player_id
       JOIN playing_position pp ON pl.position_to_play = pp.position_id
       JOIN team_player tp     ON pl.player_id = tp.player_id
       JOIN team t              ON tp.team_id   = t.team_id
       JOIN tournament tr       ON tp.tr_id     = tr.tr_id
       WHERE per.kfupm_id = ?`,
      [id]
    );

    return res.status(201).json({ success: true, data: newPlayer[0] });
  } catch (err) {
    console.error('Create player error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/players/:id
 * @desc    Remove a player entirely (admin only)
 * @access  Admin only
 */
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    // Clean up team assignments first
    await pool.query('DELETE FROM team_player WHERE player_id = ?', [req.params.id]);

    // Remove from PLAYER and PERSON
    await pool.query('DELETE FROM player WHERE player_id = ?', [req.params.id]);
    await pool.query('DELETE FROM person WHERE kfupm_id = ?', [req.params.id]);

    return res.json({ success: true, message: 'Player deleted successfully' });
  } catch (err) {
    console.error('Delete player error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
