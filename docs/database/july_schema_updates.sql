-- docs/database/july_schema_updates.sql
-- Schema updates needed for the Manage Home page (SPA repo: app/pages/manage_home.vue)
-- and its backend endpoints (src/routes/dashboard.js).
--
-- This is the same change as db/migrations/004_room_comfort_targets.sql —
-- copied here for a one-off manual run against the live AB_db database.
--
-- What it does:
--   Adds two nullable columns to rooms_tb so a room can override the
--   whole-house comfort default (ideal temperature / humidity) used when
--   computing that room's IAQ score. NULL means "use the global default"
--   (21.5°C / 50% RH) — no existing rows need backfilling.
--
-- Safe to run on the live database: additive only, no data loss, no locks
-- beyond the brief metadata lock of an ALTER TABLE on rooms_tb (a small table).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE `rooms_tb`
    ADD COLUMN `target_temp_c` decimal(4,1) DEFAULT NULL AFTER `notes`,
    ADD COLUMN `target_humidity_pct` decimal(4,1) DEFAULT NULL AFTER `target_temp_c`;

-- Verify:
-- DESCRIBE rooms_tb;
