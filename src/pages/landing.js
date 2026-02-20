// src/pages/landing.js
import express from "express";

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

// MySQL JSON may already be an object (mysql2 behavior).
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

function makeFormatters(timeZone) {
    const tz = typeof timeZone === "string" && timeZone.length ? timeZone : "Etc/UTC";

    const fmtLong = (d) => {
        if (!d) return "";
        const dt = d instanceof Date ? d : new Date(d);
        if (Number.isNaN(dt.getTime())) return String(d);

        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: tz,
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

    // Short label for chart bottom ticks (e.g. "07:50")
    const fmtShort = (d) => {
        if (!d) return "";
        const dt = d instanceof Date ? d : new Date(d);
        if (Number.isNaN(dt.getTime())) return String(d);

        return new Intl.DateTimeFormat("en-GB", {
            timeZone: tz,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(dt);
    };

    return { tz, fmtLong, fmtShort };
}

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

const clampLimit = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 10;
    if (n <= 10) return 10;
    if (n <= 50) return 50;
    return 100;
};

const countNonNull = (arr) => arr.reduce((a, v) => a + (v == null ? 0 : 1), 0);

// ------------------------
// Look up user's timezone (buwana_id=1 for now)
// ------------------------
async function fetchUserTimeZone(pool, buwanaId = 1) {
    try {
        const [rows] = await pool.query(
            "SELECT time_zone FROM users_tb WHERE buwana_id = ? LIMIT 1",
            [buwanaId]
        );
        const tz = rows?.[0]?.time_zone;
        return typeof tz === "string" && tz.length ? tz : "Etc/UTC";
    } catch {
        return "Etc/UTC";
    }
}

// ------------------------
// Device summary (schema-aligned)
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
// Landing router
// ------------------------
export function landingRouter(pool) {
    const router = express.Router();

    router.get("/", async (req, res) => {
        try {
            const limit = clampLimit(req.query.limit);

            // Current assumption for now:
            // - buwana_id=1 owns the viewing session
            // - device_id=1 is the primary device
            const buwanaId = 1;
            const deviceId = 1;

            // ✅ User timezone lookup happens here (render-time)
            const userTz = await fetchUserTimeZone(pool, buwanaId);
            const { tz, fmtLong, fmtShort } = makeFormatters(userTz);

            const deviceSummary = await fetchDeviceSummary(pool, deviceId);

            // NOTE: With Option A (UTC in DB), these Date objects represent UTC instants.
            // fmtLong/fmtShort converts them to the user's tz for display.
            const [rows] = await pool.query(
                `
        SELECT
          tr.telemetry_id,
          tr.device_id,
          tr.recorded_at,
          tr.received_at,
          tr.values_json
        FROM telemetry_readings_tb tr
        WHERE tr.device_id = ?
        ORDER BY tr.recorded_at DESC
        LIMIT ?
        `,
                [deviceId, limit]
            );

            const now = new Date();

            const serverTimeLine = `
        <div class="servertime">
          <b>Server time (${esc(tz)}):</b> ${esc(fmtLong(now))}
        </div>
      `;

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

            const labelsLong = [];
            const labelsShort = [];

            const temps = [];
            const rtcTemps = [];
            const rhs = [];
            const eco2s = [];

            for (const r of chronological) {
                labelsLong.push(r?.recorded_at ? fmtLong(r.recorded_at) : "");
                labelsShort.push(r?.recorded_at ? fmtShort(r.recorded_at) : "");

                const obj = safeJsonParse(r.values_json);
                const core = pickCore(obj);

                temps.push(core.temp_c);
                rtcTemps.push(core.rtc_temp_c);
                rhs.push(core.rh);
                eco2s.push(core.eco2_ppm);
            }

            const pointsInfo = {
                temp: countNonNull(temps),
                rtcTemp: countNonNull(rtcTemps),
                rh: countNonNull(rhs),
                eco2: countNonNull(eco2s),
            };

            // Chart data as data-* attributes on each canvas (CSP-safe)
            const chartDataAttrs = `
        data-limit='${esc(limit)}'
        data-labels-long='${esc(JSON.stringify(labelsLong))}'
        data-labels-short='${esc(JSON.stringify(labelsShort))}'
        data-temps='${esc(JSON.stringify(temps))}'
        data-rtc-temps='${esc(JSON.stringify(rtcTemps))}'
        data-rhs='${esc(JSON.stringify(rhs))}'
        data-eco2s='${esc(JSON.stringify(eco2s))}'
      `;

            const limitControl = `
        <form class="limitform" method="GET" action="/">
          <label for="limit"><b>Chart range:</b></label>
          <select id="limit" name="limit">
            <option value="10" ${limit === 10 ? "selected" : ""}>10 entries</option>
            <option value="50" ${limit === 50 ? "selected" : ""}>50 entries</option>
            <option value="100" ${limit === 100 ? "selected" : ""}>100 entries</option>
          </select>
          <button type="submit">Apply</button>
        </form>
      `;

            const entriesHtml = rows
                .map((r) => {
                    const obj = safeJsonParse(r.values_json);
                    const core = pickCore(obj);

                    const deviceName = deviceSummary?.device_name ?? "device";
                    const rightLabel = `${deviceName} - ${r.device_id} | ${r.telemetry_id}`;

                    return `
            <div class="entry">
              <div class="entry-head">
                <div>
                  <b>recorded:</b> ${esc(r.recorded_at ? fmtLong(r.recorded_at) : "—")}
                  <span class="dot">•</span>
                  <b>received:</b> ${esc(r.received_at ? fmtLong(r.received_at) : "—")}
                </div>
                <div class="muted">${esc(rightLabel)}</div>
              </div>

              <table class="core">
                <tbody>
                  <tr><th>Temp</th><td>${esc(fmtVal(core.temp_c, 1))} °C</td></tr>
                  <tr><th>RTC temp</th><td>${esc(fmtVal(core.rtc_temp_c, 1))} °C</td></tr>
                  <tr><th>Humidity</th><td>${esc(fmtVal(core.rh, 1))} %</td></tr>
                  <tr><th>eCO₂</th><td>${esc(fmtVal(core.eco2_ppm, 0))} ppm</td></tr>
                  <tr><th>TVOC</th><td>${esc(fmtVal(core.tvoc_ppb, 0))} ppb</td></tr>
                  <tr><th>AQI</th><td>${esc(fmtVal(core.aqi, 0))}</td></tr>
                  <tr><th>Confidence</th><td>${esc(fmtVal(core.confidence, 0))} %</td></tr>
                  <tr><th>Ready</th><td>${esc(fmtVal(core.ready))}</td></tr>
                </tbody>
              </table>
            </div>
          `;
                })
                .join("\n");

            const chartsHtml = `
        <div class="charts-head">
          ${limitControl}
          <div class="hint">
            <span class="muted">X-axis shows 5 ticks; times shown at start / middle / end (device recorded_at in ${esc(
                tz
            )}).</span>
          </div>
        </div>

        <div class="chartwrap">
          <div class="charttitle">
            <b>Temperature trend (last ${esc(limit)})</b>
            <div class="legend">Temp + RTC Temp</div>
          </div>
          <div class="points">Temp points: ${pointsInfo.temp}/${limit} &nbsp; | &nbsp; RTC points: ${pointsInfo.rtcTemp}/${limit}</div>
          <canvas id="trend-temp" ${chartDataAttrs}></canvas>
        </div>

        <div class="chartwrap">
          <div class="charttitle">
            <b>Humidity trend (last ${esc(limit)})</b>
          </div>
          <div class="points">Points: ${pointsInfo.rh}/${limit}</div>
          <canvas id="trend-rh" ${chartDataAttrs}></canvas>
        </div>

        <div class="chartwrap">
          <div class="charttitle">
            <b>eCO₂ trend (last ${esc(limit)})</b>
          </div>
          <div class="points">Points: ${pointsInfo.eco2}/${limit}</div>
          <canvas id="trend-eco2" ${chartDataAttrs}></canvas>
        </div>
      `;

            const html = `
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>airBuddy | online</title>

          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Arvo:wght@400;700&family=Mulish:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">

          <style>
            :root {
              --border:#e6e6e6;
              --muted:#666;
              --panel:#fafafa;
            }

            body {
              font-family: "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif;
              margin: 24px;
              color:#111;
            }

            .brand {
              font-family: "Arvo", Georgia, "Times New Roman", serif;
              font-weight: 700;
              letter-spacing: 0.2px;
              margin: 0 0 6px;
              font-size: 28px;
            }

            .sub {
              color: var(--muted);
              margin: 0 0 18px;
              font-weight: 400;
            }

            .links a { margin-right: 12px; }

            .servertime {
              border: 1px solid var(--border);
              border-radius: 12px;
              padding: 12px 14px;
              background: var(--panel);
              margin: 14px 0 10px;
            }

            .deviceinfo {
              border: 1px solid var(--border);
              border-radius: 12px;
              padding: 12px 14px;
              background: #fff;
              margin: 0 0 18px;
              color: #222;
            }
            .deviceinfo .dot { margin: 0 8px; color: #bbb; }
            .muted { color: var(--muted); }
            .dot { margin: 0 8px; color: #bbb; }

            .charts-head {
              display:flex;
              justify-content: space-between;
              align-items: center;
              gap: 12px;
              flex-wrap: wrap;
              margin: 0 0 10px;
            }

            .limitform {
              display:flex;
              align-items:center;
              gap: 10px;
              padding: 10px 12px;
              border: 1px solid var(--border);
              border-radius: 12px;
              background: #fff;
            }
            .limitform label { font-weight: 700; }
            .limitform select {
              font-family: "Mulish", sans-serif;
              padding: 8px 10px;
              border-radius: 10px;
              border: 1px solid var(--border);
              background: #fff;
            }
            .limitform button {
              font-family: "Mulish", sans-serif;
              padding: 8px 12px;
              border-radius: 10px;
              border: 1px solid var(--border);
              background: var(--panel);
              cursor: pointer;
              font-weight: 700;
            }
            .limitform button:hover { background: #f2f2f2; }

            .chartwrap {
              border: 1px solid var(--border);
              border-radius: 12px;
              padding: 14px;
              margin: 0 0 14px;
              background: #fff;
            }

            .charttitle {
              display:flex;
              justify-content: space-between;
              align-items: baseline;
              gap: 12px;
              margin-bottom: 6px;
              font-weight: 700;
            }

            .legend { color: var(--muted); font-size: 13px; font-weight: 600; }
            .points { color: var(--muted); font-size: 12px; margin: 0 0 8px; font-weight: 400; }
            canvas { width: 100%; height: 220px; display: block; }

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
              font-weight: 600;
            }

            table.core {
              width: 100%;
              border-collapse: collapse;
              overflow: hidden;
              border-radius: 10px;
              font-weight: 400;
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
              font-weight: 700;
            }

            .footerline {
              margin-top: 18px;
              color: var(--muted);
              font-size: 13px;
            }
          </style>
        </head>

        <body>
          <div class="brand">airBuddy | online</div>
          <p class="sub">Last ${esc(limit)} telemetry readings (device_id=1, ordered by <b>recorded_at</b>)</p>

          <p class="links">
            <a href="/api/live">/api/live</a>
            <a href="/api/health">/api/health</a>
          </p>

          ${serverTimeLine}
          ${deviceLine}

          ${chartsHtml}

          ${rows.length ? entriesHtml : `<p>No telemetry readings yet.</p>`}

          <div class="footerline">
            DB stores UTC; page displays times in <b>${esc(tz)}</b> (from users_tb.time_zone).
          </div>

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

    return router;
}