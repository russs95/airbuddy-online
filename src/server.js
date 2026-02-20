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

// ---- Helmet with CSP that allows Google Fonts (Arvo + Mulish) ----
// If you set CSP at nginx instead of Node, mirror these there too.
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"], // inline scripts blocked (good)
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

app.use(morgan("tiny"));
app.use(express.json({ limit: "256kb" }));

const startedAt = Date.now();
const { PORT = 3000 } = process.env;

let pool;
try {
    pool = makePool(process.env);
} catch (e) {
    console.error(e.message || e);
    process.exit(1);
}

// ---- Static files (CSP-safe external JS) ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Serve /public as /static/*
app.use("/static", express.static(path.join(__dirname, "..", "public")));

// ------------------------
// Landing page (moved into subfile)
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
// Start Server
// ------------------------
app.listen(Number(PORT), "127.0.0.1", () => {
    console.log(`AirBuddy Online API listening on http://127.0.0.1:${PORT}`);
});