import { sha256Hex } from "../utils/crypto.js";
import { requireHeader } from "../utils/http.js";

export function deviceAuth(pool) {
    return async (req, res, next) => {
        const deviceUid = requireHeader(req, "X-Device-Id");
        const deviceKey = requireHeader(req, "X-Device-Key");

        console.log("[deviceAuth] uid=", deviceUid, "hasKey=", !!deviceKey);

        if (!deviceUid || !deviceKey) {
            return res.status(401).json({ ok: false, error: "missing_device_auth" });
        }

        const conn = await pool.getConnection();
        try {
            const [devRows] = await conn.query(
                "SELECT device_id, status FROM devices_tb WHERE device_uid = ? LIMIT 1",
                [deviceUid]
            );

            console.log("[deviceAuth] devRows=", devRows.length);

            if (!devRows.length) {
                return res.status(401).json({ ok: false, error: "unknown_device" });
            }

            const device = devRows[0];
            console.log("[deviceAuth] device_id=", device.device_id, "status=", device.status);

            if (device.status !== "active") {
                return res.status(401).json({ ok: false, error: "device_not_active" });
            }

            const keyHash = sha256Hex(deviceKey);
            console.log("[deviceAuth] incoming_hash=", keyHash);

            const [keyRows] = await conn.query(
                `SELECT device_key_id, key_hash
                 FROM device_keys_tb
                 WHERE device_id = ?
                   AND key_hash = ?
                   AND revoked_at IS NULL
                     LIMIT 1`,
                [device.device_id, keyHash]
            );

            console.log("[deviceAuth] keyRows=", keyRows.length);

            if (!keyRows.length) {
                const [allKeys] = await conn.query(
                    `SELECT device_key_id, key_hash, revoked_at
                     FROM device_keys_tb
                     WHERE device_id = ?`,
                    [device.device_id]
                );
                console.log("[deviceAuth] storedKeys=", allKeys);
                return res.status(401).json({ ok: false, error: "invalid_device_key" });
            }

            req.device = { device_id: device.device_id, device_uid: deviceUid };
            next();
        } catch (e) {
            console.error("deviceAuth error:", e?.stack || e?.message || e);
            return res.status(500).json({ ok: false, error: "server_error" });
        } finally {
            conn.release();
        }
    };
}