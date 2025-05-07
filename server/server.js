const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");

// Routes
const authRoutes = require('./routes/authRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const teamRoutes = require('./routes/teamRoutes');
const playerRoutes = require('./routes/playerRoutes');
const matchRoutes = require('./routes/matchRoutes');
const statsRoutes = require('./routes/statsRoutes');


// Database connection
const { initDB } = require('./config/db');

// Initialize environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Initialize database
initDB();

// Allow React dev server origin & credentials if you ever use cookies
app.use(
  cors({
    origin:  'http://localhost:3000',
    methods: ['GET','POST','PUT','DELETE'],
    credentials: true
  })
);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/stats', statsRoutes);


// start your server on the *HTTP* port, not the MySQL port:
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
