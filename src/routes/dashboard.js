import express from "express";

export function dashboardRouter(pool) {
    const router = express.Router();

    router.get("/v1/dashboard/trends", async (req, res) => {
        const hours = Math.max(1, Math.min(168, Number(req.query.hours) || 24));
        const deviceId = String(req.query.device_id || "AB-0001"); // temporary default

        // TODO soon: verify device belongs to req.session.user.buwana_id

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
            [deviceId, hours]
        );

        const timestamps = [];
        const eco2s = [];
        const temps = [];
        const rtcTemps = [];
        const rhs = [];
        const tvocs = [];

        for (const r of rows) {
            timestamps.push(r.ts);
            eco2s.push(Number.isFinite(r.eco2) ? r.eco2 : null);
            temps.push(Number.isFinite(r.temp) ? r.temp : null);
            rtcTemps.push(Number.isFinite(r.rtc_temp) ? r.rtc_temp : null);
            rhs.push(Number.isFinite(r.rh) ? r.rh : null);
            tvocs.push(Number.isFinite(r.tvoc) ? r.tvoc : null);
        }

        res.json({ ok: true, device_id: deviceId, hours, timestamps, eco2s, temps, rtcTemps, rhs, tvocs });
    });

    router.get("/v1/dashboard/latest", async (req, res) => {
        const deviceId = String(req.query.device_id || "AB-0001");

        const [rows] = await pool.query(
            `
      SELECT recorded_at, values_json
      FROM telemetry_readings_tb
      WHERE device_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
      `,
            [deviceId]
        );

        const row = rows?.[0];
        res.json({ ok: true, device_id: deviceId, latest: row || null });
    });

    return router;
}