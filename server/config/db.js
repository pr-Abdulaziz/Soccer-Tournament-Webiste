const mysql  = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
});

async function initDB() {
  try {
    await pool.getConnection();
    console.log('✅  MySQL connected');
  } catch (err) {
    console.error('❌  DB connection failed:', err);
    process.exit(1);
  }
}

module.exports = { pool, initDB };