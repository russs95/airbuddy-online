// server.js
// AirBuddy Online API (minimal v1)

import crypto from "node:crypto";
import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "128kb" }));

const {
    PORT = 3000,
    DB_HOST,
    DB_PORT = 3306,
    DB_NAME,
    DB_USER,
    DB_PASS,
} = process.env;

if (!DB_HOST || !DB_NAME || !DB_USER) {
    console.error("Missing DB env vars. Check .env");
    process.exit(1);
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
    timezone: "Z",
});

// ------------------------
// Helpers
// ------------------------
function sha256Hex(str) {
    return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function requireHeader(req, name) {
    const v = req.get(name);
    return v && String(v).trim() ? String(v).trim() : null;
}

function isFiniteNumber(x) {
    return typeof x === "number" && Number.isFinite(x);
}

function toMySQLDatetimeFromUnixSeconds(sec) {
    // Converts unix seconds -> YYYY-MM-DD HH:MM:SS (UTC)
    const d = new Date(sec * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    );
}

function validateTelemetryBody(body) {
    // Minimal contract:
    // recorded_at: unix seconds int
    // values: object (non-empty)
    if (!body || typeof body !== "object") return "Body must be a JSON object";

    const { recorded_at, values, confidence, flags, lat, lon, alt_m } = body;

    if (typeof recorded_at !== "number" || !Number.isFinite(recorded_at)) {
        return "`recorded_at` must be a unix timestamp number (seconds)";
    }
    if (recorded_at < 946684800 || recorded_at > 4102444800) {
        // 2000-01-01 .. 2100-01-01 sanity window
        return "`recorded_at` out of expected range";
    }

    if (!values || typeof values !== "object" || Array.isArray(values)) {
        return "`values` must be an object";
    }
    if (Object.keys(values).length === 0) {
        return "`values` must not be empty";
    }

    if (confidence !== undefined && confidence !== null) {
        if (typeof confidence !== "object" || Array.isArray(confidence)) {
            return "`confidence` must be an object if provided";
        }
    }
    if (flags !== undefined && flags !== null) {
        if (typeof flags !== "object" || Array.isArray(flags)) {
            return "`flags` must be an object if provided";
        }
    }

    if (lat !== undefined && lat !== null && !isFiniteNumber(lat)) return "`lat` must be a number";
    if (lon !== undefined && lon !== null && !isFiniteNumber(lon)) return "`lon` must be a number";
    if (alt_m !== undefined && alt_m !== null && !isFiniteNumber(alt_m)) return "`alt_m` must be a number";

    return null;
}

// ------------------------
// Routes
// ------------------------
app.get("/api/health", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT 1 AS ok");
        res.json({ ok: true, db: rows?.[0]?.ok === 1 });
    } catch (e) {
        res.status(500).json({ ok: false, error: "db_error" });
    }
});

// POST /api/v1/telemetry
app.post("/api/v1/telemetry", async (req, res) => {
    const deviceUid = requireHeader(req, "X-Device-Id");
    const deviceKey = requireHeader(req, "X-Device-Key");

    if (!deviceUid || !deviceKey) {
        return res.status(401).json({ ok: false, error: "missing_device_auth" });
    }

    const err = validateTelemetryBody(req.body);
    if (err) return res.status(400).json({ ok: false, error: "bad_payload", message: err });

    const keyHash = sha256Hex(deviceKey);

    const recordedAt = toMySQLDatetimeFromUnixSeconds(req.body.recorded_at);
    const lat = req.body.lat ?? null;
    const lon = req.body.lon ?? null;
    const altM = req.body.alt_m ?? null;

    const valuesJson = JSON.stringify(req.body.values);
    const confidenceJson = req.body.confidence ? JSON.stringify(req.body.confidence) : null;
    const flagsJson = req.body.flags ? JSON.stringify(req.body.flags) : null;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1) Find device by UID
        const [devRows] = await conn.query(
            "SELECT device_id, status FROM devices_tb WHERE device_uid = ? LIMIT 1",
            [deviceUid]
        );
        if (!devRows.length) {
            await conn.rollback();
            return res.status(401).json({ ok: false, error: "unknown_device" });
        }
        const device = devRows[0];
        if (device.status !== "active") {
            await conn.rollback();
            return res.status(401).json({ ok: false, error: "device_not_active" });
        }

        // 2) Validate key hash (must be not revoked)
        const [keyRows] = await conn.query(
            `SELECT device_key_id
       FROM device_keys_tb
       WHERE device_id = ?
         AND key_hash = ?
         AND revoked_at IS NULL
       LIMIT 1`,
            [device.device_id, keyHash]
        );
        if (!keyRows.length) {
            await conn.rollback();
            return res.status(401).json({ ok: false, error: "invalid_device_key" });
        }

        // 3) Insert telemetry
        try {
            await conn.query(
                `INSERT INTO telemetry_readings_tb
          (device_id, recorded_at, lat, lon, alt_m, values_json, confidence_json, flags_json)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
                [device.device_id, recordedAt, lat, lon, altM, valuesJson, confidenceJson, flagsJson]
            );
        } catch (e) {
            // Duplicate reading: unique(device_id, recorded_at)
            if (e && e.code === "ER_DUP_ENTRY") {
                // treat as success (idempotent)
            } else {
                throw e;
            }
        }

        // 4) Update last_seen_at
        await conn.query(
            "UPDATE devices_tb SET last_seen_at = NOW() WHERE device_id = ?",
            [device.device_id]
        );

        await conn.commit();
        return res.status(200).json({ ok: true });
    } catch (e) {
        try { await conn.rollback(); } catch {}
        console.error("telemetry error:", e?.code || e?.message || e);
        return res.status(500).json({ ok: false, error: "server_error" });
    } finally {
        conn.release();
    }
});

app.listen(Number(PORT), "127.0.0.1", () => {
    console.log(`AirBuddy Online API listening on http://127.0.0.1:${PORT}`);
});
