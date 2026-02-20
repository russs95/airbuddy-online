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

    return mysql.createPool({
        host: DB_HOST,
        port: Number(DB_PORT),
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        timezone: "Z",
    });
}
