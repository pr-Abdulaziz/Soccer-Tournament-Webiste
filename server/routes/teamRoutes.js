const express = require('express');
const { pool } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/teams
 * List all teams with their current tournament assignment (if any)
 */
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        t.team_id          AS id,
        t.team_name        AS name,
        tt.tr_id           AS tournament_id,
        tr.tr_name         AS tournament_name,
        tt.team_group      AS \`group\`,
        tt.points
      FROM team t
      LEFT JOIN tournament_team tt
        ON t.team_id = tt.team_id
      LEFT JOIN tournament tr
        ON tt.tr_id = tr.tr_id
      ORDER BY t.team_name ASC
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Get teams error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/teams/:id
 * Get one team’s info, its tournament assignment, and its roster for that tournament
 */
router.get('/:id', async (req, res) => {
  try {
    const teamId = req.params.id;

    // 1) basic team info
    const [teamRows] = await pool.query(`
      SELECT team_id AS id, team_name AS name
      FROM team
      WHERE team_id = ?
    `, [teamId]);
    if (!teamRows.length) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    const team = teamRows[0];

    // 2) tournament assignment & stats
    const [ttRows] = await pool.query(`
      SELECT
        tt.tr_id            AS tournament_id,
        tr.tr_name          AS tournament_name,
        tt.team_group       AS \`group\`,
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
      JOIN tournament tr
        ON tt.tr_id = tr.tr_id
      WHERE tt.team_id = ?
    `, [teamId]);
    team.tournament = ttRows[0] || null;

    // 3) roster for that tournament (if any)
    if (team.tournament) {
      const trId = team.tournament.tournament_id;
      const [players] = await pool.query(`
        SELECT
          p.player_id           AS id,
          pr.name               AS name,
          p.jersey_no           AS jersey_number,
          p.position_to_play    AS position
        FROM team_player tp
        JOIN player p
          ON tp.player_id = p.player_id
        JOIN person pr
          ON p.player_id = pr.kfupm__id
        WHERE tp.team_id = ? AND tp.tr_id = ?
        ORDER BY p.jersey_no ASC
      `, [teamId, trId]);
      team.roster = players;
    } else {
      team.roster = [];
    }

    res.json({ success: true, data: team });
  } catch (err) {
    console.error('Get team error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/teams
 * Create a new team and assign it to a tournament
 * Body: { name, tr_id, team_group? }
 */
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, tr_id, team_group } = req.body;
    if (!name || !tr_id) {
      return res.status(400).json({ success: false, message: 'Please provide team name and tr_id' });
    }

    // 1) insert into team
    const [ins] = await pool.query(
      `INSERT INTO team (team_name) VALUES (?)`,
      [name]
    );
    const teamId = ins.insertId;

    // 2) assign to tournament with zeros
    await pool.query(`
      INSERT INTO tournament_team
        (team_id, tr_id, team_group, match_played, won, draw, lost, goal_for, goal_against, goal_diff, points, group_position)
      VALUES (?, ?, ?, 0,0,0,0,0,0,0,0,0)
    `, [teamId, tr_id, team_group || null]);

    // 3) return created team
    const [rows] = await pool.query(`
      SELECT team_id AS id, team_name AS name
      FROM team
      WHERE team_id = ?
    `, [teamId]);

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Create team error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/teams/:id
 * Update a team’s name
 * Body: { name }
 */
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const teamId = req.params.id;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Please provide a new name' });
    }
    // ensure exists
    const [exist] = await pool.query(
      `SELECT team_id FROM team WHERE team_id = ?`, [teamId]
    );
    if (!exist.length) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    // update
    await pool.query(
      `UPDATE team SET team_name = ? WHERE team_id = ?`,
      [name, teamId]
    );
    res.json({ success: true, message: 'Team updated' });
  } catch (err) {
    console.error('Update team error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * DELETE /api/teams/:id
 * Delete a team (cascades via FK ON DELETE CASCADE)
 */
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const teamId = req.params.id;
    // ensure exists
    const [exist] = await pool.query(
      `SELECT team_id FROM team WHERE team_id = ?`, [teamId]
    );
    if (!exist.length) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    // delete
    await pool.query(`DELETE FROM team WHERE team_id = ?`, [teamId]);
    res.json({ success: true, message: 'Team deleted' });
  } catch (err) {
    console.error('Delete team error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
