// src/server.js
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import mysql from "mysql2"; // IMPORTANT: for express-mysql-session store

import { makePool } from "./db/pool.js";
import { deviceAuth } from "./middleware/deviceAuth.js";
import { requireUser } from "./middleware/requireUser.js";

import { telemetryRouter } from "./routes/telemetry.js";
import { deviceRouter } from "./routes/device.js";
import { systemRouter } from "./routes/system.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";

import { landingRouter } from "./pages/landing.js";

dotenv.config();

// -------------------------------------------------------------------
// TIMEZONE FOUNDATIONS
// -------------------------------------------------------------------
process.env.TZ = process.env.TZ || "Asia/Jakarta";
const MYSQL_SESSION_TZ = "+00:00";

const app = express();
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
// ------------------------
app.use((req, res, next) => {
    res.locals.cspNonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64");
    next();
});

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
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
app.use(express.urlencoded({ extended: false }));

const startedAt = Date.now();
const { PORT = 3000 } = process.env;

// ------------------------
// DB pool (your app pool, mysql2/promise)
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
        await pool.query(`SET time_zone = ?`, [MYSQL_SESSION_TZ]);
        await pool.query(`SET NAMES utf8mb4`);
        const [rows] = await pool.query(`SELECT @@session.time_zone AS tz, NOW() AS now_session`);
        const info = rows && rows[0] ? rows[0] : null;
        console.log("[DB] session time_zone:", info?.tz, "NOW():", info?.now_session);
    } catch (e) {
        console.error("[DB] Failed to set session time_zone / charset:", e?.code || e?.message || e);
    }
}

// ------------------------
// Sessions (MySQL-backed)
// ------------------------
if (!process.env.SESSION_SECRET) {
    console.error("Missing SESSION_SECRET in environment.");
    process.exit(1);
}

// express-mysql-session expects a "mysql2" (callback-style) pool, not mysql2/promise.
const sessionDbPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS, // NOTE: your env uses DB_PASS (not DB_PASSWD)
    database: process.env.DB_NAME,
    connectionLimit: 10,
});

// This is the ONLY MySQLStore declaration in the file
const MySQLStore = MySQLStoreFactory(session);

const sessionStore = new MySQLStore(
    {
        createDatabaseTable: true,
        expiration: 1000 * 60 * 60 * 24 * 14, // 14d
        checkExpirationInterval: 1000 * 60 * 60, // 1h cleanup
    },
    sessionDbPool
);

app.use(
    session({
        name: process.env.SESSION_COOKIE_NAME || "airbuddy_sid",
        secret: process.env.SESSION_SECRET,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: true, // behind nginx TLS
            sameSite: "lax",
            domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
            maxAge: 1000 * 60 * 60 * 24 * 14,
        },
    })
);

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
// Auth routes (Buwana SSO)
// ------------------------
app.use("/api/auth", authRouter(pool));

// ------------------------
// Landing page (phase 1)
// ------------------------
app.use("/", landingRouter(pool));

// ------------------------
// System routes (public)
// ------------------------
app.use("/api", systemRouter(pool, startedAt));

// ------------------------
// Device API (device-authenticated)
// ------------------------
app.use("/api", deviceAuth(pool), telemetryRouter(pool));
app.use("/api", deviceAuth(pool), deviceRouter(pool));

// ------------------------
// Dashboard API (user-authenticated)
// ------------------------
app.use("/api", requireUser, dashboardRouter(pool));

// ------------------------
// Global error handler
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