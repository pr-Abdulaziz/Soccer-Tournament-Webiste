const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { fileURLToPath } = require('url');

// Routes
const authRoutes = require('./routes/auth');
const tournamentRoutes = require('./routes/tournament');
const teamRoutes = require('./routes/team');
const playerRoutes = require('./routes/player');
const matchRoutes = require('./routes/match');
const statsRoutes = require('./routes/stats');

// Database connection
const { initDB } = require('./config/db');

// Initialize environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
initDB();

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/stats', statsRoutes);


