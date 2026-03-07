// src/server.js
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import mysql from "mysql2";

import { makePool } from "./db/pool.js";
import { deviceAuth } from "./middleware/deviceAuth.js";
import { requireUser } from "./middleware/requireUser.js";

// v1 device routes
import { telemetryRouter } from "./routes/v1/telemetry.js";
import { deviceRouter } from "./routes/v1/device.js";

// system + user routes
import { systemRouter } from "./routes/system.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";

import { landingRouter } from "./pages/landing.js";
import makeBuwanaRouter from "./routes/buwana.js";

dotenv.config();


// -------------------------------------------------------------------
// TIMEZONE FOUNDATIONS
// -------------------------------------------------------------------
process.env.TZ = process.env.TZ || "Asia/Jakarta";
const MYSQL_SESSION_TZ = "+00:00";

const app = express();
app.set("trust proxy", true);


// -------------------------------------------------------------------
// PROCESS LEVEL ERROR VISIBILITY
// -------------------------------------------------------------------
process.on("unhandledRejection", (e) => {
    console.error("UNHANDLED REJECTION:", e?.stack || e);
});

process.on("uncaughtException", (e) => {
    console.error("UNCAUGHT EXCEPTION:", e?.stack || e);
});


// -------------------------------------------------------------------
// LOGGING + BODY PARSING
// -------------------------------------------------------------------
app.use(morgan("tiny"));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));

const startedAt = Date.now();
const { PORT = 3000 } = process.env;


// -------------------------------------------------------------------
// DATABASE POOL
// -------------------------------------------------------------------
let pool;

try {
    pool = makePool(process.env);
} catch (e) {
    console.error(e?.message || e);
    process.exit(1);
}


// -------------------------------------------------------------------
// BUWANA SYNC ROUTE (PUBLIC)
// -------------------------------------------------------------------
app.use("/api/buwana", makeBuwanaRouter({ pool }));


// -------------------------------------------------------------------
// SECURITY HEADERS
// -------------------------------------------------------------------
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


// -------------------------------------------------------------------
// DB SESSION TIMEZONE INIT
// -------------------------------------------------------------------
async function initDbSession() {
    try {
        await pool.query(`SET time_zone = ?`, [MYSQL_SESSION_TZ]);
        await pool.query(`SET NAMES utf8mb4`);

        const [rows] = await pool.query(
            `SELECT @@session.time_zone AS tz, NOW() AS now_session`
        );

        const info = rows?.[0];

        console.log(
            "[DB] session time_zone:",
            info?.tz,
            "NOW():",
            info?.now_session
        );
    } catch (e) {
        console.error("[DB] Failed to set session timezone:", e?.code || e?.message || e);
    }
}


// -------------------------------------------------------------------
// SESSION STORE
// -------------------------------------------------------------------
if (!process.env.SESSION_SECRET) {
    console.error("Missing SESSION_SECRET in environment.");
    process.exit(1);
}

const sessionDbPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 10,
});

const MySQLStore = MySQLStoreFactory(session);

const sessionStore = new MySQLStore(
    {
        createDatabaseTable: true,
        expiration: 1000 * 60 * 60 * 24 * 14,
        checkExpirationInterval: 1000 * 60 * 60,
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
            secure: true,
            sameSite: "lax",
            domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
            maxAge: 1000 * 60 * 60 * 24 * 14,
        },
    })
);


// -------------------------------------------------------------------
// STATIC FILES
// -------------------------------------------------------------------
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


// -------------------------------------------------------------------
// AUTH ROUTES
// -------------------------------------------------------------------
app.use("/api/auth", authRouter(pool));


// -------------------------------------------------------------------
// LANDING PAGE
// -------------------------------------------------------------------
app.use("/", landingRouter(pool));


// -------------------------------------------------------------------
// SESSION USER DEBUG
// -------------------------------------------------------------------
app.get("/api/me", (req, res) => {
    const u = req.session?.user;
    if (!u) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    return res.json({ ok: true, user: u });
});


// -------------------------------------------------------------------
// SYSTEM ROUTES (health, live)
// -------------------------------------------------------------------
app.use("/api", systemRouter(pool, startedAt));


// -------------------------------------------------------------------
// DEVICE API v1
// IMPORTANT:
// Mount BEFORE any broader /api requireUser middleware.
// Otherwise /api/v1/* gets intercepted by browser/session auth.
// -------------------------------------------------------------------
const v1 = express.Router();

v1.use(deviceAuth(pool));
v1.use(telemetryRouter(pool));
v1.use(deviceRouter(pool));

app.use("/api/v1", v1);


// -------------------------------------------------------------------
// USER DASHBOARD API
// IMPORTANT:
// Narrow mount path so user auth only protects dashboard endpoints,
// not device APIs.
// -------------------------------------------------------------------
app.use("/api", requireUser, dashboardRouter(pool));


// -------------------------------------------------------------------
// GLOBAL ERROR HANDLER
// -------------------------------------------------------------------
app.use((err, req, res, next) => {
    console.error("UNHANDLED EXPRESS ERROR:", err?.stack || err);
    res.status(500).type("text").send("server_error");
});


// -------------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------------
(async () => {

    await initDbSession();

    app.listen(Number(PORT), "127.0.0.1", () => {
        console.log(
            `AirBuddy Online API listening on http://127.0.0.1:${PORT} (TZ=${process.env.TZ}, DB_TZ=${MYSQL_SESSION_TZ})`
        );
    });

})();