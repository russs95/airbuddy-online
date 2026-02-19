// src/server.js
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import { makePool } from "./db/pool.js";
import { deviceAuth } from "./middleware/deviceAuth.js";
import { telemetryRouter } from "./routes/telemetry.js";
import { deviceRouter } from "./routes/device.js";
import { systemRouter } from "./routes/system.js";

dotenv.config();

const app = express();
app.use(helmet());
app.use(morgan("tiny"));
app.use(express.json({ limit: "256kb" }));

const startedAt = Date.now();
const { PORT = 3000 } = process.env;

const DISPLAY_TZ = "Asia/Jakarta";

let pool;
try {
    pool = makePool(process.env);
} catch (e) {
    console.error(e.message || e);
    process.exit(1);
}

// ---- Static files (for CSP-safe external JS) ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Serve /public as /static/*
app.use("/static", express.static(path.join(__dirname, "..", "public")));

// ------------------------
// Helpers
// ------------------------
const esc = (s) =>
    String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

// FIXED: MySQL JSON may already be an object (mysql2 behavior).
const safeJsonParse = (v) => {
    if (v == null) return null;

    if (typeof v === "object") {
        if (Buffer.isBuffer(v)) {
            try {
                return JSON.parse(v.toString("utf8"));
            } catch {
                return null;
            }
        }
        return v;
    }

    if (typeof v === "string") {
        try {
            return JSON.parse(v);
        } catch {
            return null;
        }
    }

    return null;
};

const fmtJakarta = (d) => {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: DISPLAY_TZ,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
    }).formatToParts(dt);

    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get(
        "minute"
    )}:${get("second")} ${get("timeZoneName")}`;
};

const nOrNull = (x) => {
    if (x == null) return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
};

const pickCore = (valuesObj) => {
    const v = valuesObj && typeof valuesObj === "object" ? valuesObj : {};
    return {
        temp_c: nOrNull(v.temp_c),
        rh: nOrNull(v.rh),
        eco2_ppm: nOrNull(v.eco2_ppm),
        tvoc_ppb: nOrNull(v.tvoc_ppb),
        aqi: nOrNull(v.aqi),
        confidence: nOrNull(v.confidence),
        ready: v.ready,
        rtc_temp_c: nOrNull(v.rtc_temp_c),
    };
};

const fmtVal = (x, digits = 1) => {
    if (x == null) return "—";
    if (typeof x === "boolean") return x ? "true" : "false";
    if (typeof x === "number") return Number.isFinite(x) ? x.toFixed(digits) : "—";
    return String(x);
};

// ------------------------
// Device summary (schema-aligned to your tables)
// ------------------------
async function fetchDeviceSummary(pool, deviceId = 1) {
    const sql = `
        SELECT
            d.device_id AS device_id,
            d.device_name AS device_name,
            h.home_name AS home_name,
            r.room_name AS room_name
        FROM devices_tb d
                 LEFT JOIN homes_tb h ON h.home_id = d.home_id
                 LEFT JOIN rooms_tb r ON r.room_id = d.room_id
        WHERE d.device_id = ?
            LIMIT 1
    `;
    try {
        const [rows] = await pool.query(sql, [deviceId]);
        return rows && rows.length ? rows[0] : null;
    } catch {
        return null;
    }
}

// ------------------------
// Main landing page
// ------------------------
app.get("/", async (req, res) => {
    try {
        // Header device info for device_id=1
        const deviceSummary = await fetchDeviceSummary(pool, 1);

        // Latest 10 telemetry rows for device_id=1 by received_at
        const [rows] = await pool.query(
            `
      SELECT
        tr.device_id,
        tr.received_at,
        tr.values_json
      FROM telemetry_readings_tb tr
      WHERE tr.device_id = 1
      ORDER BY tr.received_at DESC
      LIMIT 10
      `
        );

        const now = new Date();

        // One time line only
        const serverTimeLine = `
      <div class="servertime">
        <b>Server time (Jakarta):</b> ${esc(fmtJakarta(now))}
      </div>
    `;

        // Device info line under server time
        const deviceLine = `
      <div class="deviceinfo">
        ${
            deviceSummary
                ? `
          <b>Device:</b> ${esc(deviceSummary.device_name ?? "(unnamed)")}
          <span class="dot">•</span>
          <b>Home:</b> ${esc(deviceSummary.home_name ?? "(none)")}
          <span class="dot">•</span>
          <b>Room:</b> ${esc(deviceSummary.room_name ?? "(none)")}
          <span class="dot">•</span>
          <b>ID:</b> ${esc(deviceSummary.device_id)}
        `
                : `<span class="muted">(device_id=1 not found)</span>`
        }
      </div>
    `;

        // Build series in chronological order (oldest -> newest)
        const chronological = [...rows].reverse();

        const labels = [];
        const temps = [];
        const rhs = [];
        const eco2s = [];

        for (const r of chronological) {
            labels.push(r?.received_at ? fmtJakarta(r.received_at) : "");
            const obj = safeJsonParse(r.values_json);
            const core = pickCore(obj);
            temps.push(core.temp_c);
            rhs.push(core.rh);
            eco2s.push(core.eco2_ppm);
        }

        const countNonNull = (arr) =>
            arr.reduce((a, v) => a + (v == null ? 0 : 1), 0);

        const pointsInfo = {
            temp: countNonNull(temps),
            rh: countNonNull(rhs),
            eco2: countNonNull(eco2s),
        };

        // Chart data as data-* attributes on each canvas (CSP-safe)
        // NOTE: esc() is for HTML safety; chart.js will JSON.parse the attribute strings.
        const chartDataAttrs = `
      data-labels='${esc(JSON.stringify(labels))}'
      data-temps='${esc(JSON.stringify(temps))}'
      data-rhs='${esc(JSON.stringify(rhs))}'
      data-eco2s='${esc(JSON.stringify(eco2s))}'
    `;

        // Entries (latest first)
        const entriesHtml = rows
            .map((r) => {
                const obj = safeJsonParse(r.values_json);
                const core = pickCore(obj);

                return `
          <div class="entry">
            <div class="entry-head">
              <div><b>received:</b> ${esc(
                    r.received_at ? fmtJakarta(r.received_at) : "—"
                )}</div>
              <div class="muted"><b>device_id:</b> ${esc(r.device_id)}</div>
            </div>

            <table class="core">
              <tbody>
                <tr><th>Temp</th><td>${esc(fmtVal(core.temp_c, 1))} °C</td></tr>
                <tr><th>Humidity</th><td>${esc(fmtVal(core.rh, 1))} %</td></tr>
                <tr><th>eCO₂</th><td>${esc(fmtVal(core.eco2_ppm, 0))} ppm</td></tr>
                <tr><th>TVOC</th><td>${esc(fmtVal(core.tvoc_ppb, 0))} ppb</td></tr>
                <tr><th>AQI</th><td>${esc(fmtVal(core.aqi, 0))}</td></tr>
                <tr><th>Confidence</th><td>${esc(fmtVal(core.confidence, 0))} %</td></tr>
                <tr><th>Ready</th><td>${esc(fmtVal(core.ready))}</td></tr>
                <tr><th>RTC temp</th><td>${esc(fmtVal(core.rtc_temp_c, 1))} °C</td></tr>
              </tbody>
            </table>
          </div>
        `;
            })
            .join("\n");

        // Three stacked charts (temp, humidity, eco2)
        const chartsHtml = `
      <div class="chartwrap">
        <div class="charttitle">
          <b>Temperature trend (last 10)</b>
          <div class="legend">Temp = <span style="color:#c62828;font-weight:600;">red</span></div>
        </div>
        <div class="points">Points found: ${pointsInfo.temp}/10</div>
        <canvas id="trend-temp" ${chartDataAttrs}></canvas>
      </div>

      <div class="chartwrap">
        <div class="charttitle">
          <b>Humidity trend (last 10)</b>
          <div class="legend">Humidity = <span style="color:#1565c0;font-weight:600;">blue</span></div>
        </div>
        <div class="points">Points found: ${pointsInfo.rh}/10</div>
        <canvas id="trend-rh" ${chartDataAttrs}></canvas>
      </div>

      <div class="chartwrap">
        <div class="charttitle">
          <b>eCO₂ trend (last 10)</b>
          <div class="legend">eCO₂ = <span style="color:#6a1b9a;font-weight:600;">purple</span></div>
        </div>
        <div class="points">Points found: ${pointsInfo.eco2}/10</div>
        <canvas id="trend-eco2" ${chartDataAttrs}></canvas>
      </div>
    `;

        const html = `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AirBuddy Online</title>
        <style>
          :root { --border:#e6e6e6; --muted:#666; --panel:#fafafa; }
          body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif; margin: 24px; color:#111; }
          h1 { margin: 0 0 6px; }
          .sub { color: var(--muted); margin: 0 0 18px; }
          .links a { margin-right: 12px; }

          .servertime { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; background: var(--panel); margin: 14px 0 10px; }
          .deviceinfo { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; background: #fff; margin: 0 0 18px; color: #222; }
          .deviceinfo .dot { margin: 0 8px; color: #bbb; }
          .muted { color: var(--muted); }

          .chartwrap { border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin: 0 0 14px; background: #fff; }
          .charttitle { display:flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 6px; }
          .charttitle b { font-size: 16px; }
          .legend { color: var(--muted); font-size: 13px; }
          .points { color: var(--muted); font-size: 12px; margin: 0 0 8px; }
          canvas { width: 100%; height: 220px; display: block; }

          .entry { border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin: 12px 0; background: #fff; }
          .entry-head { display:flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }

          table.core { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 10px; }
          table.core th, table.core td { text-align: left; padding: 10px 10px; border-top: 1px solid var(--border); vertical-align: top; }
          table.core tr:first-child th, table.core tr:first-child td { border-top: none; }
          table.core th { width: 140px; color: #222; background: #fcfcfc; font-weight: 600; }

          .footerline { margin-top: 18px; color: var(--muted); font-size: 13px; }
        </style>
      </head>
      <body>
        <h1>AirBuddy Online</h1>
        <p class="sub">Last 10 telemetry readings (device_id=1, ordered by <b>received_at</b>)</p>

        <p class="links">
          <a href="/api/live">/api/live</a>
          <a href="/api/health">/api/health</a>
        </p>

        ${serverTimeLine}
        ${deviceLine}

        ${chartsHtml}

        ${rows.length ? entriesHtml : `<p>No telemetry readings yet.</p>`}

        <div class="footerline">received_at is server time — ideal when device RTC is missing.</div>

        <!-- CSP-safe external script include -->
        <script src="/static/chart.js"></script>
      </body>
      </html>
    `;

        res.status(200).type("html").send(html);
    } catch (e) {
        console.error("GET / landing error:", e?.code || e?.message || e);
        res.status(500).type("text").send("server_error");
    }
});

// ------------------------
// System routes
// ------------------------
app.use("/api", systemRouter(pool, startedAt));

// ------------------------
// API v1 (authenticated)
// ------------------------
app.use("/api", deviceAuth(pool), telemetryRouter(pool));
app.use("/api", deviceAuth(pool), deviceRouter(pool));

// ------------------------
// Start Server
// ------------------------
app.listen(Number(PORT), "127.0.0.1", () => {
    console.log(`AirBuddy Online API listening on http://127.0.0.1:${PORT}`);
});
