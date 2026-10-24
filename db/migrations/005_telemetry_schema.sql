-- db/migrations/005_telemetry_schema.sql
-- Telemetry JSON version, from the payload's top-level `schema` (turtleOS/airOS
-- 2.6+ send 2). NULL = the payload had no `schema`, i.e. v1. The field
-- meanings are the shared data dictionary in turtleOS docs/wrangler/README.md.
--
-- Run this BEFORE deploying the matching src/routes/v1/telemetry.js: the
-- ingest INSERTs name this column and fail without it.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE `telemetry_readings_tb`
    ADD COLUMN `schema_version` tinyint unsigned DEFAULT NULL AFTER `received_at`;
