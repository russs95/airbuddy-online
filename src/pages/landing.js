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
        // mysql2 may return JSON columns as objects; or Buffers sometimes
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) {
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

    return { tz, fmtLong };
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

function toUnixSeconds(d) {
    if (!d) return null;
    const dt = d instanceof Date ? d : new Date(d);
    const ms = dt.getTime();
    if (Number.isNaN(ms)) return null;
    return Math.floor(ms / 1000);
}

// ------------------------
// Time range (for UI + server fetch cap)
// NOTE: charts filter client-side; server just sends "enough" points.
// ------------------------
const RANGE_KEYS = ["1h", "6h", "24h", "72h", "7d", "30d"];
const RANGE_HOURS = {
    "1h": 1,
    "6h": 6,
    "24h": 24,
    "72h": 72,
    "7d": 24 * 7,
    "30d": 24 * 30,
};

function pickRangeKey(raw) {
    const s = String(raw || "").trim();
    return RANGE_KEYS.includes(s) ? s : "24h";
}

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
// Device info (summary + full)
// ------------------------
async function fetchDeviceInfo(pool, deviceId = 1) {
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

            h.home_name,
            r.room_name,

            u.buwana_id AS claimed_by_buwana_id,
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
// Landing router
// ------------------------
export function landingRouter(pool) {
    const router = express.Router();

    router.get("/", async (req, res) => {
        try {
            // Current assumption for now:
            // - buwana_id=1 owns the viewing session
            // - device_id=1 is the primary device
            const buwanaId = 1;
            const deviceId = 1;

            const rangeKey = pickRangeKey(req.query.range);
            const hours = RANGE_HOURS[rangeKey] || 24;

            // ✅ User timezone lookup happens here (render-time)
            const userTz = await fetchUserTimeZone(pool, buwanaId);
            const { tz, fmtLong } = makeFormatters(userTz);

            const device = await fetchDeviceInfo(pool, deviceId);

            // ------------------------
            // Telemetry:
            //  - chartRows: "enough" points (cap + time cutoff)
            //  - latestRows: always last 10 (for the list under the charts)
            // ------------------------
            const nowUnix = Math.floor(Date.now() / 1000);
            const cutoffUnix = nowUnix - hours * 3600;

            // cap so we never ship a massive payload (tweak if needed)
            const MAX_POINTS = 5000;

            const [chartRows] = await pool.query(
                `
                SELECT
                    telemetry_id,
                    device_id,
                    recorded_at,
                    received_at,
                    values_json
                FROM telemetry_readings_tb
                WHERE device_id = ?
                  AND recorded_at >= FROM_UNIXTIME(?)
                ORDER BY recorded_at ASC
                LIMIT ?
                `,
                [deviceId, cutoffUnix, MAX_POINTS]
            );

            const [latestRows] = await pool.query(
                `
                SELECT
                    telemetry_id,
                    device_id,
                    recorded_at,
                    received_at,
                    values_json
                FROM telemetry_readings_tb
                WHERE device_id = ?
                ORDER BY recorded_at DESC
                LIMIT 10
                `,
                [deviceId]
            );

            // Online indicator: last telemetry received within 121 seconds
            let online = false;
            let lastReceivedAt = null;
            if (latestRows && latestRows.length) {
                lastReceivedAt = latestRows[0]?.received_at ?? null;
                const lastReceivedUnix = toUnixSeconds(lastReceivedAt);
                if (lastReceivedUnix != null) {
                    online = (nowUnix - lastReceivedUnix) <= 121;
                }
            }

            // ------------------------
            // Build chart arrays (from chartRows, already chronological)
            // ------------------------
            const timestamps = [];
            const temps = [];
            const rtcTemps = [];
            const rhs = [];
            const eco2s = [];
            const tvocs = [];

            for (const r of chartRows || []) {
                const ts = toUnixSeconds(r?.recorded_at);
                if (ts == null) continue;

                const obj = safeJsonParse(r.values_json);
                const core = pickCore(obj);

                // Keep arrays aligned by index (timestamps always present)
                timestamps.push(ts);
                temps.push(core.temp_c);
                rtcTemps.push(core.rtc_temp_c);
                rhs.push(core.rh);
                eco2s.push(core.eco2_ppm);
                tvocs.push(core.tvoc_ppb);
            }

            const now = new Date();

            // ------------------------
            // Header blocks
            // ------------------------
            const serverTimeLine = `
                <div class="servertime">
                    <b>Server time (${esc(tz)}):</b> ${esc(fmtLong(now))}
                </div>
            `;

            const deviceName = device?.device_name ?? "(unnamed)";
            const homeName = device?.home_name ?? "(none)";
            const roomName = device?.room_name ?? "(none)";
            const fw = device?.firmware_version ?? "—";
            const dtype = device?.device_type ?? "—";
            const status = device?.status ?? "—";
            const lastSeen = device?.last_seen_at ? fmtLong(device.last_seen_at) : "—";
            const createdAt = device?.created_at ? fmtLong(device.created_at) : "—";
            const uid = device?.device_uid ?? "—";
            const claimed = device?.claimed_full_name ?? "—";

            const onlineDot = online ? "🟢 online" : "⚪ offline";

            const deviceBox = `
                <details class="deviceinfo">
                    <summary>
                        <div class="device-summary">
                            <div class="left">
                                <span class="statusdot">${esc(onlineDot)}</span>
                                <span class="sep">•</span>
                                <b>Device:</b> ${esc(deviceName)}
                                <span class="sep">•</span>
                                <b>Home:</b> ${esc(homeName)}
                                <span class="sep">•</span>
                                <b>Room:</b> ${esc(roomName)}
                                <span class="sep">•</span>
                                <b>ID:</b> ${esc(device?.device_id ?? deviceId)}
                            </div>
                            <div class="right">▾</div>
                        </div>
                    </summary>

                    <div class="device-details">
                        <table class="kv">
                            <tbody>
                                <tr><th>device_uid</th><td>${esc(uid)}</td></tr>
                                <tr><th>device_type</th><td>${esc(dtype)}</td></tr>
                                <tr><th>firmware_version</th><td>${esc(fw)}</td></tr>
                                <tr><th>status</th><td>${esc(status)}</td></tr>
                                <tr><th>last_seen_at</th><td>${esc(lastSeen)}</td></tr>
                                <tr><th>created_at</th><td>${esc(createdAt)}</td></tr>
                                <tr><th>claimed_by</th><td>${esc(claimed)}</td></tr>
                                <tr><th>last telemetry received</th><td>${esc(lastReceivedAt ? fmtLong(lastReceivedAt) : "—")}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </details>
            `;

            // ------------------------
            // Range dropdown (drives all charts)
            // ------------------------
            const rangeControl = `
                <form class="rangeform" method="GET" action="/">
                    <label for="range"><b>Time range:</b></label>
                    <select id="range" name="range">
                        <option value="1h" ${rangeKey === "1h" ? "selected" : ""}>Last 1 hour</option>
                        <option value="6h" ${rangeKey === "6h" ? "selected" : ""}>Last 6 hours</option>
                        <option value="24h" ${rangeKey === "24h" ? "selected" : ""}>Last 24 hours</option>
                        <option value="72h" ${rangeKey === "72h" ? "selected" : ""}>Last 72 hours</option>
                        <option value="7d" ${rangeKey === "7d" ? "selected" : ""}>Last week</option>
                        <option value="30d" ${rangeKey === "30d" ? "selected" : ""}>Last month</option>
                    </select>
                    <button type="submit">Apply</button>

                    <!-- Shared selector for JS charts (kept in sync with GET by default) -->
                    <input type="hidden" id="range-select-shadow" value="${esc(rangeKey)}" />
                </form>
            `;

            // ------------------------
            // Charts
            // Each canvas carries only what it needs.
            // (shared range selector is #range-select below)
            // ------------------------
            const commonDataAttrs = `
                data-timestamps='${esc(JSON.stringify(timestamps))}'
            `;

            const chartsHtml = `
                <div class="charts-head">
                    ${rangeControl}

                    <div class="modes">
                        <button id="modeToggle" class="modebtn" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">
                            ◐
                        </button>
                    </div>
                </div>

                <!-- Shared selector consumed by chart scripts -->
                <select id="range-select" class="rangeselect" aria-label="Chart range select">
                    <option value="1h" ${rangeKey === "1h" ? "selected" : ""}>1h</option>
                    <option value="6h" ${rangeKey === "6h" ? "selected" : ""}>6h</option>
                    <option value="24h" ${rangeKey === "24h" ? "selected" : ""}>24h</option>
                    <option value="72h" ${rangeKey === "72h" ? "selected" : ""}>72h</option>
                    <option value="7d" ${rangeKey === "7d" ? "selected" : ""}>7d</option>
                    <option value="30d" ${rangeKey === "30d" ? "selected" : ""}>30d</option>
                </select>

                <div class="chartwrap">
                    <div class="charttitle">
                        <b>Temperature trend</b>
                        <div class="legend">Temp + RTC Temp</div>
                    </div>
                    <canvas
                        id="trend-temp"
                        ${commonDataAttrs}
                        data-temps='${esc(JSON.stringify(temps))}'
                        data-rtc-temps='${esc(JSON.stringify(rtcTemps))}'
                    ></canvas>
                </div>

                <div class="chartwrap">
                    <div class="charttitle">
                        <b>Humidity trend</b>
                    </div>
                    <canvas
                        id="trend-rh"
                        ${commonDataAttrs}
                        data-rhs='${esc(JSON.stringify(rhs))}'
                    ></canvas>
                </div>

                <div class="chartwrap">
                    <div class="charttitle">
                        <b>eCO₂ trend</b>
                    </div>
                    <canvas
                        id="trend-eco2"
                        ${commonDataAttrs}
                        data-eco2s='${esc(JSON.stringify(eco2s))}'
                    ></canvas>
                </div>

                <div class="chartwrap">
                    <div class="charttitle">
                        <b>TVOC trend</b>
                    </div>
                    <canvas
                        id="trend-tvoc"
                        ${commonDataAttrs}
                        data-tvocs='${esc(JSON.stringify(tvocs))}'
                    ></canvas>
                </div>
            `;

            // ------------------------
            // Latest 10 telemetry entries (always)
            // ------------------------
            const latestEntriesHtml = (latestRows || [])
                .map((r) => {
                    const obj = safeJsonParse(r.values_json);
                    const core = pickCore(obj);

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

            const html = `
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>airBuddy | online</title>

    <!-- Fonts (Arvo for title, Mulish for body) -->
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
        }

        [data-theme="dark"] {
            --border:#2a2a2a;
            --muted:#a7a7a7;
            --panel:#141414;
            --bg:#0e0e0e;
            --fg:#f1f1f1;
            --card:#0f0f0f;
        }

        body {
            font-family: "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif;
            margin: 24px;
            color: var(--fg);
            background: var(--bg);
        }

        .topbar {
            display:flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 14px;
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

        .links a { margin-right: 12px; color: inherit; }

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
            padding: 0;
            background: var(--card);
            margin: 0 0 18px;
            color: inherit;
            overflow: hidden;
        }

        details.deviceinfo summary {
            list-style: none;
            cursor: pointer;
            padding: 12px 14px;
            user-select: none;
        }

        details.deviceinfo summary::-webkit-details-marker { display:none; }

        .device-summary {
            display:flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }

        .device-summary .left {
            display:flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            font-weight: 600;
        }

        .device-summary .right {
            color: var(--muted);
            font-weight: 700;
        }

        .sep, .dot { margin: 0 6px; color: var(--muted); }
        .muted { color: var(--muted); }

        .device-details {
            border-top: 1px solid var(--border);
            padding: 12px 14px;
            background: var(--panel);
        }

        table.kv {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        table.kv th, table.kv td {
            text-align: left;
            padding: 8px 8px;
            border-top: 1px solid var(--border);
            vertical-align: top;
        }

        table.kv tr:first-child th, table.kv tr:first-child td { border-top: none; }
        table.kv th { width: 180px; color: var(--muted); font-weight: 700; }

        .charts-head {
            display:flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            margin: 0 0 8px;
        }

        .rangeform {
            display:flex;
            align-items:center;
            gap: 10px;
            padding: 10px 12px;
            border: 1px solid var(--border);
            border-radius: 12px;
            background: var(--card);
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
            cursor: pointer;
            font-weight: 700;
            color: var(--fg);
        }

        .modes { display:flex; align-items: center; gap: 10px; }

        .modebtn {
            border: 1px solid var(--border);
            background: var(--card);
            color: var(--fg);
            border-radius: 12px;
            padding: 10px 12px;
            cursor: pointer;
            font-weight: 800;
            line-height: 1;
        }

        /* Hidden but used by JS chart scripts */
        .rangeselect {
            display:none;
        }

        .chartwrap {
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 14px;
            margin: 0 0 14px;
            background: var(--card);
        }

        .charttitle {
            display:flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 12px;
            margin-bottom: 8px;
            font-weight: 800;
        }

        .legend { color: var(--muted); font-size: 13px; font-weight: 700; }
        canvas { width: 100%; height: 220px; display: block; }

        .entry {
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 14px;
            margin: 12px 0;
            background: var(--card);
        }

        .entry-head {
            display:flex;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 10px;
            font-weight: 650;
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

        table.core tr:first-child th, table.core tr:first-child td { border-top: none; }

        table.core th {
            width: 140px;
            color: inherit;
            background: var(--panel);
            font-weight: 800;
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

            <p class="links">
                <a href="/api/live">/api/live</a>
                <a href="/api/health">/api/health</a>
            </p>
        </div>
        <!-- Button is rendered in charts header too; but keeping topbar clean. -->
    </div>

    ${serverTimeLine}
    ${deviceBox}

    ${chartsHtml}

    <h3 style="margin-top: 18px; margin-bottom: 8px;">Latest 10 telemetry readings</h3>
    ${latestRows && latestRows.length ? latestEntriesHtml : `<p class="muted">No telemetry readings yet.</p>`}

    <div class="footerline">
        DB stores UTC; page formats times using <b>${esc(tz)}</b> (from users_tb.time_zone).
    </div>

    <!-- Theme toggle -->
    <script>
        (function () {
            function applyTheme(t) {
                document.documentElement.setAttribute("data-theme", t);
            }
            const saved = localStorage.getItem("airbuddy_theme");
            if (saved === "dark" || saved === "light") applyTheme(saved);

            const btn = document.getElementById("modeToggle");
            if (!btn) return;

            btn.addEventListener("click", function () {
                const cur = document.documentElement.getAttribute("data-theme") || "light";
                const next = cur === "dark" ? "light" : "dark";
                applyTheme(next);
                localStorage.setItem("airbuddy_theme", next);
            });
        })();
    </script>

    <!-- Charts -->
    <script src="/static/chart_core.js"></script>
    <script src="/static/temps.js"></script>
    <script src="/static/humidity.js"></script>
    <script src="/static/co2.js"></script>
    <script src="/static/tvoc.js"></script>
    <script nonce="${esc(res.locals.cspNonce)}"> ... </script>
    <!-- Keep hidden selector in sync with GET dropdown -->
    <script>
        (function () {
            const formSel = document.getElementById("range");
            const chartSel = document.getElementById("range-select");
            if (!formSel || !chartSel) return;
            chartSel.value = formSel.value;
            formSel.addEventListener("change", function () {
                chartSel.value = formSel.value;
                // Let scripts react via change event
                chartSel.dispatchEvent(new Event("change"));
            });
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

    return router;
}