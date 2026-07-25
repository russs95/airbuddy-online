-- MySQL dump 10.13  Distrib 8.0.46, for Linux (x86_64)
--
-- Host: localhost    Database: AB_db
-- ------------------------------------------------------
-- Server version	8.0.46-0ubuntu0.24.04.3

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `buwana_ref_cache_tb`
--

DROP TABLE IF EXISTS `buwana_ref_cache_tb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `buwana_ref_cache_tb` (
  `ref_type` enum('country','language','community','watershed') COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref_json` json NOT NULL,
  `etag` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hash_sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fetched_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime DEFAULT NULL,
  `last_seen_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `given_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `family_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `earthling_emoji` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `language` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `community_id` int unsigned DEFAULT NULL,
  `community` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `continent` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location_full` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `watershed_id` int unsigned DEFAULT NULL,
  `watershed_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location_watershed` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location_lat` decimal(10,8) DEFAULT NULL,
  `location_long` decimal(11,8) DEFAULT NULL,
  PRIMARY KEY (`ref_type`,`ref_id`),
  KEY `idx_ref_expires` (`expires_at`),
  KEY `idx_ref_last_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `device_keys_tb`
--

DROP TABLE IF EXISTS `device_keys_tb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `device_keys_tb` (
  `device_key_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int NOT NULL,
  `key_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`device_key_id`),
  UNIQUE KEY `uniq_key_hash` (`key_hash`),
  KEY `idx_device_keys_device` (`device_id`),
  KEY `idx_device_keys_revoked` (`revoked_at`),
  CONSTRAINT `fk_device_keys_device` FOREIGN KEY (`device_id`) REFERENCES `devices_tb` (`device_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `devices_tb`
--

DROP TABLE IF EXISTS `devices_tb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `devices_tb` (
  `device_id` int NOT NULL AUTO_INCREMENT,
  `device_uid` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `home_id` int DEFAULT NULL,
  `room_id` int DEFAULT NULL,
  `claimed_by_user_id` bigint unsigned DEFAULT NULL,
  `device_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pico_w',
  `firmware_version` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','disabled','retired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `last_seen_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`device_id`),
  UNIQUE KEY `uniq_devices_uid` (`device_uid`),
  KEY `idx_devices_home` (`home_id`),
  KEY `idx_devices_room` (`room_id`),
  KEY `idx_devices_claimed_by_user` (`claimed_by_user_id`),
  KEY `idx_devices_last_seen` (`last_seen_at`),
  CONSTRAINT `fk_devices_claimed_by_user` FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users_tb` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_devices_home` FOREIGN KEY (`home_id`) REFERENCES `homes_tb` (`home_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_devices_room` FOREIGN KEY (`room_id`) REFERENCES `rooms_tb` (`room_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `home_memberships_tb`
--

DROP TABLE IF EXISTS `home_memberships_tb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `home_memberships_tb` (
  `home_id` int NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `role` enum('owner','admin','member','viewer') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'member',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`home_id`,`user_id`),
  KEY `idx_home_memberships_user` (`user_id`),
  CONSTRAINT `fk_home_memberships_home` FOREIGN KEY (`home_id`) REFERENCES `homes_tb` (`home_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_home_memberships_user` FOREIGN KEY (`user_id`) REFERENCES `users_tb` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `homes_tb`
--

DROP TABLE IF EXISTS `homes_tb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `homes_tb` (
  `home_id` int NOT NULL AUTO_INCREMENT,
  `owner_user_id` bigint unsigned NOT NULL,
  `home_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `time_zone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `privacy_level` enum('private','shared_link','community','public') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'private',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`home_id`),
  KEY `idx_homes_owner` (`owner_user_id`),
  CONSTRAINT `fk_homes_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users_tb` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rooms_tb`
--

DROP TABLE IF EXISTS `rooms_tb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rooms_tb` (
  `room_id` int NOT NULL AUTO_INCREMENT,
  `home_id` int NOT NULL,
  `room_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `floor` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`room_id`),
  UNIQUE KEY `uniq_rooms_home_name` (`home_id`,`room_name`),
  KEY `idx_rooms_home` (`home_id`),
  CONSTRAINT `fk_rooms_home` FOREIGN KEY (`home_id`) REFERENCES `homes_tb` (`home_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int unsigned NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `telemetry_readings_tb`
--

DROP TABLE IF EXISTS `telemetry_readings_tb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `telemetry_readings_tb` (
  `telemetry_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int NOT NULL,
  `recorded_at` datetime NOT NULL,
  `received_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lat` decimal(10,8) DEFAULT NULL,
  `lon` decimal(11,8) DEFAULT NULL,
  `alt_m` decimal(8,2) DEFAULT NULL,
  `values_json` json NOT NULL,
  `confidence_json` json DEFAULT NULL,
  `flags_json` json DEFAULT NULL,
  PRIMARY KEY (`telemetry_id`),
  UNIQUE KEY `uniq_device_recorded` (`device_id`,`recorded_at`),
  KEY `idx_telemetry_recorded` (`recorded_at`),
  KEY `idx_telemetry_received` (`received_at`),
  CONSTRAINT `fk_telemetry_device` FOREIGN KEY (`device_id`) REFERENCES `devices_tb` (`device_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=32103 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users_tb`
--

DROP TABLE IF EXISTS `users_tb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users_tb` (
  `user_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `buwana_sub` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `buwana_id` int DEFAULT NULL,
  `username` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `first_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `full_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_status` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `buwana_account_created_at` datetime DEFAULT NULL COMMENT 'created_at claim from buwana:profile ? Buwana account creation date',
  `role` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `gea_status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'null',
  `terms_of_service` tinyint(1) NOT NULL DEFAULT '0',
  `notes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `flagged` tinyint(1) NOT NULL DEFAULT '0',
  `suspended` tinyint(1) NOT NULL DEFAULT '0',
  `profile_pic` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'null',
  `country_id` int DEFAULT NULL,
  `country_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'country claim from buwana:profile ? resolved country name',
  `language_id` varchar(11) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'en',
  `language_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'language claim from buwana:profile ? resolved language name in English',
  `community_id` int DEFAULT NULL,
  `community_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'buwana:community claim ? full name of the user''s primary community',
  `watershed_id` int DEFAULT NULL,
  `watershed_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'watershed_name claim from buwana:bioregion ? watershed name in English',
  `continent_code` varchar(5) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `continent_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'continent claim from buwana:bioregion ? resolved continent name in English',
  `location_full` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location_watershed` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location_lat` decimal(10,8) DEFAULT NULL,
  `location_long` decimal(11,8) DEFAULT NULL,
  `earthen_newsletter_join` tinyint(1) DEFAULT '1',
  `birth_date` date DEFAULT NULL,
  `deleteable` tinyint(1) NOT NULL DEFAULT '1',
  `earthling_emoji` varchar(4) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `time_zone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Etc/GMT',
  `brikcoin_balance` decimal(15,4) DEFAULT NULL COMMENT 'brikcoin_balance claim from buwana:profile',
  `connected_app_ids` text COLLATE utf8mb4_unicode_ci COMMENT 'connected_app_ids claim from buwana:profile ? JSON array of connected Buwana app IDs',
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uniq_users_buwana_sub` (`buwana_sub`),
  UNIQUE KEY `uniq_users_email` (`email`),
  UNIQUE KEY `uniq_users_buwana_id` (`buwana_id`),
  KEY `idx_users_username` (`username`),
  KEY `idx_users_country` (`country_id`),
  KEY `idx_users_language` (`language_id`),
  KEY `idx_users_watershed` (`watershed_id`),
  KEY `idx_users_community` (`community_id`)
) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-28  1:10:50
