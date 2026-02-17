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

let pool;
try {
    pool = makePool(process.env);
} catch (e) {
    console.error(e.message || e);
    process.exit(1);
}

// ------------------------
// Main landing (air.earthen.io/)
// Shows 5 latest telemetry records
// ------------------------
app.get("/", async (req, res) => {
    try {
        // NOTE: This assumes telemetry_readings_tb has:
        // reading_id (or telemetry_id), device_id, recorded_at, values_json, confidence_json, flags_json
        // If your PK is named differently, just remove it from SELECT.
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

        // Quick HTML (simple + safe)
        const esc = (s) =>
            String(s)
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");

        const prettyJson = (v) => {
            if (v == null) return "";
            try {
                const obj = typeof v === "string" ? JSON.parse(v) : v;
                return JSON.stringify(obj, null, 2);
            } catch {
                return String(v);
            }
        };

        const cards = rows
            .map((r) => {
                const values = esc(prettyJson(r.values_json));
                const conf = esc(prettyJson(r.confidence_json));
                const flags = esc(prettyJson(r.flags_json));

                return `
          <div class="card">
            <div class="meta">
              <div><b>device_id:</b> ${esc(r.device_id)}</div>
              <div><b>recorded_at:</b> ${esc(r.recorded_at)}</div>
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
          .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin: 12px 0; }
          .meta { display: flex; gap: 20px; flex-wrap: wrap; color: #333; margin-bottom: 10px; }
          pre { background: #f6f6f6; padding: 10px; border-radius: 8px; overflow:auto; }
          details > summary { cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>AirBuddy Online</h1>
        <p class="sub">Latest telemetry (most recent 5 readings)</p>

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
// Cleaner boundary: auth only applies to /api/v1/*
app.use("/api", deviceAuth(pool), telemetryRouter(pool));
app.use("/api", deviceAuth(pool), deviceRouter(pool));

// ------------------------
// Start Server (behind nginx)
// ------------------------
app.listen(Number(PORT), "127.0.0.1", () => {
    console.log(`AirBuddy Online API listening on http://127.0.0.1:${PORT}`);
});
