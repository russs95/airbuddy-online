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

// Always format display in Jakarta, regardless of OS timezone
const DISPLAY_TZ = "Asia/Jakarta";

let pool;
try {
    pool = makePool(process.env);
} catch (e) {
    console.error(e.message || e);
    process.exit(1);
}

// ------------------------
// Helpers (landing page)
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

const prettyJson = (v) => {
    if (v == null) return "";
    try {
        const obj = typeof v === "string" ? JSON.parse(v) : v;
        return JSON.stringify(obj, null, 2);
    } catch {
        return String(v);
    }
};

const fmtDate = (d, timeZone) => {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);

    // Human-readable with seconds + timezone abbreviation
    return new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
    }).format(dt);
};

const coerceDeviceTime = (valuesObj) => {
    if (!valuesObj || typeof valuesObj !== "object") return null;

    // Common keys people use for device time
    const candidates = [
        "device_time",
        "device_time_iso",
        "device_timestamp",
        "timestamp",
        "ts",
        "time",
        "iso_time",
        "datetime",
        "rtc_iso",
        "rtc_time",
        "device_epoch",
        "epoch",
        "epoch_s",
        "epoch_ms",
    ];

    let raw = null;
    for (const k of candidates) {
        if (valuesObj[k] != null) {
            raw = valuesObj[k];
            break;
        }
    }
    if (raw == null) return null;

    // If number-ish: treat as epoch seconds or ms
    if (typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw)))) {
        const n = typeof raw === "number" ? raw : Number(raw);

        // Heuristic: if it's >= 10^12 it's probably ms, else seconds
        const ms = n >= 1e12 ? n : n * 1000;
        const dt = new Date(ms);
        if (!Number.isNaN(dt.getTime())) {
            return { raw, date: dt, kind: n >= 1e12 ? "epoch_ms" : "epoch_s" };
        }
    }

    // Otherwise: try parsing as ISO/date string
    if (typeof raw === "string") {
        const dt = new Date(raw);
        if (!Number.isNaN(dt.getTime())) {
            return { raw, date: dt, kind: "date_string" };
        }
    }

    // Give up, but still return raw for debugging
    return { raw, date: null, kind: "unknown" };
};

// ------------------------
// Main landing (air.earthen.io/)
// Shows 5 latest telemetry records
// ------------------------
app.get("/", async (req, res) => {
    try {
        const [rows] = await pool.query(
            `
      SELECT
        tr.device_id,
        tr.recorded_at,
        tr.values_json,
        tr.confidence_json,
        tr.flags_json
      FROM telemetry_readings_tb tr
      ORDER BY tr.recorded_at DESC
      LIMIT 5
      `
        );

        const now = new Date();

        const headerTimes = `
      <div class="timebox">
        <div><b>Server time (Jakarta):</b> ${esc(fmtDate(now, DISPLAY_TZ))}</div>
        <div><b>Server time (UTC):</b> ${esc(fmtDate(now, "UTC"))}</div>
        <div><b>Server ISO:</b> ${esc(now.toISOString())}</div>
      </div>
    `;

        const cards = rows
            .map((r) => {
                const valuesObj = safeJsonParse(r.values_json);
                const deviceTime = coerceDeviceTime(valuesObj);

                const recordedRaw = r.recorded_at;
                const recordedJakarta = fmtDate(r.recorded_at, DISPLAY_TZ);
                const recordedUtc = fmtDate(r.recorded_at, "UTC");

                const deviceJakarta =
                    deviceTime?.date ? fmtDate(deviceTime.date, DISPLAY_TZ) : null;
                const deviceUtc =
                    deviceTime?.date ? fmtDate(deviceTime.date, "UTC") : null;

                const values = esc(prettyJson(r.values_json));
                const conf = esc(prettyJson(r.confidence_json));
                const flags = esc(prettyJson(r.flags_json));

                return `
          <div class="card">
            <div class="meta">
              <div><b>device_id:</b> ${esc(r.device_id)}</div>
            </div>

            <div class="compare">
              <div class="compare-row">
                <div class="label"><b>recorded_at (raw):</b></div>
                <div class="val">${esc(recordedRaw)}</div>
              </div>
              <div class="compare-row">
                <div class="label"><b>recorded_at (Jakarta):</b></div>
                <div class="val">${esc(recordedJakarta)}</div>
              </div>
              <div class="compare-row">
                <div class="label"><b>recorded_at (UTC):</b></div>
                <div class="val">${esc(recordedUtc)}</div>
              </div>

              <hr class="sep"/>

              <div class="compare-row">
                <div class="label"><b>device time (raw field):</b></div>
                <div class="val">${deviceTime ? esc(deviceTime.raw) : "—"}</div>
              </div>
              <div class="compare-row">
                <div class="label"><b>device time (Jakarta):</b></div>
                <div class="val">${deviceJakarta ? esc(deviceJakarta) : "—"}</div>
              </div>
              <div class="compare-row">
                <div class="label"><b>device time (UTC):</b></div>
                <div class="val">${deviceUtc ? esc(deviceUtc) : "—"}</div>
              </div>
              ${deviceTime ? `
                <div class="compare-row">
                  <div class="label"><b>device time parse:</b></div>
                  <div class="val">${esc(deviceTime.kind)}</div>
                </div>
              ` : ""}
            </div>

            <details open>
              <summary><b>values_json</b></summary>
              <pre>${values}</pre>
            </details>

            ${conf ? `
              <details>
                <summary><b>confidence_json</b></summary>
                <pre>${conf}</pre>
              </details>
            ` : ""}

            ${flags ? `
              <details>
                <summary><b>flags_json</b></summary>
                <pre>${flags}</pre>
              </details>
            ` : ""}
          </div>
        `;
            })
            .join("\n");

        const html = `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AirBuddy Online</title>
        <style>
          body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif; margin: 24px; }
          h1 { margin: 0 0 6px; }
          .sub { color: #555; margin: 0 0 18px; }
          .links a { margin-right: 12px; }
          .timebox { border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px; background: #fafafa; margin: 14px 0 18px; }
          .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin: 12px 0; }
          .meta { display: flex; gap: 20px; flex-wrap: wrap; color: #333; margin-bottom: 10px; }
          .compare { border: 1px dashed #ddd; border-radius: 10px; padding: 12px; margin: 10px 0 12px; background: #fff; }
          .compare-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 4px 0; }
          .label { min-width: 180px; color: #333; }
          .val { color: #111; }
          .sep { border: 0; border-top: 1px solid #eee; margin: 10px 0; }
          pre { background: #f6f6f6; padding: 10px; border-radius: 8px; overflow:auto; }
          details > summary { cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>AirBuddy Online</h1>
        <p class="sub">Latest telemetry (most recent 5 readings)</p>

        ${headerTimes}

        <p class="links">
          <a href="/api/live">/api/live</a>
          <a href="/api/health">/api/health</a>
        </p>

        ${rows.length ? cards : `<p>No telemetry readings yet.</p>`}
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
