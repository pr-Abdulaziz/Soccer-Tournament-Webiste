// server/routes/teamRoutes.js

const express = require('express');
const { pool } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/teams
 * List all teams with their tournament assignments (stats).
 */
router.get('/', async (req, res) => {
  try {
    // 1) Fetch all teams
    const [teams] = await pool.query(
      'SELECT team_id AS id, team_name AS name FROM team ORDER BY team_name ASC'
    );

    if (teams.length === 0) {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }

    // 2) Fetch all tournament assignments
    const [assigns] = await pool.query(`
      SELECT
        tt.team_id,
        tt.tr_id                  AS tournament_id,
        tr.tr_name                AS tournament_name,
        tt.team_group             AS \`group\`,
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
    `);

    // 3) Merge assignments under each team
    const data = teams.map(team => ({
      id:          team.id,
      name:        team.name,
      assignments: assigns
        .filter(a => a.team_id === team.id)
        .map(a => ({
          tournament_id:   a.tournament_id,
          tournament_name: a.tournament_name,
          group:           a.group,
          match_played:    a.match_played,
          won:             a.won,
          draw:            a.draw,
          lost:            a.lost,
          goal_for:        a.goal_for,
          goal_against:    a.goal_against,
          goal_diff:       a.goal_diff,
          points:          a.points,
          group_position:  a.group_position
        }))
    }));

    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('Get teams error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/teams/:id
 * Get one team’s info, with each tournament assignment + its roster.
 */
router.get('/:id', async (req, res) => {
  try {
    const teamId = req.params.id;

    // 1) Basic team info
    const [teamRows] = await pool.query(
      'SELECT team_id AS id, team_name AS name FROM team WHERE team_id = ?',
      [teamId]
    );
    if (teamRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    const team = teamRows[0];

    // 2) This team’s assignments
    const [assignRows] = await pool.query(`
      SELECT
        tt.tr_id                  AS tournament_id,
        tr.tr_name                AS tournament_name,
        tt.team_group             AS \`group\`,
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

    // 3) For each assignment, fetch its roster
    const assignments = await Promise.all(assignRows.map(async a => {
      const [players] = await pool.query(`
        SELECT
          tp.player_id           AS id,
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
      `, [teamId, a.tournament_id]);

      return {
        tournament_id:   a.tournament_id,
        tournament_name: a.tournament_name,
        group:           a.group,
        match_played:    a.match_played,
        won:             a.won,
        draw:            a.draw,
        lost:            a.lost,
        goal_for:        a.goal_for,
        goal_against:    a.goal_against,
        goal_diff:       a.goal_diff,
        points:          a.points,
        group_position:  a.group_position,
        roster:          players
      };
    }));

    res.status(200).json({ success: true, data: { ...team, assignments } });
  } catch (err) {
    console.error('Get team error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/teams
 * Create a team & optionally assign it to a tournament.
 * Body: { name, tr_id?, team_group? }
 */
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, tr_id, team_group } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Team name is required' });
    }

    // Create the team
    const [ins] = await pool.query(
      'INSERT INTO team (team_name) VALUES (?)',
      [name]
    );
    const newTeamId = ins.insertId;

    // Optionally assign to tournament
    if (tr_id) {
      await pool.query(`
        INSERT INTO tournament_team (
          team_id, tr_id, team_group,
          match_played, won, draw, lost,
          goal_for, goal_against, goal_diff,
          points, group_position
        ) VALUES (?, ?, ?, 0,0,0,0, 0,0,0, 0,0)
      `, [newTeamId, tr_id, team_group || null]);
    }

    // Return the newly created team
    const [newRows] = await pool.query(
      'SELECT team_id AS id, team_name AS name FROM team WHERE team_id = ?',
      [newTeamId]
    );
    res.status(201).json({ success: true, data: newRows[0] });
  } catch (err) {
    console.error('Create team error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/teams/:id
 * Rename a team.
 * Body: { name }
 */
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const teamId = req.params.id;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'New name is required' });
    }

    // Ensure exists
    const [exists] = await pool.query(
      'SELECT 1 FROM team WHERE team_id = ?',
      [teamId]
    );
    if (exists.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Update
    await pool.query(
      'UPDATE team SET team_name = ? WHERE team_id = ?',
      [name, teamId]
    );

    res.status(200).json({ success: true, message: 'Team updated successfully' });
  } catch (err) {
    console.error('Update team error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * DELETE /api/teams/:id
 * Delete a team (cascades).
 */
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const teamId = req.params.id;

    // Ensure exists
    const [exists] = await pool.query(
      'SELECT 1 FROM team WHERE team_id = ?',
      [teamId]
    );
    if (exists.length === 0) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Remove
    await pool.query('DELETE FROM team WHERE team_id = ?', [teamId]);

    res.status(200).json({ success: true, message: 'Team deleted successfully' });
  } catch (err) {
    console.error('Delete team error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
