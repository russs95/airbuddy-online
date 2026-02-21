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

function makeFormatters(timeZone) {
    const tz = timeZone || "Etc/UTC";

    const fmtLong = (d) => {
        if (!d) return "";
        const dt = d instanceof Date ? d : new Date(d);
        if (Number.isNaN(dt.getTime())) return String(d);

        return new Intl.DateTimeFormat("en-GB", {
            timeZone: tz,
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).format(dt);
    };

    return { tz, fmtLong };
}

// ------------------------
// Device Summary (extended)
// ------------------------
async function fetchDeviceSummary(pool, deviceId = 1) {
    const sql = `
        SELECT
            d.device_id,
            d.device_name,
            d.device_type,
            d.firmware_version,
            d.status,
            d.last_seen_at,
            d.created_at,

            h.home_name,
            r.room_name

        FROM devices_tb d
        LEFT JOIN homes_tb h ON h.home_id = d.home_id
        LEFT JOIN rooms_tb r ON r.room_id = d.room_id
        WHERE d.device_id = ?
        LIMIT 1
    `;
    const [rows] = await pool.query(sql, [deviceId]);
    return rows?.[0] ?? null;
}

// ------------------------
// Landing Router
// ------------------------
export function landingRouter(pool) {
    const router = express.Router();

    router.get("/", async (req, res) => {
        try {
            const deviceId = 1;

            const device = await fetchDeviceSummary(pool, deviceId);

            const [rows] = await pool.query(
                `
                SELECT recorded_at, values_json
                FROM telemetry_readings_tb
                WHERE device_id = ?
                ORDER BY recorded_at ASC
                `,
                [deviceId]
            );

            // --- Build chart arrays ---
            const timestamps = [];
            const temps = [];

            for (const r of rows) {
                if (!r.recorded_at) continue;

                const ts = Math.floor(new Date(r.recorded_at).getTime() / 1000);
                timestamps.push(ts);

                try {
                    const obj = JSON.parse(r.values_json);
                    temps.push(obj?.temp_c ?? null);
                } catch {
                    temps.push(null);
                }
            }

            // --- Online status (last_seen within 121s) ---
            let online = false;
            if (device?.last_seen_at) {
                const last = new Date(device.last_seen_at).getTime();
                const diffSec = (Date.now() - last) / 1000;
                online = diffSec <= 121;
            }

            const onlineBadge = online
                ? `<span class="online">🟢 online</span>`
                : `<span class="offline">⚫ offline</span>`;

            const deviceBox = device
                ? `
            <details class="devicebox">
                <summary>
                    <b>${esc(device.device_name)}</b>
                    ${onlineBadge}
                </summary>

                <div class="device-details">
                    <div><b>Home:</b> ${esc(device.home_name)}</div>
                    <div><b>Room:</b> ${esc(device.room_name)}</div>
                    <div><b>Device Type:</b> ${esc(device.device_type)}</div>
                    <div><b>Firmware:</b> ${esc(device.firmware_version)}</div>
                    <div><b>Status:</b> ${esc(device.status)}</div>
                    <div><b>Last Seen:</b> ${esc(device.last_seen_at)}</div>
                    <div><b>Created:</b> ${esc(device.created_at)}</div>
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

<link rel="preconnect" href="https://fonts.googleapis.com">
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
    font-weight:600;
    display:flex;
    justify-content:space-between;
    align-items:center;
}

.device-details {
    margin-top:12px;
    font-size:14px;
    color:#444;
}

.online { color: #2e7d32; font-weight:600; }
.offline { color: #999; font-weight:600; }

.chartwrap {
    border:1px solid #e6e6e6;
    border-radius:12px;
    padding:14px;
    background:#fff;
}

canvas { width:100%; height:260px; display:block; }

select {
    padding:8px 10px;
    border-radius:8px;
    margin-bottom:10px;
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