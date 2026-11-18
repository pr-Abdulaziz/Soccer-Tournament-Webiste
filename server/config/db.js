const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql
  .createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    // Treat objects passed as query values as plain strings. Without this, a JSON
    // body like {"email": {"email": 1}} is expanded into SQL (`email` = 1) and can
    // change the meaning of a WHERE clause.
    stringifyObjects: true
  })
  .promise();

async function initDB() {
  try {
    const conn = await pool.getConnection();
    conn.release();
    console.log('✅ MySQL connected');
  } catch (err) {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, initDB };
