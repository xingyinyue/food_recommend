const mysql = require("mysql2/promise");

// Railway 會提供 MYSQL_URL
// 本機則用 DB_* 這組
let pool;

if (process.env.MYSQL_URL) {
  // ✅ Railway 環境
  console.log("🌍 Using MYSQL_URL (Railway)");
  pool = mysql.createPool(process.env.MYSQL_URL);
} else {
  // ✅ 本機環境
  console.log("💻 Using DB_HOST / DB_USER (Local)");
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30000, // ⏱️ 很重要（30 秒）
  });
}

module.exports = pool;