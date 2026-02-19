// src/server.js
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";

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

const safeJsonParse = (v) => {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v !== "string") return null;
    try {
        return JSON.parse(v);
    } catch {
        return null;
    }
};

const fmtJakarta = (d) => {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);

    // Example: 20 Feb 2026, 01:07:35 GMT+7
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
    const day = get("day");
    const month = get("month");
    const year = get("year");
    const hour = get("hour");
    const minute = get("minute");
    const second = get("second");
    const tz = get("timeZoneName");

    return `${day} ${month} ${year}, ${hour}:${minute}:${second} ${tz}`;
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
    if (typeof x === "number") {
        // Humidity could be 76.33171 (keep 1 decimal looks nice)
        return Number.isFinite(x) ? x.toFixed(digits) : "—";
    }
    return String(x);
};

// ------------------------
// Main landing page
// ------------------------
app.get("/", async (req, res) => {
    try {
        // Latest 10 by received_at (preferred)
        let rows = [];
        try {
            const [r] = await pool.query(
                `
        SELECT
          tr.device_id,
          tr.received_at,
          tr.values_json
        FROM telemetry_readings_tb tr
        ORDER BY tr.received_at DESC
        LIMIT 10
        `
            );
            rows = r;
        } catch {
            // fallback if received_at doesn't exist
            const [r] = await pool.query(
                `
        SELECT
          tr.device_id,
          tr.recorded_at AS received_at,
          tr.values_json
        FROM telemetry_readings_tb tr
        ORDER BY tr.recorded_at DESC
        LIMIT 10
        `
            );
            rows = r;
        }

        const now = new Date();
        const serverTimeLine = `
      <div class="servertime">
        <b>Server time (Jakarta):</b> ${esc(fmtJakarta(now))}
      </div>
    `;

        // Prepare chart series in chronological order (oldest -> newest)
        const chronological = [...rows].reverse();

        const labels = chronological.map((r) =>
            r?.received_at ? fmtJakarta(r.received_at) : ""
        );

        const temps = chronological.map((r) => {
            const obj = safeJsonParse(r.values_json);
            return nOrNull(obj?.temp_c);
        });

        const rhs = chronological.map((r) => {
            const obj = safeJsonParse(r.values_json);
            return nOrNull(obj?.rh);
        });

        // Cards (latest first, as fetched)
        const entriesHtml = rows
            .map((r) => {
                const valuesObj = safeJsonParse(r.values_json);
                const core = pickCore(valuesObj);

                return `
          <div class="entry">
            <div class="entry-head">
              <div><b>received:</b> ${esc(r.received_at ? fmtJakarta(r.received_at) : "—")}</div>
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

        // Embed chart data safely
        const chartDataJson = esc(
            JSON.stringify({
                labels,
                temps,
                rhs,
            })
        );

        const html = `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AirBuddy Online</title>
        <style>
          :root {
            --border: #e6e6e6;
            --muted: #666;
            --bg: #fff;
            --panel: #fafafa;
          }
          body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif;
            margin: 24px;
            color: #111;
            background: var(--bg);
          }
          h1 { margin: 0 0 6px; }
          .sub { color: var(--muted); margin: 0 0 18px; }
          .links a { margin-right: 12px; }

          .servertime {
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 12px 14px;
            background: var(--panel);
            margin: 14px 0 14px;
          }

          .chartwrap {
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 14px;
            margin: 0 0 18px;
          }
          .charttitle {
            display:flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 12px;
            margin-bottom: 10px;
          }
          .charttitle b { font-size: 16px; }
          .legend { color: var(--muted); font-size: 13px; }
          canvas { width: 100%; height: 240px; display: block; }

          .entry {
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 14px;
            margin: 12px 0;
            background: #fff;
          }
          .entry-head {
            display:flex;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 10px;
          }
          .muted { color: var(--muted); }

          table.core {
            width: 100%;
            border-collapse: collapse;
            overflow: hidden;
            border-radius: 10px;
          }
          table.core th, table.core td {
            text-align: left;
            padding: 10px 10px;
            border-top: 1px solid var(--border);
            vertical-align: top;
          }
          table.core tr:first-child th, table.core tr:first-child td {
            border-top: none;
          }
          table.core th {
            width: 140px;
            color: #222;
            background: #fcfcfc;
            font-weight: 600;
          }

          .footerline { margin-top: 18px; color: var(--muted); font-size: 13px; }
        </style>
      </head>
      <body>
        <h1>AirBuddy Online</h1>
        <p class="sub">Last 10 telemetry readings (ordered by <b>received_at</b>)</p>

        <p class="links">
          <a href="/api/live">/api/live</a>
          <a href="/api/health">/api/health</a>
        </p>

        ${serverTimeLine}

        <div class="chartwrap">
          <div class="charttitle">
            <b>Temp & Humidity trend (last 10)</b>
            <div class="legend">Temp = <span style="color:#c62828;font-weight:600;">red</span> • Humidity = <span style="color:#1565c0;font-weight:600;">blue</span></div>
          </div>
          <canvas id="trend"></canvas>
        </div>

        ${rows.length ? entriesHtml : `<p>No telemetry readings yet.</p>`}

        <div class="footerline">Tip: received_at reflects when the server got the packet (best when device RTC is missing).</div>

        <script>
          (function () {
            const data = JSON.parse("${chartDataJson}");
            const canvas = document.getElementById("trend");
            const ctx = canvas.getContext("2d");

            function resize() {
              const dpr = window.devicePixelRatio || 1;
              const rect = canvas.getBoundingClientRect();
              canvas.width = Math.max(1, Math.floor(rect.width * dpr));
              canvas.height = Math.max(1, Math.floor(rect.height * dpr));
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              draw();
            }

            function minMax(arr) {
              let min = Infinity, max = -Infinity;
              for (const v of arr) {
                if (v == null) continue;
                if (v < min) min = v;
                if (v > max) max = v;
              }
              if (min === Infinity) return { min: 0, max: 1 };
              if (min === max) return { min: min - 1, max: max + 1 };
              return { min, max };
            }

            function drawLine(series, yMap, strokeStyle) {
              ctx.strokeStyle = strokeStyle;
              ctx.lineWidth = 2;
              ctx.beginPath();
              let started = false;
              for (let i = 0; i < series.length; i++) {
                const v = series[i];
                if (v == null) continue;
                const x = xMap(i);
                const y = yMap(v);
                if (!started) {
                  ctx.moveTo(x, y);
                  started = true;
                } else {
                  ctx.lineTo(x, y);
                }
              }
              ctx.stroke();
            }

            function drawPoints(series, yMap, fillStyle) {
              ctx.fillStyle = fillStyle;
              for (let i = 0; i < series.length; i++) {
                const v = series[i];
                if (v == null) continue;
                const x = xMap(i);
                const y = yMap(v);
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
              }
            }

            let xMap = (i) => i;
            function draw() {
              const W = canvas.getBoundingClientRect().width;
              const H = canvas.getBoundingClientRect().height;

              // Clear
              ctx.clearRect(0, 0, W, H);

              const padL = 40, padR = 18, padT = 16, padB = 26;
              const plotW = Math.max(1, W - padL - padR);
              const plotH = Math.max(1, H - padT - padB);

              const n = Math.max(data.labels.length, 1);
              xMap = (i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));

              const tMM = minMax(data.temps);
              const rMM = minMax(data.rhs);

              const yTemp = (v) => padT + (1 - (v - tMM.min) / (tMM.max - tMM.min)) * plotH;
              const yRh = (v) => padT + (1 - (v - rMM.min) / (rMM.max - rMM.min)) * plotH;

              // Grid
              ctx.strokeStyle = "#eee";
              ctx.lineWidth = 1;
              ctx.beginPath();
              for (let k = 0; k <= 4; k++) {
                const y = padT + (k * plotH) / 4;
                ctx.moveTo(padL, y);
                ctx.lineTo(padL + plotW, y);
              }
              ctx.stroke();

              // Axes
              ctx.strokeStyle = "#ddd";
              ctx.beginPath();
              ctx.moveTo(padL, padT);
              ctx.lineTo(padL, padT + plotH);
              ctx.lineTo(padL + plotW, padT + plotH);
              ctx.stroke();

              // Labels (minimal)
              ctx.fillStyle = "#666";
              ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif";

              // Left axis labels for Temp (top/bottom)
              ctx.fillText(tMM.max.toFixed(1) + "°C", 6, padT + 4);
              ctx.fillText(tMM.min.toFixed(1) + "°C", 6, padT + plotH);

              // Right axis labels for RH (top/bottom)
              const rhMax = rMM.max.toFixed(1) + "%";
              const rhMin = rMM.min.toFixed(1) + "%";
              ctx.fillText(rhMax, padL + plotW + 6, padT + 4);
              ctx.fillText(rhMin, padL + plotW + 6, padT + plotH);

              // Lines (your requested colors)
              drawLine(data.temps, yTemp, "#c62828"); // red
              drawLine(data.rhs, yRh, "#1565c0");    // blue

              // Points
              drawPoints(data.temps, yTemp, "#c62828");
              drawPoints(data.rhs, yRh, "#1565c0");
            }

            window.addEventListener("resize", resize);
            resize();
          })();
        </script>
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
// System routes (/api/live, /api/health)
// ------------------------
app.use("/api", systemRouter(pool, startedAt));

// ------------------------
// API v1 (authenticated)
// ------------------------
app.use("/api", deviceAuth(pool), telemetryRouter(pool));
app.use("/api", deviceAuth(pool), deviceRouter(pool));

// ------------------------
// Start Server (behind nginx)
// ------------------------
app.listen(Number(PORT), "127.0.0.1", () => {
    console.log(`AirBuddy Online API listening on http://127.0.0.1:${PORT}`);
});
