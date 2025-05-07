// server/routes/playerRoutes.js

const express = require('express');
const { pool } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/players
 * List all players, optionally filtered by team_id or tr_id
 */
router.get('/', async (req, res) => {
  try {
    let sql = `
      SELECT 
        per.kfupm_id           AS id,
        per.name               AS name,
        per.date_of_birth      AS dob,
        pl.jersey_no           AS jersey,
        pp.position_desc       AS position,
        tp.team_id             AS team_id,
        t.team_name            AS team_name,
        tp.tr_id               AS tournament_id,
        tr.tr_name             AS tournament_name
      FROM person per
      JOIN player pl
        ON per.kfupm_id = pl.player_id
      JOIN playing_position pp
        ON pl.position_to_play = pp.position_id
      LEFT JOIN team_player tp
        ON pl.player_id = tp.player_id
      LEFT JOIN team t
        ON tp.team_id = t.team_id
      LEFT JOIN tournament tr
        ON tp.tr_id = tr.tr_id
      WHERE 1=1
    `;
    const params = [];

    if (req.query.team_id) {
      sql += ' AND tp.team_id = ?';
      params.push(req.query.team_id);
    }
    if (req.query.tr_id) {
      sql += ' AND tp.tr_id = ?';
      params.push(req.query.tr_id);
    }

    sql += ' ORDER BY per.name ASC';

    const [players] = await pool.query(sql, params);
    res.json({ success: true, count: players.length, data: players });
  } catch (err) {
    console.error('Get players error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/players/:id
 * Get one player’s details (basic info only)
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        per.kfupm_id           AS id,
        per.name               AS name,
        per.date_of_birth      AS dob,
        pl.jersey_no           AS jersey,
        pp.position_desc       AS position
      FROM person per
      JOIN player pl
        ON per.kfupm_id = pl.player_id
      JOIN playing_position pp
        ON pl.position_to_play = pp.position_id
      WHERE per.kfupm_id = ?
      `,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Get player error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/players
 * Create a new player and assign to a team & tournament (Admin only)
 */
router.post('/', auth, adminOnly, async (req, res) => {
  const {
    id,
    name,
    date_of_birth,
    jersey_no,
    position_id,
    team_id,
    tr_id
  } = req.body;

  // Validate required fields
  if (!id || !name || !date_of_birth || !jersey_no || !position_id || !team_id || !tr_id) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    // Ensure person does not already exist
    const [[existing]] = await pool.query(
      `SELECT 1 FROM person WHERE kfupm_id = ?`,
      [id]
    );
    if (existing) {
      return res.status(400).json({ success: false, message: 'Player ID already exists' });
    }

    // Insert into person
    await pool.query(
      `INSERT INTO person (kfupm_id, name, date_of_birth) VALUES (?, ?, ?)`,
      [id, name, date_of_birth]
    );
    // Insert into player
    await pool.query(
      `INSERT INTO player (player_id, jersey_no, position_to_play) VALUES (?, ?, ?)`,
      [id, jersey_no, position_id]
    );
    // Assign to team & tournament
    await pool.query(
      `INSERT INTO team_player (player_id, team_id, tr_id) VALUES (?, ?, ?)`,
      [id, team_id, tr_id]
    );

    // Fetch and return full record
    const [newRow] = await pool.query(
      `
      SELECT 
        per.kfupm_id           AS id,
        per.name               AS name,
        per.date_of_birth      AS dob,
        pl.jersey_no           AS jersey,
        pp.position_desc       AS position,
        tp.team_id             AS team_id,
        t.team_name            AS team_name,
        tp.tr_id               AS tournament_id,
        tr.tr_name             AS tournament_name
      FROM person per
      JOIN player pl
        ON per.kfupm_id = pl.player_id
      JOIN playing_position pp
        ON pl.position_to_play = pp.position_id
      JOIN team_player tp
        ON pl.player_id = tp.player_id
      JOIN team t
        ON tp.team_id = t.team_id
      JOIN tournament tr
        ON tp.tr_id = tr.tr_id
      WHERE per.kfupm_id = ?
      `,
      [id]
    );

    res.status(201).json({ success: true, data: newRow[0] });
  } catch (err) {
    console.error('Create player error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/players/:id
 * Update player’s personal & jersey/position data (Admin only)
 */
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { name, date_of_birth, jersey_no, position_id } = req.body;

  try {
    // Ensure player exists
    const [[exists]] = await pool.query(
      `SELECT 1 FROM person WHERE kfupm_id = ?`,
      [req.params.id]
    );
    if (!exists) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }

    // Update person
    await pool.query(
      `
      UPDATE person
         SET name           = COALESCE(?, name),
             date_of_birth  = COALESCE(?, date_of_birth)
       WHERE kfupm_id = ?
      `,
      [name, date_of_birth, req.params.id]
    );
    // Update player
    await pool.query(
      `
      UPDATE player
         SET jersey_no          = COALESCE(?, jersey_no),
             position_to_play   = COALESCE(?, position_to_play)
       WHERE player_id = ?
      `,
      [jersey_no, position_id, req.params.id]
    );

    // Return updated
    const [updated] = await pool.query(
      `
      SELECT 
        per.kfupm_id           AS id,
        per.name               AS name,
        per.date_of_birth      AS dob,
        pl.jersey_no           AS jersey,
        pp.position_desc       AS position
      FROM person per
      JOIN player pl
        ON per.kfupm_id = pl.player_id
      JOIN playing_position pp
        ON pl.position_to_play = pp.position_id
      WHERE per.kfupm_id = ?
      `,
      [req.params.id]
    );

    res.json({ success: true, data: updated[0] });
  } catch (err) {
    console.error('Update player error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * DELETE /api/players/:id
 * Remove a player entirely (Admin only)
 */
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    // Ensure player exists
    const [[exists]] = await pool.query(
      `SELECT 1 FROM person WHERE kfupm_id = ?`,
      [req.params.id]
    );
    if (!exists) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }

    // Remove assignments
    await pool.query(`DELETE FROM team_player WHERE player_id = ?`, [req.params.id]);
    // Remove from player & person
    await pool.query(`DELETE FROM player WHERE player_id = ?`, [req.params.id]);
    await pool.query(`DELETE FROM person WHERE kfupm_id = ?`, [req.params.id]);

    res.json({ success: true, message: 'Player deleted successfully' });
  } catch (err) {
    console.error('Delete player error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
