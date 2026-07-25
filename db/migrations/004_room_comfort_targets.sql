-- db/migrations/004_room_comfort_targets.sql
-- Per-room comfort targets (ideal temperature / humidity) used to personalise
-- the IAQ score shown on the Manage Home page. NULL means "use the global default".

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE `rooms_tb`
    ADD COLUMN `target_temp_c` decimal(4,1) DEFAULT NULL AFTER `notes`,
    ADD COLUMN `target_humidity_pct` decimal(4,1) DEFAULT NULL AFTER `target_temp_c`;
