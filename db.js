const mysql = require("mysql2/promise");

const pool = mysql.createPool({
host: "localhost",
user: "root",
password: "Ypl@40575027",
database: "ai_meal",
waitForConnections: true,
connectionLimit: 10,
queueLimit: 0
});

module.exports = pool;