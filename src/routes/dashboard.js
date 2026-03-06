// src/routes/dashboard.js
import express from "express";
import crypto from "crypto";

function sha256Hex(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

async function getCurrentUserRow(pool, sessionUser) {
    if (!sessionUser?.buwana_sub) return null;

    const [rows] = await pool.query(
        `
    SELECT user_id, buwana_sub, buwana_id, email, full_name
    FROM users_tb
    WHERE buwana_sub = ?
    LIMIT 1
    `,
        [sessionUser.buwana_sub]
    );

    return rows[0] || null;
}

export function dashboardRouter(pool) {
    const router = express.Router();

    // ------------------------------------------------------------
    // GET /api/me
    // Convenience alias for frontend
    // ------------------------------------------------------------
    router.get("/me", async (req, res) => {
        const u = req.session?.user;
        if (!u) {
            return res.status(401).json({ ok: false, error: "unauthorized" });
        }

        return res.json({ ok: true, user: u });
    });

    // ------------------------------------------------------------
    // GET /api/dashboard/bootstrap
    // Return homes and rooms for the logged-in user
    // ------------------------------------------------------------
    router.get("/dashboard/bootstrap", async (req, res) => {
        try {
            const sessionUser = req.session?.user;
            const user = await getCurrentUserRow(pool, sessionUser);

            if (!user) {
                return res.status(404).json({
                    ok: false,
                    error: "user_not_found",
                    message: "Logged-in user does not exist in users_tb.",
                });
            }

            const [homes] = await pool.query(
                `
        SELECT
          h.home_id,
          h.home_name,
          h.time_zone,
          h.privacy_level,
          hm.role
        FROM home_memberships_tb hm
        INNER JOIN homes_tb h
          ON h.home_id = hm.home_id
        WHERE hm.user_id = ?
        ORDER BY h.created_at ASC, h.home_id ASC
        `,
                [user.user_id]
            );

            const homeIds = homes.map((h) => h.home_id);

            let rooms = [];
            if (homeIds.length > 0) {
                const [roomRows] = await pool.query(
                    `
          SELECT
            room_id,
            home_id,
            room_name,
            floor,
            notes
          FROM rooms_tb
          WHERE home_id IN (?)
          ORDER BY created_at ASC, room_id ASC
          `,
                    [homeIds]
                );
                rooms = roomRows;
            }

            const homesWithRooms = homes.map((home) => ({
                ...home,
                rooms: rooms.filter((r) => r.home_id === home.home_id),
            }));

            return res.json({
                ok: true,
                user: {
                    user_id: user.user_id,
                    buwana_sub: user.buwana_sub,
                    buwana_id: user.buwana_id,
                    email: user.email,
                    full_name: user.full_name,
                },
                homes: homesWithRooms,
            });
        } catch (e) {
            console.error("dashboard bootstrap error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not load dashboard bootstrap data.",
            });
        }
    });

    // ------------------------------------------------------------
    // POST /api/devices/register
    // Create home/room if needed, then create device + hashed key
    // ------------------------------------------------------------
    router.post("/devices/register", async (req, res) => {
        const {
            device_uid,
            device_name,
            device_key,
            home_mode,
            home_id,
            new_home_name,
            room_mode,
            room_id,
            new_room_name,
        } = req.body || {};

        if (!device_uid || !String(device_uid).trim()) {
            return res.status(400).json({
                ok: false,
                error: "missing_device_uid",
                message: "Device UID is required.",
            });
        }

        if (!device_key || !String(device_key).trim()) {
            return res.status(400).json({
                ok: false,
                error: "missing_device_key",
                message: "Device key is required.",
            });
        }

        if (!home_mode || !["existing", "new"].includes(home_mode)) {
            return res.status(400).json({
                ok: false,
                error: "invalid_home_mode",
                message: "home_mode must be 'existing' or 'new'.",
            });
        }

        if (!room_mode || !["existing", "new"].includes(room_mode)) {
            return res.status(400).json({
                ok: false,
                error: "invalid_room_mode",
                message: "room_mode must be 'existing' or 'new'.",
            });
        }

        const trimmedDeviceUid = String(device_uid).trim();
        const trimmedDeviceName = device_name ? String(device_name).trim() : null;
        const trimmedDeviceKey = String(device_key).trim();
        const trimmedNewHomeName = new_home_name ? String(new_home_name).trim() : "";
        const trimmedNewRoomName = new_room_name ? String(new_room_name).trim() : "";

        if (home_mode === "new" && !trimmedNewHomeName) {
            return res.status(400).json({
                ok: false,
                error: "missing_new_home_name",
                message: "New home name is required.",
            });
        }

        if (room_mode === "new" && !trimmedNewRoomName) {
            return res.status(400).json({
                ok: false,
                error: "missing_new_room_name",
                message: "New room name is required.",
            });
        }

        const sessionUser = req.session?.user;
        const conn = await pool.getConnection();

        try {
            await conn.beginTransaction();

            const user = await getCurrentUserRow(conn, sessionUser);

            if (!user) {
                await conn.rollback();
                return res.status(404).json({
                    ok: false,
                    error: "user_not_found",
                    message: "Logged-in user does not exist in users_tb.",
                });
            }

            let resolvedHomeId = null;

            // --------------------------------------------------------
            // Resolve home
            // --------------------------------------------------------
            if (home_mode === "existing") {
                if (!home_id) {
                    await conn.rollback();
                    return res.status(400).json({
                        ok: false,
                        error: "missing_home_id",
                        message: "Please choose an existing home.",
                    });
                }

                const [homeRows] = await conn.query(
                    `
          SELECT h.home_id
          FROM home_memberships_tb hm
          INNER JOIN homes_tb h
            ON h.home_id = hm.home_id
          WHERE hm.user_id = ?
            AND h.home_id = ?
          LIMIT 1
          `,
                    [user.user_id, Number(home_id)]
                );

                if (!homeRows.length) {
                    await conn.rollback();
                    return res.status(403).json({
                        ok: false,
                        error: "home_access_denied",
                        message: "You do not have access to that home.",
                    });
                }

                resolvedHomeId = homeRows[0].home_id;
            } else {
                const [homeInsert] = await conn.query(
                    `
          INSERT INTO homes_tb (
            owner_user_id,
            home_name,
            privacy_level,
            created_at
          )
          VALUES (?, ?, 'private', NOW())
          `,
                    [user.user_id, trimmedNewHomeName]
                );

                resolvedHomeId = homeInsert.insertId;

                await conn.query(
                    `
          INSERT INTO home_memberships_tb (
            home_id,
            user_id,
            role,
            created_at
          )
          VALUES (?, ?, 'owner', NOW())
          `,
                    [resolvedHomeId, user.user_id]
                );
            }

            let resolvedRoomId = null;

            // --------------------------------------------------------
            // Resolve room
            // --------------------------------------------------------
            if (room_mode === "existing") {
                if (!room_id) {
                    await conn.rollback();
                    return res.status(400).json({
                        ok: false,
                        error: "missing_room_id",
                        message: "Please choose an existing room.",
                    });
                }

                const [roomRows] = await conn.query(
                    `
          SELECT room_id, home_id
          FROM rooms_tb
          WHERE room_id = ?
            AND home_id = ?
          LIMIT 1
          `,
                    [Number(room_id), resolvedHomeId]
                );

                if (!roomRows.length) {
                    await conn.rollback();
                    return res.status(400).json({
                        ok: false,
                        error: "invalid_room_for_home",
                        message: "That room does not belong to the selected home.",
                    });
                }

                resolvedRoomId = roomRows[0].room_id;
            } else {
                const [roomInsert] = await conn.query(
                    `
          INSERT INTO rooms_tb (
            home_id,
            room_name,
            created_at
          )
          VALUES (?, ?, NOW())
          `,
                    [resolvedHomeId, trimmedNewRoomName]
                );

                resolvedRoomId = roomInsert.insertId;
            }

            // --------------------------------------------------------
            // Create device
            // --------------------------------------------------------
            const [deviceInsert] = await conn.query(
                `
        INSERT INTO devices_tb (
          device_uid,
          home_id,
          room_id,
          claimed_by_user_id,
          device_name,
          device_type,
          status,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, 'pico_w', 'active', NOW())
        `,
                [
                    trimmedDeviceUid,
                    resolvedHomeId,
                    resolvedRoomId,
                    user.user_id,
                    trimmedDeviceName || trimmedDeviceUid,
                ]
            );

            const deviceId = deviceInsert.insertId;
            const keyHash = sha256Hex(trimmedDeviceKey);

            // --------------------------------------------------------
            // Store hashed device key
            // --------------------------------------------------------
            await conn.query(
                `
        INSERT INTO device_keys_tb (
          device_id,
          key_hash,
          label,
          created_at
        )
        VALUES (?, ?, 'default', NOW())
        `,
                [deviceId, keyHash]
            );

            await conn.commit();

            return res.json({
                ok: true,
                message: "Device added successfully.",
                device: {
                    device_id: deviceId,
                    device_uid: trimmedDeviceUid,
                    home_id: resolvedHomeId,
                    room_id: resolvedRoomId,
                },
            });
        } catch (e) {
            try {
                await conn.rollback();
            } catch {}

            if (e?.code === "ER_DUP_ENTRY") {
                const msg = String(e?.sqlMessage || e?.message || "");

                if (msg.includes("uniq_devices_uid")) {
                    return res.status(409).json({
                        ok: false,
                        error: "duplicate_device_uid",
                        message: "That device UID is already registered.",
                    });
                }

                if (msg.includes("uniq_key_hash")) {
                    return res.status(409).json({
                        ok: false,
                        error: "duplicate_device_key",
                        message: "That device key is already in use.",
                    });
                }

                if (msg.includes("uniq_rooms_home_name")) {
                    return res.status(409).json({
                        ok: false,
                        error: "duplicate_room_name",
                        message: "That room name already exists in this home.",
                    });
                }
            }

            console.error("device register error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not register device.",
            });
        } finally {
            conn.release();
        }
    });

    return router;
}