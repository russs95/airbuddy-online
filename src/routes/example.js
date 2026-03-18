// src/routes/example.js
// Public read-only endpoint for the example device (AB-0002).
// No authentication required — intentionally open for the public example page.

import express from "express";

const EXAMPLE_DEVICE_UID = "AB-0002";

export function exampleRouter(pool) {
    const router = express.Router();

    // ------------------------------------------------------------------
    // GET /api/example/device-trends?hours=24
    // Returns trend data for the hardcoded example device AB-0002.
    // Identical response shape to /api/dashboard/device-trends.
    // ------------------------------------------------------------------
    router.get("/example/device-trends", async (req, res) => {
        try {
            const hours = Math.max(1, Math.min(24 * 30, Number(req.query.hours) || 24));

            const [deviceRows] = await pool.query(
                `
                SELECT
                    d.device_id,
                    d.device_uid,
                    d.device_name,
                    r.room_name,
                    h.home_name
                FROM devices_tb d
                LEFT JOIN rooms_tb r ON r.room_id = d.room_id
                LEFT JOIN homes_tb h ON h.home_id = d.home_id
                WHERE d.device_uid = ?
                LIMIT 1
                `,
                [EXAMPLE_DEVICE_UID]
            );

            if (!deviceRows.length) {
                return res.status(404).json({
                    ok: false,
                    error: "device_not_found",
                    message: "Example device not found.",
                });
            }

            const device = deviceRows[0];

            const [rows] = await pool.query(
                `
                SELECT
                    UNIX_TIMESTAMP(recorded_at) AS ts,
                    CAST(JSON_EXTRACT(values_json, '$.eco2_ppm') AS DOUBLE) AS eco2,
                    CAST(JSON_EXTRACT(values_json, '$.temp_c') AS DOUBLE) AS temp,
                    CAST(JSON_EXTRACT(values_json, '$.rtc_temp_c') AS DOUBLE) AS rtc_temp,
                    CAST(JSON_EXTRACT(values_json, '$.rh_pct') AS DOUBLE) AS rh,
                    CAST(JSON_EXTRACT(values_json, '$.tvoc_ppb') AS DOUBLE) AS tvoc
                FROM telemetry_readings_tb
                WHERE device_id = ?
                  AND recorded_at >= UTC_TIMESTAMP() - INTERVAL ? HOUR
                ORDER BY recorded_at ASC
                `,
                [device.device_id, hours]
            );

            const timestamps = [];
            const eco2s = [];
            const temps = [];
            const rtcTemps = [];
            const rhs = [];
            const tvocs = [];

            for (const r of rows) {
                timestamps.push(r.ts == null ? null : Number(r.ts));
                eco2s.push(r.eco2 == null ? null : Number(r.eco2));
                temps.push(r.temp == null ? null : Number(r.temp));
                rtcTemps.push(r.rtc_temp == null ? null : Number(r.rtc_temp));
                rhs.push(r.rh == null ? null : Number(r.rh));
                tvocs.push(r.tvoc == null ? null : Number(r.tvoc));
            }

            return res.json({
                ok: true,
                device_uid: device.device_uid,
                device_name: device.device_name,
                room_name: device.room_name,
                home_name: device.home_name,
                hours,
                timestamps,
                eco2s,
                temps,
                rtcTemps,
                rhs,
                tvocs,
            });
        } catch (e) {
            console.error("example device trends error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not load example trend data.",
            });
        }
    });

    return router;
}
