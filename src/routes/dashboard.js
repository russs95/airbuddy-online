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

async function getAccessibleRoomRow(db, userId, roomId) {
    const [rows] = await db.query(
        `
            SELECT
                r.room_id,
                r.home_id,
                r.room_name,
                r.floor,
                r.notes,
                r.target_temp_c,
                r.target_humidity_pct
            FROM rooms_tb r
                     INNER JOIN homes_tb h
                                ON h.home_id = r.home_id
                     INNER JOIN home_memberships_tb hm
                                ON hm.home_id = h.home_id
            WHERE hm.user_id = ?
              AND r.room_id = ?
                LIMIT 1
        `,
        [userId, Number(roomId)]
    );

    return rows[0] || null;
}

async function getAccessibleHomeRow(db, userId, homeId) {
    const [rows] = await db.query(
        `
            SELECT h.home_id
            FROM home_memberships_tb hm
            INNER JOIN homes_tb h
                ON h.home_id = hm.home_id
            WHERE hm.user_id = ?
              AND h.home_id = ?
            LIMIT 1
        `,
        [userId, Number(homeId)]
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
                        notes,
                        target_temp_c,
                        target_humidity_pct
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
    // GET /api/devices/next-uid
    // Returns the next device UID in the format AB_<userId>_<N+1>
    // where N is the count of devices already claimed by this user.
    // ------------------------------------------------------------
    router.get("/devices/next-uid", async (req, res) => {
        try {
            const sessionUser = req.session?.user;
            const user = await getCurrentUserRow(pool, sessionUser);

            if (!user) {
                return res.status(401).json({
                    ok: false,
                    error: "not_authenticated",
                    message: "You must be logged in.",
                });
            }

            const [rows] = await pool.query(
                "SELECT COUNT(*) AS cnt FROM devices_tb WHERE claimed_by_user_id = ?",
                [user.user_id]
            );
            const count = Number(rows[0]?.cnt) || 0;
            const nextNumber = count + 1;
            const nextUid = `AB_${user.user_id}_${nextNumber}`;

            return res.json({ ok: true, next_device_uid: nextUid, next_device_id: nextNumber });
        } catch (e) {
            console.error("next-uid error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not determine next device UID.",
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
                    lat,
                    lon,
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
                    lat: null,
                    lon: null,
                    last_gps_lat: null,
                    last_gps_lon: null,
                    last_gps_at:  null,
                    ens_eco2: null,
                    ens_tvoc: null,
                    ens_aqi: null,
                    aht_temp: null,
                    aht_humidity: null,
                    bme_temp: null,
                    bme_humidity: null,
                    rtc_temp: null,
                    scd_co2: null,
                    scd_temp: null,
                    scd_humidity: null,
                    ina_bus_v: null,
                    ina_current_ma: null,
                    ina_power_mw: null,
                    ina_batt_pct: null,
                    confidence: null,
                    flags: null,
                });
            }

            const row = rows[0];
            const values = parseJsonField(row.values_json, {});
            const confidence = parseJsonField(row.confidence_json, null);
            const flags = parseJsonField(row.flags_json, null);

            // If the latest reading has no GPS, find the most recent reading that does
            let lastGpsLat = row.lat != null ? Number(row.lat) : null;
            let lastGpsLon = row.lon != null ? Number(row.lon) : null;
            let lastGpsAt  = row.lat != null ? row.recorded_at : null;

            if (lastGpsLat == null) {
                const [gpsRows] = await pool.query(
                    `SELECT lat, lon, recorded_at
                     FROM telemetry_readings_tb
                     WHERE device_id = ? AND lat IS NOT NULL AND lon IS NOT NULL
                     ORDER BY recorded_at DESC
                     LIMIT 1`,
                    [device.device_id]
                );
                if (gpsRows.length) {
                    lastGpsLat = Number(gpsRows[0].lat);
                    lastGpsLon = Number(gpsRows[0].lon);
                    lastGpsAt  = gpsRows[0].recorded_at;
                }
            }

            return res.json({
                ok: true,
                device_uid: device.device_uid,
                device_name: device.device_name,
                room_name: device.room_name,
                home_name: device.home_name,
                recorded_at: row.recorded_at,
                received_at: row.received_at,
                lat: row.lat != null ? Number(row.lat) : null,
                lon: row.lon != null ? Number(row.lon) : null,
                last_gps_lat: lastGpsLat,
                last_gps_lon: lastGpsLon,
                last_gps_at:  lastGpsAt,
                ens_eco2:     values.ens_eco2     ?? null,
                ens_tvoc:     values.ens_tvoc     ?? null,
                ens_aqi:      values.ens_aqi      ?? null,
                aht_temp:     values.aht_temp     ?? null,
                aht_humidity: values.aht_humidity ?? null,
                bme_temp:     values.bme_temp     ?? null,
                bme_humidity: values.bme_humidity ?? null,
                rtc_temp:     values.rtc_temp     ?? null,
                scd_co2:      values.scd_co2      ?? null,
                scd_temp:     values.scd_temp     ?? null,
                scd_humidity: values.scd_humidity ?? null,
                ina_bus_v:      values.ina_bus_v      ?? null,
                ina_current_ma: values.ina_current_ma ?? null,
                ina_power_mw:   values.ina_power_mw   ?? null,
                ina_batt_pct:   values.ina_batt_pct   ?? null,
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

            const hours = Math.max(0.25, Math.min(24 * 30, Number(req.query.hours) || 24));
            const intervalSeconds = Math.round(hours * 3600);

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
                        telemetry_id,
                        UNIX_TIMESTAMP(recorded_at) AS ts,
                        COALESCE(CAST(JSON_EXTRACT(values_json, '$.ens_eco2') AS DOUBLE),
                                 CAST(JSON_EXTRACT(values_json, '$.eco2_ppm') AS DOUBLE)) AS ens_eco2,
                        COALESCE(CAST(JSON_EXTRACT(values_json, '$.aht_temp') AS DOUBLE),
                                 CAST(JSON_EXTRACT(values_json, '$.temp_c') AS DOUBLE))   AS aht_temp,
                        COALESCE(CAST(JSON_EXTRACT(values_json, '$.rtc_temp') AS DOUBLE),
                                 CAST(JSON_EXTRACT(values_json, '$.rtc_temp_c') AS DOUBLE)) AS rtc_temp,
                        COALESCE(CAST(JSON_EXTRACT(values_json, '$.aht_humidity') AS DOUBLE),
                                 CAST(JSON_EXTRACT(values_json, '$.rh_pct') AS DOUBLE))   AS aht_humidity,
                        COALESCE(CAST(JSON_EXTRACT(values_json, '$.ens_tvoc') AS DOUBLE),
                                 CAST(JSON_EXTRACT(values_json, '$.tvoc_ppb') AS DOUBLE)) AS ens_tvoc,
                        CAST(JSON_EXTRACT(values_json, '$.scd_co2')      AS DOUBLE)       AS scd_co2,
                        CAST(JSON_EXTRACT(values_json, '$.scd_temp')     AS DOUBLE)       AS scd_temp,
                        CAST(JSON_EXTRACT(values_json, '$.scd_humidity') AS DOUBLE)       AS scd_humidity,
                        CAST(JSON_EXTRACT(values_json, '$.ina_bus_v')      AS DOUBLE)     AS ina_bus_v,
                        CAST(JSON_EXTRACT(values_json, '$.ina_current_ma') AS DOUBLE)     AS ina_current_ma,
                        CAST(JSON_EXTRACT(values_json, '$.ina_power_mw')   AS DOUBLE)     AS ina_power_mw,
                        CAST(JSON_EXTRACT(values_json, '$.ina_batt_pct')   AS DOUBLE)     AS ina_batt_pct,
                        lat,
                        lon
                    FROM telemetry_readings_tb
                    WHERE device_id = ?
                      AND recorded_at >= UTC_TIMESTAMP() - INTERVAL ? SECOND
                    ORDER BY recorded_at ASC
                `,
                [device.device_id, intervalSeconds]
            );

            const telemetryIds  = [];
            const timestamps    = [];
            const ensEco2s      = [];
            const ahtTemps      = [];
            const rtcTemps      = [];
            const ahtHumidities = [];
            const ensTvocs      = [];
            const scdCo2s       = [];
            const scdTemps      = [];
            const scdHumidities = [];
            const inaBusVs      = [];
            const inaCurrentMas = [];
            const inaPowerMws   = [];
            const inaBattPcts   = [];
            const lats          = [];
            const lons          = [];

            for (const r of rows) {
                telemetryIds.push(r.telemetry_id == null ? null : Number(r.telemetry_id));
                timestamps.push(r.ts           == null ? null : Number(r.ts));
                ensEco2s.push(r.ens_eco2       == null ? null : Number(r.ens_eco2));
                ahtTemps.push(r.aht_temp       == null ? null : Number(r.aht_temp));
                rtcTemps.push(r.rtc_temp       == null ? null : Number(r.rtc_temp));
                ahtHumidities.push(r.aht_humidity == null ? null : Number(r.aht_humidity));
                ensTvocs.push(r.ens_tvoc       == null ? null : Number(r.ens_tvoc));
                scdCo2s.push(r.scd_co2         == null ? null : Number(r.scd_co2));
                scdTemps.push(r.scd_temp       == null ? null : Number(r.scd_temp));
                scdHumidities.push(r.scd_humidity == null ? null : Number(r.scd_humidity));
                inaBusVs.push(r.ina_bus_v         == null ? null : Number(r.ina_bus_v));
                inaCurrentMas.push(r.ina_current_ma == null ? null : Number(r.ina_current_ma));
                inaPowerMws.push(r.ina_power_mw    == null ? null : Number(r.ina_power_mw));
                inaBattPcts.push(r.ina_batt_pct    == null ? null : Number(r.ina_batt_pct));
                lats.push(r.lat == null ? null : Number(r.lat));
                lons.push(r.lon == null ? null : Number(r.lon));
            }

            return res.json({
                ok: true,
                device_uid: device.device_uid,
                device_name: device.device_name,
                room_name: device.room_name,
                home_name: device.home_name,
                hours,
                telemetryIds,
                timestamps,
                ensEco2s,
                ahtTemps,
                rtcTemps,
                ahtHumidities,
                ensTvocs,
                scdCo2s,
                scdTemps,
                scdHumidities,
                inaBusVs,
                inaCurrentMas,
                inaPowerMws,
                inaBattPcts,
                lats,
                lons,
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

    // ------------------------------------------------------------
    // POST /api/devices/:deviceId/rename
    // Update the device_name for a device the user owns
    // ------------------------------------------------------------
    router.post("/devices/:deviceId/rename", async (req, res) => {
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

            const deviceId = Number(req.params.deviceId);
            if (!deviceId) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_device_id",
                    message: "Valid deviceId is required.",
                });
            }

            const newName = String(req.body?.device_name || "").trim();
            if (!newName) {
                return res.status(400).json({
                    ok: false,
                    error: "missing_device_name",
                    message: "device_name is required.",
                });
            }

            const device = await getAccessibleDeviceById(pool, user.user_id, deviceId);
            if (!device) {
                return res.status(404).json({
                    ok: false,
                    error: "device_not_found",
                    message: "Device not found or not accessible.",
                });
            }

            await pool.query(
                "UPDATE devices_tb SET device_name = ? WHERE device_id = ?",
                [newName, device.device_id]
            );

            return res.json({
                ok: true,
                message: "Device renamed successfully.",
                device_id: device.device_id,
                device_name: newName,
            });
        } catch (e) {
            console.error("device rename error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not rename device.",
            });
        }
    });

    // ------------------------------------------------------------
    // POST /api/devices/:deviceId/set-location
    // Pin a lat/lon on the most recent telemetry record so the
    // device shows a fixed location on the map.  For GPS-less
    // devices this persists indefinitely because no future reading
    // will ever supply a non-null lat/lon to displace it.
    // If no telemetry exists yet, inserts a synthetic position-only
    // record so device-live can still return a location.
    // ------------------------------------------------------------
    router.post("/devices/:deviceId/set-location", async (req, res) => {
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

            const deviceId = Number(req.params.deviceId);
            if (!deviceId) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_device_id",
                    message: "Valid deviceId is required.",
                });
            }

            const lat = Number(req.body?.lat);
            const lon = Number(req.body?.lon);

            if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_lat",
                    message: "lat must be a number between -90 and 90.",
                });
            }
            if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_lon",
                    message: "lon must be a number between -180 and 180.",
                });
            }

            const device = await getAccessibleDeviceById(pool, user.user_id, deviceId);
            if (!device) {
                return res.status(404).json({
                    ok: false,
                    error: "device_not_found",
                    message: "Device not found or not accessible.",
                });
            }

            // Find the most recent telemetry record and stamp it with the coordinates
            const [recent] = await pool.query(
                `SELECT telemetry_id
                 FROM telemetry_readings_tb
                 WHERE device_id = ?
                 ORDER BY recorded_at DESC
                 LIMIT 1`,
                [device.device_id]
            );

            if (recent.length) {
                await pool.query(
                    "UPDATE telemetry_readings_tb SET lat = ?, lon = ? WHERE telemetry_id = ?",
                    [lat, lon, recent[0].telemetry_id]
                );
            } else {
                // No telemetry yet — insert a position-only record
                await pool.query(
                    `INSERT INTO telemetry_readings_tb
                        (device_id, recorded_at, received_at, lat, lon, values_json)
                     VALUES (?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?, '{}')`,
                    [device.device_id, lat, lon]
                );
            }

            return res.json({
                ok: true,
                message: "Device location set.",
                lat,
                lon,
            });
        } catch (e) {
            console.error("device set-location error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not set device location.",
            });
        }
    });

    // ------------------------------------------------------------
    // DELETE /api/dashboard/telemetry/:telemetryId
    // Delete a specific telemetry reading owned by the logged-in user
    // ------------------------------------------------------------
    router.delete("/dashboard/telemetry/:telemetryId", async (req, res) => {
        try {
            const sessionUser = req.session?.user;
            const user = await getCurrentUserRow(pool, sessionUser);

            if (!user) {
                return res.status(401).json({
                    ok: false,
                    error: "not_authenticated",
                    message: "You must be logged in.",
                });
            }

            const telemetryId = Number(req.params.telemetryId);
            if (!Number.isInteger(telemetryId) || telemetryId < 1) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_id",
                    message: "Invalid telemetry ID.",
                });
            }

            // Fetch the reading's device_id, then verify the user has access to that device
            const [readingRows] = await pool.query(
                "SELECT device_id FROM telemetry_readings_tb WHERE telemetry_id = ? LIMIT 1",
                [telemetryId]
            );

            if (!readingRows.length) {
                return res.status(404).json({
                    ok: false,
                    error: "not_found",
                    message: "Telemetry reading not found.",
                });
            }

            const device = await getAccessibleDeviceById(pool, user.user_id, readingRows[0].device_id);
            if (!device) {
                return res.status(403).json({
                    ok: false,
                    error: "forbidden",
                    message: "You do not have access to this device.",
                });
            }

            await pool.query(
                "DELETE FROM telemetry_readings_tb WHERE telemetry_id = ?",
                [telemetryId]
            );

            return res.json({ ok: true, message: "Telemetry reading deleted." });
        } catch (e) {
            console.error("delete telemetry error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not delete telemetry reading.",
            });
        }
    });

    // ------------------------------------------------------------
    // POST /api/rooms
    // Create a room in a home the user belongs to
    // ------------------------------------------------------------
    router.post("/rooms", async (req, res) => {
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

            const homeId = Number(req.body?.home_id);
            const roomName = String(req.body?.room_name || "").trim();
            const floor = req.body?.floor ? String(req.body.floor).trim() : null;
            const notes = req.body?.notes ? String(req.body.notes).trim() : null;

            if (!homeId) {
                return res.status(400).json({
                    ok: false,
                    error: "missing_home_id",
                    message: "home_id is required.",
                });
            }
            if (!roomName) {
                return res.status(400).json({
                    ok: false,
                    error: "missing_room_name",
                    message: "room_name is required.",
                });
            }

            const home = await getAccessibleHomeRow(pool, user.user_id, homeId);
            if (!home) {
                return res.status(403).json({
                    ok: false,
                    error: "home_access_denied",
                    message: "You do not have access to that home.",
                });
            }

            const [insert] = await pool.query(
                `
                INSERT INTO rooms_tb (home_id, room_name, floor, notes, created_at)
                VALUES (?, ?, ?, ?, NOW())
                `,
                [home.home_id, roomName, floor, notes]
            );

            return res.json({
                ok: true,
                message: "Room created successfully.",
                room: {
                    room_id: insert.insertId,
                    home_id: home.home_id,
                    room_name: roomName,
                    floor,
                    notes,
                    target_temp_c: null,
                    target_humidity_pct: null,
                },
            });
        } catch (e) {
            if (e?.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    ok: false,
                    error: "duplicate_room_name",
                    message: "That room name already exists in this home.",
                });
            }
            console.error("room create error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not create room.",
            });
        }
    });

    // ------------------------------------------------------------
    // POST /api/rooms/:roomId/rename
    // ------------------------------------------------------------
    router.post("/rooms/:roomId/rename", async (req, res) => {
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

            const roomId = Number(req.params.roomId);
            if (!roomId) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_room_id",
                    message: "Valid roomId is required.",
                });
            }

            const newName = String(req.body?.room_name || "").trim();
            if (!newName) {
                return res.status(400).json({
                    ok: false,
                    error: "missing_room_name",
                    message: "room_name is required.",
                });
            }

            const room = await getAccessibleRoomRow(pool, user.user_id, roomId);
            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error: "room_not_found",
                    message: "Room not found or not accessible.",
                });
            }

            await pool.query(
                "UPDATE rooms_tb SET room_name = ? WHERE room_id = ?",
                [newName, room.room_id]
            );

            return res.json({
                ok: true,
                message: "Room renamed successfully.",
                room_id: room.room_id,
                room_name: newName,
            });
        } catch (e) {
            if (e?.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    ok: false,
                    error: "duplicate_room_name",
                    message: "That room name already exists in this home.",
                });
            }
            console.error("room rename error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not rename room.",
            });
        }
    });

    // ------------------------------------------------------------
    // POST /api/rooms/:roomId/comfort-target
    // Set (or clear, with null) this room's ideal temp/humidity —
    // used to personalise its IAQ score instead of the global default.
    // ------------------------------------------------------------
    router.post("/rooms/:roomId/comfort-target", async (req, res) => {
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

            const roomId = Number(req.params.roomId);
            if (!roomId) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_room_id",
                    message: "Valid roomId is required.",
                });
            }

            const room = await getAccessibleRoomRow(pool, user.user_id, roomId);
            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error: "room_not_found",
                    message: "Room not found or not accessible.",
                });
            }

            const rawTemp = req.body?.target_temp_c;
            const rawHumidity = req.body?.target_humidity_pct;

            let targetTemp = null;
            if (rawTemp !== null && rawTemp !== undefined && rawTemp !== "") {
                targetTemp = Number(rawTemp);
                if (!Number.isFinite(targetTemp) || targetTemp < -50 || targetTemp > 60) {
                    return res.status(400).json({
                        ok: false,
                        error: "invalid_target_temp",
                        message: "target_temp_c must be between -50 and 60.",
                    });
                }
            }

            let targetHumidity = null;
            if (rawHumidity !== null && rawHumidity !== undefined && rawHumidity !== "") {
                targetHumidity = Number(rawHumidity);
                if (!Number.isFinite(targetHumidity) || targetHumidity < 0 || targetHumidity > 100) {
                    return res.status(400).json({
                        ok: false,
                        error: "invalid_target_humidity",
                        message: "target_humidity_pct must be between 0 and 100.",
                    });
                }
            }

            await pool.query(
                "UPDATE rooms_tb SET target_temp_c = ?, target_humidity_pct = ? WHERE room_id = ?",
                [targetTemp, targetHumidity, room.room_id]
            );

            return res.json({
                ok: true,
                message: "Room comfort target updated.",
                room_id: room.room_id,
                target_temp_c: targetTemp,
                target_humidity_pct: targetHumidity,
            });
        } catch (e) {
            console.error("room comfort-target error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not update room comfort target.",
            });
        }
    });

    // ------------------------------------------------------------
    // DELETE /api/rooms/:roomId
    // Devices in this room are unassigned (room_id -> NULL) via the
    // fk_devices_room ON DELETE SET NULL foreign key, not deleted.
    // ------------------------------------------------------------
    router.delete("/rooms/:roomId", async (req, res) => {
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

            const roomId = Number(req.params.roomId);
            if (!roomId) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_room_id",
                    message: "Valid roomId is required.",
                });
            }

            const room = await getAccessibleRoomRow(pool, user.user_id, roomId);
            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error: "room_not_found",
                    message: "Room not found or not accessible.",
                });
            }

            await pool.query("DELETE FROM rooms_tb WHERE room_id = ?", [room.room_id]);

            return res.json({ ok: true, message: "Room deleted.", room_id: room.room_id });
        } catch (e) {
            console.error("room delete error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not delete room.",
            });
        }
    });

    // ------------------------------------------------------------
    // DELETE /api/devices/:deviceId
    // Permanently delete a device. Its keys and telemetry readings are
    // removed via the ON DELETE CASCADE foreign keys. Only the user who
    // claimed the device, or a home owner/admin, may delete it.
    // ------------------------------------------------------------
    router.delete("/devices/:deviceId", async (req, res) => {
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

            const deviceId = Number(req.params.deviceId);
            if (!deviceId) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_device_id",
                    message: "Valid deviceId is required.",
                });
            }

            const [rows] = await pool.query(
                `
                SELECT
                    d.device_id,
                    d.device_uid,
                    d.claimed_by_user_id,
                    hm.role
                FROM devices_tb d
                         INNER JOIN home_memberships_tb hm
                                    ON hm.home_id = d.home_id
                WHERE hm.user_id = ?
                  AND d.device_id = ?
                    LIMIT 1
                `,
                [user.user_id, deviceId]
            );
            const device = rows[0];

            if (!device) {
                return res.status(404).json({
                    ok: false,
                    error: "device_not_found",
                    message: "Device not found or not accessible.",
                });
            }

            const canDelete =
                Number(device.claimed_by_user_id) === Number(user.user_id) ||
                device.role === "owner" ||
                device.role === "admin";

            if (!canDelete) {
                return res.status(403).json({
                    ok: false,
                    error: "forbidden",
                    message: "Only the device owner or a home admin can delete this device.",
                });
            }

            await pool.query("DELETE FROM devices_tb WHERE device_id = ?", [device.device_id]);

            return res.json({
                ok: true,
                message: "Device deleted.",
                device_id: device.device_id,
                device_uid: device.device_uid,
            });
        } catch (e) {
            console.error("device delete error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not delete device.",
            });
        }
    });

    // ------------------------------------------------------------
    // POST /api/devices/:deviceId/assign-room
    // Move a device to a different room (or unassign with room_id: null)
    // ------------------------------------------------------------
    router.post("/devices/:deviceId/assign-room", async (req, res) => {
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

            const deviceId = Number(req.params.deviceId);
            if (!deviceId) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_device_id",
                    message: "Valid deviceId is required.",
                });
            }

            const device = await getAccessibleDeviceById(pool, user.user_id, deviceId);
            if (!device) {
                return res.status(404).json({
                    ok: false,
                    error: "device_not_found",
                    message: "Device not found or not accessible.",
                });
            }

            const rawRoomId = req.body?.room_id;
            let resolvedRoomId = null;

            if (rawRoomId !== null && rawRoomId !== undefined && rawRoomId !== "") {
                const room = await getAccessibleRoomRow(pool, user.user_id, Number(rawRoomId));
                if (!room) {
                    return res.status(404).json({
                        ok: false,
                        error: "room_not_found",
                        message: "Room not found or not accessible.",
                    });
                }
                if (Number(room.home_id) !== Number(device.home_id)) {
                    return res.status(400).json({
                        ok: false,
                        error: "room_home_mismatch",
                        message: "That room belongs to a different home than this device.",
                    });
                }
                resolvedRoomId = room.room_id;
            }

            await pool.query(
                "UPDATE devices_tb SET room_id = ? WHERE device_id = ?",
                [resolvedRoomId, device.device_id]
            );

            return res.json({
                ok: true,
                message: resolvedRoomId ? "Device moved." : "Device unassigned from room.",
                device_id: device.device_id,
                room_id: resolvedRoomId,
            });
        } catch (e) {
            console.error("device assign-room error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not move device.",
            });
        }
    });

    // ------------------------------------------------------------
    // GET /api/dashboard/room-latest
    // Latest telemetry reading for every device accessible to the
    // user, in one query — powers the at-a-glance AQI badge on each
    // room card without an N+1 device-live call per device.
    // ------------------------------------------------------------
    router.get("/dashboard/room-latest", async (req, res) => {
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
                    d.home_id,
                    d.room_id,
                    d.last_seen_at,
                    t.recorded_at,
                    t.received_at,
                    COALESCE(CAST(JSON_EXTRACT(t.values_json, '$.ens_eco2') AS DOUBLE),
                             CAST(JSON_EXTRACT(t.values_json, '$.scd_co2') AS DOUBLE)) AS co2,
                    CAST(JSON_EXTRACT(t.values_json, '$.ens_tvoc') AS DOUBLE) AS tvoc,
                    COALESCE(CAST(JSON_EXTRACT(t.values_json, '$.aht_temp') AS DOUBLE),
                             CAST(JSON_EXTRACT(t.values_json, '$.scd_temp') AS DOUBLE)) AS temp,
                    COALESCE(CAST(JSON_EXTRACT(t.values_json, '$.aht_humidity') AS DOUBLE),
                             CAST(JSON_EXTRACT(t.values_json, '$.scd_humidity') AS DOUBLE)) AS humidity,
                    CAST(JSON_EXTRACT(t.values_json, '$.ens_aqi') AS DOUBLE) AS aqi
                FROM devices_tb d
                INNER JOIN home_memberships_tb hm
                    ON hm.home_id = d.home_id
                LEFT JOIN (
                    SELECT device_id, recorded_at, received_at, values_json,
                           ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY recorded_at DESC) AS rn
                    FROM telemetry_readings_tb
                    WHERE recorded_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
                ) t ON t.device_id = d.device_id AND t.rn = 1
                WHERE hm.user_id = ?
                `,
                [user.user_id]
            );

            const devices = rows.map((r) => ({
                device_id: r.device_id,
                device_uid: r.device_uid,
                home_id: r.home_id,
                room_id: r.room_id,
                last_seen_at: r.last_seen_at,
                recorded_at: r.recorded_at,
                received_at: r.received_at,
                co2: r.co2 == null ? null : Number(r.co2),
                tvoc: r.tvoc == null ? null : Number(r.tvoc),
                temp: r.temp == null ? null : Number(r.temp),
                humidity: r.humidity == null ? null : Number(r.humidity),
                aqi: r.aqi == null ? null : Number(r.aqi),
            }));

            return res.json({ ok: true, devices });
        } catch (e) {
            console.error("room-latest error:", e && (e.stack || e.message || e));
            return res.status(500).json({
                ok: false,
                error: "server_error",
                message: "Could not load room latest readings.",
            });
        }
    });

    return router;
}