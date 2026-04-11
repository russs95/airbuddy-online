// src/routes/dashboard.js
import express from "express";
import crypto from "crypto";

function sha256Hex(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function generateDeviceKey(bytes = 18) {
    return crypto.randomBytes(bytes).toString("base64url");
}

function parseJsonField(value, fallback = null) {
    if (value == null) return fallback;
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value;
}

async function getCurrentUserRow(db, sessionUser) {
    if (!sessionUser?.buwana_sub) return null;

    const [rows] = await db.query(
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

async function getAccessibleDeviceRow(db, userId, deviceUid) {
    const [rows] = await db.query(
        `
            SELECT
                d.device_id,
                d.device_uid,
                d.device_name,
                d.home_id,
                d.room_id,
                r.room_name,
                h.home_name
            FROM devices_tb d
                     INNER JOIN homes_tb h
                                ON h.home_id = d.home_id
                     INNER JOIN home_memberships_tb hm
                                ON hm.home_id = h.home_id
                     LEFT JOIN rooms_tb r
                               ON r.room_id = d.room_id
            WHERE hm.user_id = ?
              AND d.device_uid = ?
                LIMIT 1
        `,
        [userId, deviceUid]
    );

    return rows[0] || null;
}

async function getAccessibleDeviceById(db, userId, deviceId) {
    const [rows] = await db.query(
        `
            SELECT
                d.device_id,
                d.device_uid,
                d.device_name,
                d.home_id,
                d.room_id,
                r.room_name,
                h.home_name
            FROM devices_tb d
                     INNER JOIN homes_tb h
                                ON h.home_id = d.home_id
                     INNER JOIN home_memberships_tb hm
                                ON hm.home_id = h.home_id
                     LEFT JOIN rooms_tb r
                               ON r.room_id = d.room_id
            WHERE hm.user_id = ?
              AND d.device_id = ?
                LIMIT 1
        `,
        [userId, Number(deviceId)]
    );

    return rows[0] || null;
}

export function dashboardRouter(pool) {
    const router = express.Router();

    // ------------------------------------------------------------
    // GET /api/dashboard/devices
    // list devices accessible to current user
    // ------------------------------------------------------------
    router.get("/dashboard/devices", async (req, res) => {
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

            const [rows] = await pool.query(
                `
                SELECT
                    d.device_id,
                    d.device_uid,
                    d.device_name,
                    d.device_type,
                    d.status,
                    d.last_seen_at,
                    d.created_at,
                    d.home_id,
                    d.room_id,
                    h.home_name,
                    r.room_name
                FROM devices_tb d
                INNER JOIN homes_tb h
                    ON h.home_id = d.home_id
                INNER JOIN home_memberships_tb hm
                    ON hm.home_id = h.home_id
                LEFT JOIN rooms_tb r
                    ON r.room_id = d.room_id
                WHERE hm.user_id = ?
                ORDER BY d.created_at ASC, d.device_id ASC
                `,
                [user.user_id]
            );

            return res.json({
                ok: true,
                devices: rows,
            });
        } catch (e) {
            console.error("dashboard devices error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not load devices.",
            });
        }
    });

    // ------------------------------------------------------------
    // GET /api/dashboard/bootstrap
    // homes -> rooms -> devices
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
            let devices = [];

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

                const [deviceRows] = await pool.query(
                    `
                    SELECT
                        device_id,
                        device_uid,
                        home_id,
                        room_id,
                        device_name,
                        device_type,
                        firmware_version,
                        status,
                        last_seen_at,
                        created_at
                    FROM devices_tb
                    WHERE home_id IN (?)
                    ORDER BY created_at ASC, device_id ASC
                    `,
                    [homeIds]
                );
                devices = deviceRows;
            }

            const homesWithRooms = homes.map((home) => {
                const homeRooms = rooms
                    .filter((r) => r.home_id === home.home_id)
                    .map((room) => ({
                        ...room,
                        devices: devices.filter((d) => d.room_id === room.room_id),
                    }));

                const unassignedDevices = devices.filter(
                    (d) =>
                        d.home_id === home.home_id &&
                        (d.room_id === null || d.room_id === undefined)
                );

                return {
                    ...home,
                    rooms: homeRooms,
                    unassigned_devices: unassignedDevices,
                };
            });

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
    // Create home/room if needed, then create device + generated key
    // ------------------------------------------------------------
    router.post("/devices/register", async (req, res) => {
        const {
            device_uid,
            device_name,
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

            const [existingDeviceRows] = await conn.query(
                `
                SELECT device_id
                FROM devices_tb
                WHERE device_uid = ?
                LIMIT 1
                `,
                [trimmedDeviceUid]
            );

            if (existingDeviceRows.length) {
                await conn.rollback();
                return res.status(409).json({
                    ok: false,
                    error: "duplicate_device_uid",
                    message: "That device UID is already registered.",
                });
            }

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
            const plainDeviceKey = generateDeviceKey();
            const keyHash = sha256Hex(plainDeviceKey);

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
                device_key: plainDeviceKey,
            });
        } catch (e) {
            try {
                await conn.rollback();
            } catch {}

            if (e?.code === "ER_DUP_ENTRY") {
                const msg = String(e?.sqlMessage || e?.message || "");

                if (msg.includes("device_uid") || msg.includes("uniq_devices_uid")) {
                    return res.status(409).json({
                        ok: false,
                        error: "duplicate_device_uid",
                        message: "That device UID is already registered.",
                    });
                }

                if (msg.includes("key_hash") || msg.includes("uniq_key_hash")) {
                    return res.status(409).json({
                        ok: false,
                        error: "duplicate_device_key",
                        message: "That device key is already in use.",
                    });
                }

                if (msg.includes("room_name") || msg.includes("uniq_rooms_home_name")) {
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

    // ------------------------------------------------------------
    // POST /api/devices/:deviceId/reset-key
    // revoke old active keys, create a new key, return it once
    // ------------------------------------------------------------
    router.post("/devices/:deviceId/reset-key", async (req, res) => {
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

            const deviceId = Number(req.params.deviceId);
            if (!deviceId) {
                await conn.rollback();
                return res.status(400).json({
                    ok: false,
                    error: "invalid_device_id",
                    message: "Valid deviceId is required.",
                });
            }

            const device = await getAccessibleDeviceById(conn, user.user_id, deviceId);
            if (!device) {
                await conn.rollback();
                return res.status(404).json({
                    ok: false,
                    error: "device_not_found",
                    message: "Device not found or not accessible.",
                });
            }

            await conn.query(
                `
                UPDATE device_keys_tb
                SET revoked_at = NOW()
                WHERE device_id = ?
                  AND revoked_at IS NULL
                `,
                [device.device_id]
            );

            const plainDeviceKey = generateDeviceKey();
            const keyHash = sha256Hex(plainDeviceKey);

            await conn.query(
                `
                INSERT INTO device_keys_tb (
                    device_id,
                    key_hash,
                    label,
                    created_at
                )
                VALUES (?, ?, 'reset', NOW())
                `,
                [device.device_id, keyHash]
            );

            await conn.commit();

            return res.json({
                ok: true,
                message: "Device key reset successfully.",
                device: {
                    device_id: device.device_id,
                    device_uid: device.device_uid,
                    device_name: device.device_name,
                },
                device_key: plainDeviceKey,
            });
        } catch (e) {
            try {
                await conn.rollback();
            } catch {}

            if (e?.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    ok: false,
                    error: "duplicate_device_key",
                    message: "Could not generate a unique device key. Please try again.",
                });
            }

            console.error("device key reset error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not reset device key.",
            });
        } finally {
            conn.release();
        }
    });

    // ------------------------------------------------------------
    // GET /api/dashboard/device-live?device_uid=AB-0001
    // latest telemetry for one accessible device
    // ------------------------------------------------------------
    router.get("/dashboard/device-live", async (req, res) => {
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

            const deviceUid = String(req.query.device_uid || "").trim();
            if (!deviceUid) {
                return res.status(400).json({
                    ok: false,
                    error: "missing_device_uid",
                    message: "device_uid is required.",
                });
            }

            const device = await getAccessibleDeviceRow(pool, user.user_id, deviceUid);
            if (!device) {
                return res.status(404).json({
                    ok: false,
                    error: "device_not_found",
                    message: "Device not found or not accessible.",
                });
            }

            const [rows] = await pool.query(
                `
                SELECT
                    recorded_at,
                    received_at,
                    values_json,
                    confidence_json,
                    flags_json
                FROM telemetry_readings_tb
                WHERE device_id = ?
                ORDER BY recorded_at DESC
                LIMIT 1
                `,
                [device.device_id]
            );

            if (!rows.length) {
                return res.json({
                    ok: true,
                    device_uid: device.device_uid,
                    device_name: device.device_name,
                    room_name: device.room_name,
                    home_name: device.home_name,
                    recorded_at: null,
                    received_at: null,
                    ens_eco2: null,
                    ens_tvoc: null,
                    ens_aqi: null,
                    aht_temp: null,
                    aht_humidity: null,
                    rtc_temp: null,
                    scd_co2: null,
                    scd_temp: null,
                    scd_humidity: null,
                    confidence: null,
                    flags: null,
                });
            }

            const row = rows[0];
            const values = parseJsonField(row.values_json, {});
            const confidence = parseJsonField(row.confidence_json, null);
            const flags = parseJsonField(row.flags_json, null);

            return res.json({
                ok: true,
                device_uid: device.device_uid,
                device_name: device.device_name,
                room_name: device.room_name,
                home_name: device.home_name,
                recorded_at: row.recorded_at,
                received_at: row.received_at,
                eco2_ppm: values.eco2_ppm ?? null,
                temp_c: values.temp_c ?? null,
                rtc_temp_c: values.rtc_temp_c ?? null,
                rh_pct: values.rh_pct ?? null,
                aqi: values.aqi ?? null,
                tvoc_ppb: values.tvoc_ppb ?? null,
                confidence,
                flags,
            });
        } catch (e) {
            console.error("device live error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not load latest telemetry.",
            });
        }
    });

    // ------------------------------------------------------------
    // GET /api/dashboard/device-trends?device_uid=AB-0001&hours=24
    // trends for one accessible device
    // ------------------------------------------------------------
    router.get("/dashboard/device-trends", async (req, res) => {
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

            const deviceUid = String(req.query.device_uid || "").trim();
            if (!deviceUid) {
                return res.status(400).json({
                    ok: false,
                    error: "missing_device_uid",
                    message: "device_uid is required.",
                });
            }

            const hours = Math.max(1, Math.min(24 * 30, Number(req.query.hours) || 24));

            const device = await getAccessibleDeviceRow(pool, user.user_id, deviceUid);
            if (!device) {
                return res.status(404).json({
                    ok: false,
                    error: "device_not_found",
                    message: "Device not found or not accessible.",
                });
            }

            const [rows] = await pool.query(
                `
                    SELECT
                        UNIX_TIMESTAMP(recorded_at) AS ts,
                        CAST(JSON_EXTRACT(values_json, '$.eco2_ppm') AS DOUBLE) AS eco2,
                        CAST(JSON_EXTRACT(values_json, '$.temp_c') AS DOUBLE) AS temp,
                        CAST(JSON_EXTRACT(values_json, '$.rtc_temp_c') AS DOUBLE) AS rtc_temp,
                        CAST(JSON_EXTRACT(values_json, '$.rh_pct') AS DOUBLE) AS rh,
                        CAST(JSON_EXTRACT(values_json, '$.tvoc_ppb') AS DOUBLE) AS tvoc
                    FROM telemetry_readings_tb
                    WHERE device_id = ?
                      AND recorded_at >= UTC_TIMESTAMP() - INTERVAL ? HOUR
                    ORDER BY recorded_at ASC
                `,
                [device.device_id, hours]
            );

            const timestamps = [];
            const eco2s = [];
            const temps = [];
            const rtcTemps = [];
            const rhs = [];
            const tvocs = [];

            for (const r of rows) {
                timestamps.push(r.ts == null ? null : Number(r.ts));
                eco2s.push(r.eco2 == null ? null : Number(r.eco2));
                temps.push(r.temp == null ? null : Number(r.temp));
                rtcTemps.push(r.rtc_temp == null ? null : Number(r.rtc_temp));
                rhs.push(r.rh == null ? null : Number(r.rh));
                tvocs.push(r.tvoc == null ? null : Number(r.tvoc));
            }

            return res.json({
                ok: true,
                device_uid: device.device_uid,
                device_name: device.device_name,
                room_name: device.room_name,
                home_name: device.home_name,
                hours,
                timestamps,
                eco2s,
                temps,
                rtcTemps,
                rhs,
                tvocs,
            });
        } catch (e) {
            console.error("device trends error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not load trend data.",
            });
        }
    });

    return router;
}