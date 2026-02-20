// src/db/pool.js
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

        // IMPORTANT:
        // Treat MySQL DATETIME values as UTC when converting to JS Date.
        // We keep DB storage UTC and apply display timezone in the UI layer.
        timezone: "Z",
    });

    // Best-effort: ensure each MySQL session runs in UTC too.
    // This avoids surprises if you ever use NOW() or time functions.
    try {
        if (pool && typeof pool.on === "function") {
            pool.on("connection", (conn) => {
                try {
                    conn.query("SET time_zone = '+00:00'");
                } catch {
                    // ignore; do not crash
                }
            });
        }
    } catch {
        // ignore; do not crash
    }

    return pool;
}