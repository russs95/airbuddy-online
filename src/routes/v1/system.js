import express from "express";

export function systemRouter(pool, startedAt) {
    const router = express.Router();

    // ------------------------
    // Liveness
    // ------------------------
    router.get("/live", (req, res) => {
        res.status(200).json({
            ok: true,
            service: "airbuddy-online",
            ts: Date.now(),
        });
    });

    // ------------------------
    // Health (DB check)
    // ------------------------
    router.get("/health", async (req, res) => {
        const base = {
            service: "airbuddy-online",
            uptime_s: Math.floor((Date.now() - startedAt) / 1000),
            ts: Date.now(),
        };

        try {
            await pool.query("SELECT 1");
            return res.status(200).json({
                ok: true,
                db: true,
                ...base,
            });
        } catch (e) {
            return res.status(503).json({
                ok: false,
                db: false,
                error: "db_unreachable",
                ...base,
            });
        }
    });

    return router;
}
