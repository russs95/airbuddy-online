// src/routes/device.js
import express from "express";

export function deviceRouter(pool) {
    const router = express.Router();

    router.get("/v1/device", async (req, res) => {
        const deviceId = req.device.device_id;

        // Pico-friendly mode (smaller JSON, fewer fields)
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
                    d.claimed_by_buwana_id,

                    h.home_name,
                    r.room_name,

                    u.full_name AS claimed_full_name,
                    u.community_id AS user_community_id,
                    u.time_zone AS user_time_zone,

                    c.com_name

                FROM devices_tb d
                    LEFT JOIN homes_tb h ON h.home_id = d.home_id
                    LEFT JOIN rooms_tb r ON r.room_id = d.room_id
                    LEFT JOIN users_tb u ON u.buwana_id = d.claimed_by_buwana_id
                    LEFT JOIN communities_tb c ON c.community_id = u.community_id
                WHERE d.device_id = ?
                LIMIT 1
                `,
                [deviceId]
            );

            if (!rows.length) {
                return res.status(404).json({ ok: false, error: "device_not_found" });
            }

            const row = rows[0];

            // Normalize timezone (always give device something sane)
            const userTimeZone =
                typeof row.user_time_zone === "string" && row.user_time_zone.length
                    ? row.user_time_zone
                    : "Etc/UTC";

            // liveness ping
            await conn.query(
                "UPDATE devices_tb SET last_seen_at = NOW() WHERE device_id = ?",
                [deviceId]
            );

            // Avoid caching
            res.set("Cache-Control", "no-store");

            // -------------------------------------------------
            // Compact response (Pico boot)
            // -------------------------------------------------
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

                        community: row.user_community_id
                            ? {
                                community_id: row.user_community_id,
                                com_name: row.com_name ?? null,
                            }
                            : null,

                        user: row.claimed_by_buwana_id
                            ? {
                                buwana_id: row.claimed_by_buwana_id,
                                full_name: row.claimed_full_name ?? null,
                                time_zone: userTimeZone,   // ✅ NEW
                            }
                            : null,
                    },

                    time_zone: userTimeZone,  // ✅ flat shortcut for Pico
                    ts: Date.now(),
                });
            }

            // -------------------------------------------------
            // Full response
            // -------------------------------------------------
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
                    user: row.claimed_by_buwana_id
                        ? {
                            buwana_id: row.claimed_by_buwana_id,
                            full_name: row.claimed_full_name ?? null,
                            time_zone: userTimeZone,  // ✅ NEW
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

                    community: row.user_community_id
                        ? {
                            community_id: row.user_community_id,
                            com_name: row.com_name ?? null,
                        }
                        : null,
                },

                time_zone: userTimeZone,  // ✅ NEW (top-level convenience)
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