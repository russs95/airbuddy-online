// src/server.js
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import { makePool } from "./db/pool.js";
import { deviceAuth } from "./middleware/deviceAuth.js";
import { telemetryRouter } from "./routes/telemetry.js";
import { deviceRouter } from "./routes/device.js";
import { systemRouter } from "./routes/system.js";
import { landingRouter } from "./pages/landing.js";

dotenv.config();

// -------------------------------------------------------------------
// TIMEZONE FOUNDATIONS
// -------------------------------------------------------------------
// 1) Node process timezone (affects Date stringification + some libs).
//    Your UI can still explicitly format "Asia/Jakarta" where desired.
//    Setting this helps prevent "mystery local time" surprises.
process.env.TZ = process.env.TZ || "Asia/Jakarta";

// 2) MySQL session timezone: we want all DB-side "NOW()", "CURRENT_TIMESTAMP",
//    comparisons, and TIMESTAMP conversions to be consistent.
//    Because you store device "recorded_at" as UTC (per your design), it’s
//    safest to keep DB session in UTC.
const MYSQL_SESSION_TZ = "+00:00";

const app = express();

// If you're behind nginx (you are), this fixes req.ip, req.protocol,
// and helps cookie secure logic if you ever add sessions.
app.set("trust proxy", true);

// ------------------------
// Process-level crash visibility
// ------------------------
process.on("unhandledRejection", (e) => {
    console.error("UNHANDLED REJECTION:", e && (e.stack || e));
});

process.on("uncaughtException", (e) => {
    console.error("UNCAUGHT EXCEPTION:", e && (e.stack || e));
});

// ------------------------
// Security headers (CSP + fonts)
// NOTE: landing.js uses ONE tiny inline <script> for theme + selector sync.
// We allow it safely with a per-request nonce.
// ------------------------
app.use((req, res, next) => {
    res.locals.cspNonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString(
        "base64"
    );
    next();
});

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://fonts.googleapis.com",
                ],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                frameAncestors: ["'none'"],
                upgradeInsecureRequests: [],
            },
        },
    })
);

// ------------------------
// Logging + body parsing
// ------------------------
app.use(morgan("tiny"));
app.use(express.json({ limit: "256kb" }));

const startedAt = Date.now();
const { PORT = 3000 } = process.env;

// ------------------------
// DB pool
// ------------------------
let pool;
try {
    pool = makePool(process.env);
} catch (e) {
    console.error(e?.message || e);
    process.exit(1);
}

// Ensure MySQL session timezone is UTC (and charset predictable).
async function initDbSession() {
    try {
        // Apply to the current pool session(s). mysql2 pool sessions are created lazily,
        // but this still helps; and we also issue it once on startup for early connections.
        await pool.query(`SET time_zone = ?`, [MYSQL_SESSION_TZ]);
        await pool.query(`SET NAMES utf8mb4`);
        // Optional: verify
        const [rows] = await pool.query(
            `SELECT @@session.time_zone AS tz, NOW() AS now_session`
        );
        const info = rows && rows[0] ? rows[0] : null;
        console.log("[DB] session time_zone:", info?.tz, "NOW():", info?.now_session);
    } catch (e) {
        // Don’t hard-fail the server for this, but do log loudly.
        console.error(
            "[DB] Failed to set session time_zone / charset:",
            e?.code || e?.message || e
        );
    }
}

// ------------------------
// Static files (charts)
// /public => /static/*
// ------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
    "/static",
    express.static(path.join(__dirname, "..", "public"), {
        maxAge: "1h",
        etag: true,
        immutable: false,
    })
);

// ------------------------
// Landing page
// NOTE: landing.js should apply the nonce to its inline scripts:
//   <script nonce="${esc(res.locals.cspNonce)}"> ... </script>
// ------------------------
app.use("/", landingRouter(pool));

// ------------------------
// System routes
// ------------------------
app.use("/api", systemRouter(pool, startedAt));

// ------------------------
// API v1 (authenticated)
// ------------------------
app.use("/api", deviceAuth(pool), telemetryRouter(pool));
app.use("/api", deviceAuth(pool), deviceRouter(pool));

// ------------------------
// Global error handler (prints real stack)
// ------------------------
app.use((err, req, res, next) => {
    console.error("UNHANDLED EXPRESS ERROR:", err && (err.stack || err));
    res.status(500).type("text").send("server_error");
});

// ------------------------
// Start Server
// ------------------------
(async () => {
    await initDbSession();

    app.listen(Number(PORT), "127.0.0.1", () => {
        console.log(
            `AirBuddy Online API listening on http://127.0.0.1:${PORT} (TZ=${process.env.TZ}, DB_TZ=${MYSQL_SESSION_TZ})`
        );
    });
})();