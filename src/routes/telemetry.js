import express from "express";
import { isFiniteNumber, toMySQLDatetimeFromUnixSeconds } from "../utils/http.js";

function validateTelemetryBody(body) {
    if (!body || typeof body !== "object") return "Body must be a JSON object";

    const { recorded_at, values, confidence, flags, lat, lon, alt_m } = body;

    if (typeof recorded_at !== "number" || !Number.isFinite(recorded_at)) {
        return "`recorded_at` must be a unix timestamp number (seconds)";
    }

    if (recorded_at < 946684800 || recorded_at > 4102444800) {
        return "`recorded_at` out of expected range";
    }

    if (!values || typeof values !== "object" || Array.isArray(values)) {
        return "`values` must be an object";
    }

    if (Object.keys(values).length === 0) {
        return "`values` must not be empty";
    }

    if (confidence && (typeof confidence !== "object" || Array.isArray(confidence))) {
        return "`confidence` must be an object if provided";
    }

    if (flags && (typeof flags !== "object" || Array.isArray(flags))) {
        return "`flags` must be an object if provided";
    }

    if (lat !== undefined && lat !== null && !isFiniteNumber(lat)) return "`lat` must be a number";
    if (lon !== undefined && lon !== null && !isFiniteNumber(lon)) return "`lon` must be a number";
    if (alt_m !== undefined && alt_m !== null && !isFiniteNumber(alt_m)) return "`alt_m` must be a number";

    return null;
}

export function telemetryRouter(pool) {
    const router = express.Router();

    router.post("/v1/telemetry", async (req, res) => {
        const err = validateTelemetryBody(req.body);
        if (err) {
            return res.status(400).json({ ok: false, error: "bad_payload", message: err });
        }

        const deviceId = req.device.device_id;
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

            // 1) Insert telemetry (idempotent via unique constraint)
            try {
                await conn.query(
                    `INSERT INTO telemetry_readings_tb
           (device_id, recorded_at, lat, lon, alt_m, values_json, confidence_json, flags_json)
           VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
                    [deviceId, recordedAt, lat, lon, altM, valuesJson, confidenceJson, flagsJson]
                );
            } catch (e) {
                if (e.code !== "ER_DUP_ENTRY") throw e;
            }

            // 2) Update last_seen
            await conn.query(
                "UPDATE devices_tb SET last_seen_at = NOW() WHERE device_id = ?",
                [deviceId]
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

    return router;
}
