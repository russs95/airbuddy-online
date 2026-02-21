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

function clampRange(raw) {
    const v = String(raw || "").trim();
    // Allowed chart ranges (must match temps.js / chart_core.js defaults)
    const allowed = new Set(["1h", "6h", "24h", "72h", "7d", "30d"]);
    return allowed.has(v) ? v : "24h";
}

// Latest-10 list remains regardless of range selection
const LATEST_LIST_LIMIT = 10;

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
// Device (full info for collapsible box)
// ------------------------
async function fetchDeviceFull(pool, deviceId = 1) {
    const sql = `
        SELECT
            d.device_id,
            d.device_uid,
            d.device_name,
            d.device_type,
            d.firmware_version,
            d.status,
            d.last_seen_at,
            d.created_at,
            d.home_id,
            d.room_id,
            d.claimed_by_buwana_id,

            h.home_name,
            r.room_name,

            u.full_name AS claimed_full_name,
            u.time_zone AS user_time_zone,

            c.com_name
        FROM devices_tb d
                 LEFT JOIN homes_tb h ON h.home_id = d.home_id
                 LEFT JOIN rooms_tb r ON r.room_id = d.room_id
                 LEFT JOIN users_tb u ON u.buwana_id = d.claimed_by_buwana_id
                 LEFT JOIN communities_tb c ON c.community_id = u.community_id
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
// Telemetry fetch helpers
// ------------------------
async function fetchTelemetryRange(pool, deviceId, cutoffUnixSec, limitMax = 5000) {
    // We fetch everything from cutoff to now (up to a sane max), oldest->newest for chart
    // recorded_at is DATETIME (UTC). Use UNIX_TIMESTAMP(recorded_at) for unix seconds.
    const sql = `
        SELECT
            tr.telemetry_id,
            tr.device_id,
            tr.recorded_at,
            tr.received_at,
            UNIX_TIMESTAMP(tr.recorded_at) AS recorded_unix,
            tr.values_json
        FROM telemetry_readings_tb tr
        WHERE tr.device_id = ?
          AND tr.recorded_at >= FROM_UNIXTIME(?)
        ORDER BY tr.recorded_at ASC
        LIMIT ?
    `;
    const [rows] = await pool.query(sql, [deviceId, cutoffUnixSec, limitMax]);
    return rows || [];
}

async function fetchTelemetryLatest(pool, deviceId, limit = 10) {
    const sql = `
        SELECT
            tr.telemetry_id,
            tr.device_id,
            tr.recorded_at,
            tr.received_at,
            UNIX_TIMESTAMP(tr.recorded_at) AS recorded_unix,
            tr.values_json
        FROM telemetry_readings_tb tr
        WHERE tr.device_id = ?
        ORDER BY tr.recorded_at DESC
        LIMIT ?
    `;
    const [rows] = await pool.query(sql, [deviceId, limit]);
    return rows || [];
}

// ------------------------
// Landing router
// ------------------------
export function landingRouter(pool) {
    const router = express.Router();

    router.get("/", async (req, res) => {
        try {
            // Current assumption (for now):
            const buwanaId = 1;
            const deviceId = 1;

            // Chart range selection (time-based)
            const range = clampRange(req.query.range);

            // Hours mapping (server-side used only to compute cutoff)
            const RANGE_HOURS = {
                "1h": 1,
                "6h": 6,
                "24h": 24,
                "72h": 72,
                "7d": 24 * 7,
                "30d": 24 * 30,
            };

            const hours = RANGE_HOURS[range] || 24;
            const nowUnix = Math.floor(Date.now() / 1000);
            const cutoffUnix = nowUnix - hours * 3600;

            // ✅ User timezone lookup happens here (render-time)
            const userTz = await fetchUserTimeZone(pool, buwanaId);
            const { tz, fmtLong } = makeFormatters(userTz);

            // Device info (for collapsible)
            const device = await fetchDeviceFull(pool, deviceId);

            // Telemetry
            const chartRows = await fetchTelemetryRange(pool, deviceId, cutoffUnix, 5000);
            const latestRows = await fetchTelemetryLatest(pool, deviceId, LATEST_LIST_LIMIT);

            // Online indicator: last telemetry received within 121 seconds
            // Use received_at if available; fallback recorded_at.
            let online = false;
            let lastSeenUnix = null;

            if (latestRows && latestRows.length) {
                const r0 = latestRows[0];
                const dt = r0?.received_at || r0?.recorded_at || null;
                if (dt) {
                    const ms = new Date(dt).getTime();
                    if (!Number.isNaN(ms)) {
                        lastSeenUnix = Math.floor(ms / 1000);
                        online = (nowUnix - lastSeenUnix) <= 121;
                    }
                }
            }

            // Build chart payload arrays (timestamps in unix seconds + values arrays)
            const timestamps = [];
            const temps = [];
            const rtcTemps = [];

            for (const r of chartRows) {
                const t = Number(r?.recorded_unix);
                if (!Number.isFinite(t)) continue;

                const obj = safeJsonParse(r.values_json);
                const core = pickCore(obj);

                timestamps.push(t);
                temps.push(core.temp_c);
                rtcTemps.push(core.rtc_temp_c);
            }

            const serverTimeLine = `
        <div class="servertime">
          <b>Server time (${esc(tz)}):</b> ${esc(fmtLong(new Date()))}
        </div>
      `;

            // Collapsible device box with summary row + details
            const deviceSummaryLine = device
                ? `
          <div class="devsum">
            <div class="left">
              <span class="pill ${online ? "ok" : "bad"}">${online ? "🟢 online" : "⚪ offline"}</span>
              <span class="devname"><b>${esc(device.device_name ?? "(unnamed)")}</b></span>
              <span class="dot">•</span>
              <span class="muted">ID:</span> ${esc(device.device_id)}
              <span class="dot">•</span>
              <span class="muted">Home:</span> ${esc(device.home_name ?? "(none)")}
              <span class="dot">•</span>
              <span class="muted">Room:</span> ${esc(device.room_name ?? "(none)")}
            </div>
            <div class="right">
              <span class="chev">▾</span>
            </div>
          </div>
        `
                : `<div class="muted">(device_id=1 not found)</div>`;

            const lastSeenLine =
                lastSeenUnix != null
                    ? `<span class="muted">Last seen:</span> ${esc(fmtLong(new Date(lastSeenUnix * 1000)))}`
                    : `<span class="muted">Last seen:</span> —`;

            const deviceDetails = device
                ? `
          <div class="devdetail">
            <div class="grid">
              <div><span class="muted">device_uid</span><br><b>${esc(device.device_uid)}</b></div>
              <div><span class="muted">device_type</span><br><b>${esc(device.device_type)}</b></div>
              <div><span class="muted">firmware_version</span><br><b>${esc(device.firmware_version ?? "—")}</b></div>
              <div><span class="muted">status</span><br><b>${esc(device.status)}</b></div>
              <div><span class="muted">created_at</span><br><b>${esc(device.created_at ? fmtLong(device.created_at) : "—")}</b></div>
              <div><span class="muted">last_seen_at</span><br><b>${esc(device.last_seen_at ? fmtLong(device.last_seen_at) : "—")}</b></div>
              <div><span class="muted">claimed_by</span><br><b>${esc(device.claimed_full_name ?? "—")}</b></div>
              <div><span class="muted">user TZ</span><br><b>${esc(device.user_time_zone ?? tz)}</b></div>
            </div>
            <div class="smallnote">${lastSeenLine}</div>
          </div>
        `
                : "";

            const deviceBox = `
        <details class="deviceinfo" ${online ? "open" : ""}>
          <summary>
            ${deviceSummaryLine}
          </summary>
          ${deviceDetails}
        </details>
      `;

            // Dropdown (GET) for chart range (time window)
            const rangeControl = `
        <form class="rangeform" method="GET" action="/">
          <label for="range-select"><b>Chart range:</b></label>
          <select id="range-select" name="range">
            <option value="1h" ${range === "1h" ? "selected" : ""}>last 1 hour</option>
            <option value="6h" ${range === "6h" ? "selected" : ""}>last 6 hours</option>
            <option value="24h" ${range === "24h" ? "selected" : ""}>last 24 hours</option>
            <option value="72h" ${range === "72h" ? "selected" : ""}>last 72 hours</option>
            <option value="7d" ${range === "7d" ? "selected" : ""}>last week</option>
            <option value="30d" ${range === "30d" ? "selected" : ""}>last month</option>
          </select>
          <button type="submit">Apply</button>
        </form>
      `;

            // Chart canvas payload: timestamps + temps + rtc temps
            const chartDataAttrs = `
        data-timestamps='${esc(JSON.stringify(timestamps))}'
        data-temps='${esc(JSON.stringify(temps))}'
        data-rtc-temps='${esc(JSON.stringify(rtcTemps))}'
      `;

            // Latest 10 readings list (regardless of chart range)
            const latestHtml = (latestRows || [])
                .map((r) => {
                    const obj = safeJsonParse(r.values_json);
                    const core = pickCore(obj);
                    const rightLabel = `device ${r.device_id} | ${r.telemetry_id}`;

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
              --bg:#ffffff;
              --fg:#111111;
              --card:#ffffff;
              --link:#0b66c3;
              --chip:#f2f2f2;
              --shadow: rgba(0,0,0,0.04);
            }

            /* Dark theme via data-theme attribute */
            html[data-theme="dark"] {
              --border:#2a2a2a;
              --muted:#a0a0a0;
              --panel:#141414;
              --bg:#0f0f0f;
              --fg:#f2f2f2;
              --card:#141414;
              --link:#79b8ff;
              --chip:#1f1f1f;
              --shadow: rgba(0,0,0,0.35);
            }

            body {
              font-family: "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif;
              margin: 24px;
              color: var(--fg);
              background: var(--bg);
            }

            a { color: var(--link); }

            .topbar {
              display:flex;
              align-items:flex-start;
              justify-content: space-between;
              gap: 12px;
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

            .themebtn {
              display:inline-flex;
              align-items:center;
              justify-content:center;
              width: 40px;
              height: 40px;
              border-radius: 12px;
              border: 1px solid var(--border);
              background: var(--card);
              cursor: pointer;
              box-shadow: 0 1px 0 var(--shadow);
              user-select: none;
              font-size: 18px;
            }
            .themebtn:hover { filter: brightness(1.03); }

            .links a { margin-right: 12px; }

            .servertime {
              border: 1px solid var(--border);
              border-radius: 12px;
              padding: 12px 14px;
              background: var(--panel);
              margin: 14px 0 10px;
            }

            details.deviceinfo {
              border: 1px solid var(--border);
              border-radius: 12px;
              padding: 10px 12px;
              background: var(--card);
              margin: 0 0 18px;
              color: var(--fg);
              box-shadow: 0 1px 0 var(--shadow);
            }

            details.deviceinfo summary {
              list-style: none;
              cursor: pointer;
            }
            details.deviceinfo summary::-webkit-details-marker { display: none; }

            .devsum {
              display:flex;
              justify-content: space-between;
              align-items: center;
              gap: 12px;
              flex-wrap: wrap;
            }
            .devsum .left { display:flex; gap: 10px; flex-wrap: wrap; align-items: baseline; }
            .devsum .right { color: var(--muted); font-weight: 700; }
            .chev { font-size: 16px; }

            .pill {
              display:inline-flex;
              align-items:center;
              gap: 6px;
              padding: 4px 10px;
              border-radius: 999px;
              border: 1px solid var(--border);
              background: var(--chip);
              font-weight: 700;
              font-size: 13px;
            }
            .pill.ok { }
            .pill.bad { opacity: 0.85; }

            .devdetail {
              margin-top: 10px;
              padding-top: 10px;
              border-top: 1px solid var(--border);
            }

            .grid {
              display:grid;
              grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
              gap: 10px;
            }

            .dot { margin: 0 6px; color: #999; }
            .muted { color: var(--muted); }
            .smallnote { margin-top: 10px; color: var(--muted); font-size: 13px; }

            .charts-head {
              display:flex;
              justify-content: space-between;
              align-items: center;
              gap: 12px;
              flex-wrap: wrap;
              margin: 0 0 10px;
            }

            .rangeform {
              display:flex;
              align-items:center;
              gap: 10px;
              padding: 10px 12px;
              border: 1px solid var(--border);
              border-radius: 12px;
              background: var(--card);
              box-shadow: 0 1px 0 var(--shadow);
            }
            .rangeform label { font-weight: 700; }
            .rangeform select {
              font-family: "Mulish", sans-serif;
              padding: 8px 10px;
              border-radius: 10px;
              border: 1px solid var(--border);
              background: var(--bg);
              color: var(--fg);
            }
            .rangeform button {
              font-family: "Mulish", sans-serif;
              padding: 8px 12px;
              border-radius: 10px;
              border: 1px solid var(--border);
              background: var(--panel);
              color: var(--fg);
              cursor: pointer;
              font-weight: 700;
            }
            .rangeform button:hover { filter: brightness(1.03); }

            .chartwrap {
              border: 1px solid var(--border);
              border-radius: 12px;
              padding: 14px;
              margin: 0 0 14px;
              background: var(--card);
              box-shadow: 0 1px 0 var(--shadow);
            }

            .charttitle {
              display:flex;
              justify-content: space-between;
              align-items: baseline;
              gap: 12px;
              margin-bottom: 6px;
              font-weight: 700;
            }

            canvas { width: 100%; height: 240px; display: block; }

            .sectiontitle {
              margin: 18px 0 8px;
              font-weight: 800;
            }

            .entry {
              border: 1px solid var(--border);
              border-radius: 12px;
              padding: 14px;
              margin: 12px 0;
              background: var(--card);
              box-shadow: 0 1px 0 var(--shadow);
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
              color: var(--fg);
              background: rgba(0,0,0,0.03);
              font-weight: 800;
            }
            html[data-theme="dark"] table.core th {
              background: rgba(255,255,255,0.04);
            }

            .footerline {
              margin-top: 18px;
              color: var(--muted);
              font-size: 13px;
            }
          </style>
        </head>

        <body>
          <div class="topbar">
            <div>
              <div class="brand">airBuddy | online</div>
              <p class="sub">The airBuddy project beta server.</p>
            </div>

            <button class="themebtn" id="theme-toggle" aria-label="Toggle theme" title="Toggle light/dark">
              🌙
            </button>
          </div>

          <p class="links">
            <a href="/api/live">/api/live</a>
            <a href="/api/health">/api/health</a>
          </p>

          ${serverTimeLine}
          ${deviceBox}

          <div class="charts-head">
            ${rangeControl}
          </div>

          <div class="chartwrap">
            <div class="charttitle">
              <b>Temperature trend</b>
              <span class="muted">(${esc(range)} window)</span>
            </div>
            <canvas id="trend-temp" ${chartDataAttrs}></canvas>
          </div>

          <div class="sectiontitle">Latest ${LATEST_LIST_LIMIT} telemetry readings</div>
          ${latestRows.length ? latestHtml : `<p class="muted">No telemetry readings yet.</p>`}

          <div class="footerline">
            DB stores UTC; page displays times in <b>${esc(tz)}</b>.
          </div>

          <!-- Theme -->
          <script src="/static/theme.js"></script>
          <script>
            (function () {
              const btn = document.getElementById("theme-toggle");
              if (!btn || !window.AirBuddyTheme) return;

              function syncIcon() {
                const cur = document.documentElement.getAttribute("data-theme");
                btn.textContent = cur === "dark" ? "☀️" : "🌙";
              }

              btn.addEventListener("click", function () {
                window.AirBuddyTheme.toggle();
                syncIcon();
              });

              syncIcon();
            })();
          </script>

          <!-- Charts (order matters) -->
          <script src="/static/chart_core.js"></script>
          <script src="/static/temps.js"></script>
        </body>
        </html>
      `;

            // Always avoid caching
            res.set("Cache-Control", "no-store");
            res.status(200).type("html").send(html);
        } catch (e) {
            console.error("GET / landing error:", e?.code || e?.message || e);
            res.status(500).type("text").send("server_error");
        }
    });

    return router;
}