-- db/migrations/002_airbuddy_homefirst.sql
-- AirBuddy Online home-first schema

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- HOMES
CREATE TABLE IF NOT EXISTS `homes_tb` (
                                          `home_id` int(11) NOT NULL AUTO_INCREMENT,
    `owner_buwana_id` int(11) NOT NULL,
    `home_name` varchar(255) NOT NULL,
    `time_zone` varchar(50) DEFAULT NULL,
    `privacy_level` enum('private','shared_link','community','public') NOT NULL DEFAULT 'private',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`home_id`),
    KEY `idx_homes_owner` (`owner_buwana_id`),
    CONSTRAINT `fk_homes_owner`
    FOREIGN KEY (`owner_buwana_id`) REFERENCES `users_tb`(`buwana_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- HOME MEMBERSHIPS
CREATE TABLE IF NOT EXISTS `home_memberships_tb` (
                                                     `home_id` int(11) NOT NULL,
    `buwana_id` int(11) NOT NULL,
    `role` enum('owner','admin','member','viewer') NOT NULL DEFAULT 'member',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`home_id`, `buwana_id`),
    KEY `idx_home_memberships_user` (`buwana_id`),
    CONSTRAINT `fk_home_memberships_home`
    FOREIGN KEY (`home_id`) REFERENCES `homes_tb`(`home_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_home_memberships_user`
    FOREIGN KEY (`buwana_id`) REFERENCES `users_tb`(`buwana_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ROOMS
CREATE TABLE IF NOT EXISTS `rooms_tb` (
                                          `room_id` int(11) NOT NULL AUTO_INCREMENT,
    `home_id` int(11) NOT NULL,
    `room_name` varchar(255) NOT NULL,
    `floor` varchar(64) DEFAULT NULL,
    `notes` text DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`room_id`),
    UNIQUE KEY `uniq_rooms_home_name` (`home_id`, `room_name`),
    KEY `idx_rooms_home` (`home_id`),
    CONSTRAINT `fk_rooms_home`
    FOREIGN KEY (`home_id`) REFERENCES `homes_tb`(`home_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- DEVICES
CREATE TABLE IF NOT EXISTS `devices_tb` (
                                            `device_id` int(11) NOT NULL AUTO_INCREMENT,
    `device_uid` varchar(64) NOT NULL, -- e.g. AB-2049

    `home_id` int(11) DEFAULT NULL,
    `room_id` int(11) DEFAULT NULL,
    `claimed_by_buwana_id` int(11) DEFAULT NULL,

    `device_name` varchar(255) DEFAULT NULL,
    `device_type` varchar(64) NOT NULL DEFAULT 'pico_w',
    `firmware_version` varchar(64) DEFAULT NULL,

    `status` enum('active','disabled','retired') NOT NULL DEFAULT 'active',
    `last_seen_at` datetime DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`device_id`),
    UNIQUE KEY `uniq_devices_uid` (`device_uid`),
    KEY `idx_devices_home` (`home_id`),
    KEY `idx_devices_room` (`room_id`),
    KEY `idx_devices_claimed` (`claimed_by_buwana_id`),
    KEY `idx_devices_last_seen` (`last_seen_at`),

    CONSTRAINT `fk_devices_home`
    FOREIGN KEY (`home_id`) REFERENCES `homes_tb`(`home_id`)
    ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT `fk_devices_room`
    FOREIGN KEY (`room_id`) REFERENCES `rooms_tb`(`room_id`)
    ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT `fk_devices_claimed_by`
    FOREIGN KEY (`claimed_by_buwana_id`) REFERENCES `users_tb`(`buwana_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- DEVICE KEYS (store hash only; never store raw key)
CREATE TABLE IF NOT EXISTS `device_keys_tb` (
                                                `device_key_id` bigint unsigned NOT NULL AUTO_INCREMENT,
                                                `device_id` int(11) NOT NULL,
    `key_hash` char(64) NOT NULL, -- SHA-256 hex
    `label` varchar(255) DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `revoked_at` datetime DEFAULT NULL,

    PRIMARY KEY (`device_key_id`),
    UNIQUE KEY `uniq_device_key_hash` (`device_id`, `key_hash`),
    KEY `idx_device_keys_device` (`device_id`),
    KEY `idx_device_keys_revoked` (`revoked_at`),

    CONSTRAINT `fk_device_keys_device`
    FOREIGN KEY (`device_id`) REFERENCES `devices_tb`(`device_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TELEMETRY READINGS (time-series)
CREATE TABLE IF NOT EXISTS `telemetry_readings_tb` (
                                                       `telemetry_id` bigint unsigned NOT NULL AUTO_INCREMENT,
                                                       `device_id` int(11) NOT NULL,

    `recorded_at` datetime NOT NULL,
    `received_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

    `lat` decimal(10,8) DEFAULT NULL,
    `lon` decimal(11,8) DEFAULT NULL,
    `alt_m` decimal(8,2) DEFAULT NULL,

    `values_json` JSON NOT NULL,
    `confidence_json` JSON DEFAULT NULL,
    `flags_json` JSON DEFAULT NULL,

    PRIMARY KEY (`telemetry_id`),

    KEY `idx_telemetry_device_recorded` (`device_id`, `recorded_at`),
    KEY `idx_telemetry_recorded` (`recorded_at`),
    KEY `idx_telemetry_received` (`received_at`),

    CONSTRAINT `fk_telemetry_device`
    FOREIGN KEY (`device_id`) REFERENCES `devices_tb`(`device_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
