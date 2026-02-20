// db/pool.js
import mysql from "mysql2/promise";

export function makePool(env) {
    const {
        DB_HOST,
        DB_PORT = 3306,
        DB_NAME,
        DB_USER,
        DB_PASS,
    } = env;

    if (!DB_HOST || !DB_NAME || !DB_USER) {
        throw new Error("Missing DB env vars. Check .env");
    }

    const pool = mysql.createPool({
        host: DB_HOST,
        port: Number(DB_PORT),
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,

        // ✅ Interpret DATETIME as UTC when converting to JS Date
        timezone: "Z",
    });

    // ✅ Ensure MySQL session time zone is UTC (NOW(), CURRENT_TIMESTAMP, etc.)
    pool.on("connection", (conn) => {
        conn.query("SET time_zone = '+00:00'").catch(() => {});
    });

    return pool;
}