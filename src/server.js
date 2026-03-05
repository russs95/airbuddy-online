// src/server.js

import express from "express";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

import { deviceAuth } from "./middleware/deviceAuth.js";
import telemetryRouter from "./routes/telemetry.js";
import makeBuwanaRouter from "./routes/buwana.js";

dotenv.config();

const app = express();

app.use(express.json());

/* =====================================================
   MySQL Pool
===================================================== */

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

/* =====================================================
   Health check
===================================================== */

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            ok: true,
            db: true,
            service: "airbuddy-online",
            uptime_s: process.uptime(),
            ts: Date.now()
        });

    } catch (err) {
        console.error("DB health check failed:", err);

        res.status(503).json({
            ok: false,
            db: false,
            error: "db_unreachable",
            service: "airbuddy-online",
            uptime_s: process.uptime(),
            ts: Date.now()
        });
    }
});

/* =====================================================
   Buwana routes (NO device auth)
===================================================== */

app.use("/api/buwana", makeBuwanaRouter({ pool }));

/* =====================================================
   Device authenticated routes
===================================================== */

app.use("/api", deviceAuth);

app.use("/api/v1/telemetry", telemetryRouter({ pool }));

/* =====================================================
   Landing route
===================================================== */

app.get("/", (req, res) => {
    res.send("AirBuddy API running");
});

/* =====================================================
   Error handler
===================================================== */

app.use((err, req, res, next) => {
    console.error("UNHANDLED EXPRESS ERROR:", err);

    res.status(500).json({
        ok: false,
        error: "server_error"
    });
});

/* =====================================================
   Start server
===================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`AirBuddy API listening on port ${PORT}`);
});