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

const app = express();

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
    res.locals.cspNonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64");
    next();
});

app.use(
    helmet({
        // You can keep other helmet defaults; we customize CSP only.
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],

                // Allow external scripts from self + allow inline scripts ONLY when nonce matches
                scriptSrc: [
                    "'self'",
                    (req, res) => `'nonce-${res.locals.cspNonce}'`,
                ],

                // Landing uses inline <style> plus Google Fonts CSS
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],

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

// ------------------------
// Static files (charts)
// /public => /static/*
// ------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Encourage caching for static (safe: versioned via deploys; you can tune)
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
// If you haven’t done that yet, do it now or CSP will block inline scripts.
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
app.listen(Number(PORT), "127.0.0.1", () => {
    console.log(`AirBuddy Online API listening on http://127.0.0.1:${PORT}`);
});