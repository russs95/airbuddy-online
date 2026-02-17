import express from "express";

export function deviceRouter(pool) {
    const router = express.Router();

    router.get("/v1/device", async (req, res) => {
        const deviceId = req.device.device_id;

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
          h.time_zone AS home_time_zone,
          h.privacy_level,
          h.owner_buwana_id,

          r.room_name,
          r.floor,
          r.notes AS room_notes,

          u.full_name AS claimed_full_name,
          u.email AS claimed_email,
          u.time_zone AS user_time_zone,
          u.community_id AS user_community_id,

          c.com_name,
          c.com_country,
          c.com_type,
          c.com_lang,
          c.com_status

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

            // liveness ping
            await conn.query(
                "UPDATE devices_tb SET last_seen_at = NOW() WHERE device_id = ?",
                [deviceId]
            );

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
                            email: row.claimed_email ?? null,
                            time_zone: row.user_time_zone ?? null,
                        }
                        : null,

                    home: row.home_id
                        ? {
                            home_id: row.home_id,
                            home_name: row.home_name ?? null,
                            time_zone: row.home_time_zone ?? null,
                            privacy_level: row.privacy_level ?? null,
                            owner_buwana_id: row.owner_buwana_id ?? null,
                        }
                        : null,

                    room: row.room_id
                        ? {
                            room_id: row.room_id,
                            room_name: row.room_name ?? null,
                            floor: row.floor ?? null,
                            notes: row.room_notes ?? null,
                        }
                        : null,

                    community: row.user_community_id
                        ? {
                            community_id: row.user_community_id,
                            com_name: row.com_name ?? null,
                            com_country: row.com_country ?? null,
                            com_type: row.com_type ?? null,
                            com_lang: row.com_lang ?? null,
                            com_status: row.com_status ?? null,
                        }
                        : null,
                },
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
