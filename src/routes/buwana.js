// src/routes/buwana.js
// Buwana → AirBuddy user sync endpoint

import express from "express";
import crypto from "crypto";

export default function makeBuwanaRouter({ pool }) {
    const router = express.Router();

    // Shared secret for Buwana → AirBuddy calls
    const SHARED_SECRET = process.env.BUWANA_SYNC_SECRET;

    router.post("/sync-user", async (req, res) => {
        try {
            const auth = req.headers["x-buwana-secret"];

            if (!auth || auth !== SHARED_SECRET) {
                return res.status(401).json({ ok: false, error: "unauthorized" });
            }

            const {
                buwana_sub,
                email,
                username,
                first_name,
                last_name,
                full_name
            } = req.body;

            if (!buwana_sub || !email) {
                return res.status(400).json({
                    ok: false,
                    error: "missing_required_fields"
                });
            }

            // Insert or update user
            const sql = `
        INSERT INTO users_tb
        (buwana_sub, email, username, first_name, last_name, full_name)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          email = VALUES(email),
          username = VALUES(username),
          first_name = VALUES(first_name),
          last_name = VALUES(last_name),
          full_name = VALUES(full_name)
      `;

            await pool.execute(sql, [
                buwana_sub,
                email,
                username || null,
                first_name || "",
                last_name || null,
                full_name || first_name || ""
            ]);

            return res.json({
                ok: true
            });

        } catch (err) {
            console.error("buwana sync error:", err);
            return res.status(500).json({
                ok: false,
                error: "sync_failed"
            });
        }
    });

    return router;
}