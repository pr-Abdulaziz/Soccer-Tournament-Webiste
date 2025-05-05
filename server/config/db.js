const mysql = require("mysql");
require('dotenv').config();   // loads .env automatically


export const db = mysql.createConnection({
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
});