// src/routes/device.js
import express from "express";

// -------------------------------------------------
// Timezone helper: current offset minutes for an IANA zone
//   - Returns minutes east of UTC (e.g. Asia/Jakarta = +420)
//   - Safe fallback to 0 if Intl/timeZone not available or invalid
// -------------------------------------------------
function tzOffsetMinNow(ianaZone) {
    try {
        const now = new Date();
        router.get("/device", async (req, res) => {
        const fmtParts = (tz) =>
            new Intl.DateTimeFormat("en-US", {
                timeZone: tz,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            }).formatToParts(now);

        const toMap = (parts) => {
            const m = {};
            for (const p of parts) {
                if (p.type !== "literal") m[p.type] = p.value;
            }
            return m;
        };

        const u = toMap(fmtParts("Etc/UTC"));
        const t = toMap(fmtParts(ianaZone));

        const utcWall = Date.UTC(
            +u.year,
            +u.month - 1,
            +u.day,
            +u.hour,
            +u.minute,
            +u.second
        );

        const tzWallAsUTC = Date.UTC(
            +t.year,
            +t.month - 1,
            +t.day,
            +t.hour,
            +t.minute,
            +t.second
        );

        return Math.round((tzWallAsUTC - utcWall) / 60000);
    } catch (e) {
        return 0;
    }
}

export function deviceRouter(pool) {
    const router = express.Router();

    router.get("/v1/device", async (req, res) => {
        const deviceId = req.device.device_id;
        const compact = String(req.query.compact || "").trim() === "1";

        const conn = await pool.getConnection();
        try {
            const [rows] = await conn.query(
                `
                    SELECT
                        d.device_uid,
                        d.device_name,
                        d.device_type,
                        d.firmware_version,
                        d.status,
                        d.last_seen_at,
                        d.created_at,

                        d.home_id,
                        d.room_id,
                        d.claimed_by_user_id,

                        h.home_name,
                        r.room_name,

                        u.user_id AS claimed_user_id,
                        u.buwana_id AS claimed_buwana_id,
                        u.full_name AS claimed_full_name,
                        u.time_zone AS user_time_zone

                    FROM devices_tb d
                             LEFT JOIN homes_tb h ON h.home_id = d.home_id
                             LEFT JOIN rooms_tb r ON r.room_id = d.room_id
                             LEFT JOIN users_tb u ON u.user_id = d.claimed_by_user_id
                    WHERE d.device_id = ?
                        LIMIT 1
                `,
                [deviceId]
            );

            if (!rows.length) {
                return res.status(404).json({ ok: false, error: "device_not_found" });
            }

            const row = rows[0];

            const userTimeZone =
                typeof row.user_time_zone === "string" && row.user_time_zone.length
                    ? row.user_time_zone
                    : "Etc/UTC";

            const tz_offset_min = tzOffsetMinNow(userTimeZone);

            await conn.query(
                "UPDATE devices_tb SET last_seen_at = UTC_TIMESTAMP() WHERE device_id = ?",
                [deviceId]
            );

            res.set("Cache-Control", "no-store");

            if (compact) {
                return res.status(200).json({
                    ok: true,

                    device: {
                        device_uid: row.device_uid,
                        device_name: row.device_name ?? null,
                        firmware_version: row.firmware_version ?? null,
                    },

                    assignment: {
                        home: row.home_id
                            ? {
                                home_id: row.home_id,
                                home_name: row.home_name ?? null,
                            }
                            : null,

                        room: row.room_id
                            ? {
                                room_id: row.room_id,
                                room_name: row.room_name ?? null,
                            }
                            : null,

                        user: row.claimed_user_id
                            ? {
                                user_id: row.claimed_user_id,
                                buwana_id: row.claimed_buwana_id ?? null,
                                full_name: row.claimed_full_name ?? null,
                                time_zone: userTimeZone,
                            }
                            : null,
                    },

                    time_zone: userTimeZone,
                    tz_offset_min,
                    timezone_offset_min: tz_offset_min,
                    ts: Date.now(),
                });
            }

            return res.status(200).json({
                ok: true,

                device: {
                    device_uid: row.device_uid,
                    device_name: row.device_name ?? null,
                    device_type: row.device_type,
                    firmware_version: row.firmware_version ?? null,
                    status: row.status,
                    last_seen_at: row.last_seen_at,
                    created_at: row.created_at,
                },

                assignment: {
                    user: row.claimed_user_id
                        ? {
                            user_id: row.claimed_user_id,
                            buwana_id: row.claimed_buwana_id ?? null,
                            full_name: row.claimed_full_name ?? null,
                            time_zone: userTimeZone,
                        }
                        : null,

                    home: row.home_id
                        ? {
                            home_id: row.home_id,
                            home_name: row.home_name ?? null,
                        }
                        : null,

                    room: row.room_id
                        ? {
                            room_id: row.room_id,
                            room_name: row.room_name ?? null,
                        }
                        : null,
                },

                time_zone: userTimeZone,
                tz_offset_min,
                timezone_offset_min: tz_offset_min,
                ts: Date.now(),
            });
        } catch (e) {
            console.error("GET /v1/device error:", e?.code || e?.message || e);
            return res.status(500).json({ ok: false, error: "server_error" });
        } finally {
            conn.release();
        }
    });

    return router;
}