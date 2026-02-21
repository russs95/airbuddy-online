import express from "express";

// ------------------------
// Helpers
// ------------------------
const esc = (s) =>
    String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

function safeJsonParse(v) {
    if (!v) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") {
        try { return JSON.parse(v); } catch { return null; }
    }
    return null;
}

function fmtDate(d) {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

// ------------------------
// Device lookup
// ------------------------
async function fetchDevice(pool, deviceId = 1) {
    const sql = `
        SELECT *
        FROM devices_tb
        WHERE device_id = ?
        LIMIT 1
    `;
    const [rows] = await pool.query(sql, [deviceId]);
    return rows?.[0] ?? null;
}

// ------------------------
// Landing router
// ------------------------
export function landingRouter(pool) {
    const router = express.Router();

    router.get("/", async (req, res) => {
        try {
            const deviceId = 1;

            const device = await fetchDevice(pool, deviceId);

            // --- ALL telemetry for chart ---
            const [allRows] = await pool.query(
                `
                SELECT recorded_at, values_json
                FROM telemetry_readings_tb
                WHERE device_id = ?
                ORDER BY recorded_at ASC
                `,
                [deviceId]
            );

            const timestamps = [];
            const temps = [];

            for (const r of allRows) {
                if (!r.recorded_at) continue;

                const ts = Math.floor(new Date(r.recorded_at).getTime() / 1000);
                timestamps.push(ts);

                const obj = safeJsonParse(r.values_json);
                temps.push(obj?.temp_c ?? null);
            }

            // --- Latest 10 entries (separate query) ---
            const [latestRows] = await pool.query(
                `
                SELECT telemetry_id, recorded_at, received_at, values_json
                FROM telemetry_readings_tb
                WHERE device_id = ?
                ORDER BY recorded_at DESC
                LIMIT 10
                `,
                [deviceId]
            );

            const latestHtml = latestRows.map(r => {
                const obj = safeJsonParse(r.values_json);
                return `
                    <div class="entry">
                        <div><b>Recorded:</b> ${esc(fmtDate(r.recorded_at))}</div>
                        <div><b>Received:</b> ${esc(fmtDate(r.received_at))}</div>
                        <div><b>Temp:</b> ${esc(obj?.temp_c ?? "—")} °C</div>
                        <div><b>Humidity:</b> ${esc(obj?.rh ?? "—")} %</div>
                        <div><b>eCO₂:</b> ${esc(obj?.eco2_ppm ?? "—")} ppm</div>
                    </div>
                `;
            }).join("");

            // --- Online indicator ---
            let online = false;
            if (device?.last_seen_at) {
                const diffSec =
                    (Date.now() - new Date(device.last_seen_at).getTime()) / 1000;
                online = diffSec <= 121;
            }

            const onlineBadge = online
                ? `<span class="online">🟢 online</span>`
                : `<span class="offline">⚫ offline</span>`;

            const deviceBox = device
                ? `
                <details class="devicebox">
                    <summary>
                        <b>${esc(device.device_name ?? "Device 1")}</b>
                        ${onlineBadge}
                    </summary>
                    <div class="device-details">
                        <div><b>Device UID:</b> ${esc(device.device_uid)}</div>
                        <div><b>Device Type:</b> ${esc(device.device_type)}</div>
                        <div><b>Firmware:</b> ${esc(device.firmware_version)}</div>
                        <div><b>Status:</b> ${esc(device.status)}</div>
                        <div><b>Last Seen:</b> ${esc(fmtDate(device.last_seen_at))}</div>
                        <div><b>Created:</b> ${esc(fmtDate(device.created_at))}</div>
                    </div>
                </details>
                `
                : `<div class="devicebox">Device not found</div>`;

            const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>airBuddy | online</title>

<link href="https://fonts.googleapis.com/css2?family=Arvo:wght@700&family=Mulish:wght@400;600&display=swap" rel="stylesheet">

<style>
body { font-family: Mulish, sans-serif; margin: 24px; }
.brand { font-family: Arvo, serif; font-size: 28px; margin-bottom: 4px; }
.sub { color:#666; margin-bottom:20px; }

.devicebox {
    border:1px solid #e6e6e6;
    border-radius:12px;
    padding:14px;
    margin-bottom:20px;
    background:#fff;
}

.devicebox summary {
    cursor:pointer;
    display:flex;
    justify-content:space-between;
    align-items:center;
}

.device-details { margin-top:12px; font-size:14px; }

.online { color:#2e7d32; font-weight:600; }
.offline { color:#999; font-weight:600; }

.chartwrap {
    border:1px solid #e6e6e6;
    border-radius:12px;
    padding:14px;
    background:#fff;
    margin-bottom:20px;
}

canvas { width:100%; height:260px; display:block; }

.entry {
    border:1px solid #e6e6e6;
    border-radius:12px;
    padding:12px;
    margin-bottom:10px;
    background:#fff;
}
</style>
</head>

<body>

<div class="brand">airBuddy | online</div>
<div class="sub">The airBuddy project beta server.</div>

${deviceBox}

<div class="chartwrap">
    <select id="range-select">
        <option value="6h">Last 6 hours</option>
        <option value="24h" selected>Last 24 hours</option>
        <option value="72h">Last 72 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
    </select>

    <canvas
        id="trend-temp"
        data-timestamps='${esc(JSON.stringify(timestamps))}'
        data-temps='${esc(JSON.stringify(temps))}'
    ></canvas>
</div>

<h3>Latest 10 Telemetry Readings</h3>
${latestHtml || "<p>No telemetry yet.</p>"}

<script src="/static/chart.js"></script>

</body>
</html>
`;

            res.status(200).send(html);
        } catch (e) {
            console.error("Landing error:", e);
            res.status(500).send("server_error");
        }
    });

    return router;
}