-- db/migrations/001_core_refs_and_users_tb.sql
-- AirBuddy Online DB (separate from Buwana)
-- MySQL 8+, InnoDB, utf8mb4, FK-safe

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------
-- countries_tb
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `countries_tb` (
                                              `country_id` int(11) NOT NULL,
    `country_name` varchar(255) DEFAULT NULL,
    `country_population` int(11) NOT NULL DEFAULT 0,
    `country_plastic_consumption` decimal(15,2) NOT NULL DEFAULT 0.00,
    `per_capita_consumption` decimal(15,2) NOT NULL DEFAULT 0.00,
    `country_code` varchar(5) NOT NULL,
    `country_language` varchar(255) NOT NULL,
    `country_continent` varchar(100) DEFAULT NULL,
    `iso_alpha_2` char(2) DEFAULT NULL,
    `iso_alpha_3` char(3) DEFAULT NULL,
    `currency_code` char(3) DEFAULT NULL,
    `time_zone` varchar(100) DEFAULT NULL,
    `capital_city` varchar(255) DEFAULT NULL,
    `official_languages` text DEFAULT NULL,
    `internet_domain` varchar(10) DEFAULT NULL,
    `calling_code` varchar(10) DEFAULT NULL,
    `population_density` decimal(15,2) DEFAULT NULL,
    `area_sq_km` decimal(15,2) DEFAULT NULL,
    `gdp` decimal(15,2) DEFAULT NULL,
    `per_capita_data_year` year(4) DEFAULT NULL,
    `continent_code` varchar(5) NOT NULL,
    PRIMARY KEY (`country_id`),
    KEY `idx_countries_code` (`country_code`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- languages_tb
-- IMPORTANT: match users_tb.language_id varchar(11)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `languages_tb` (
                                              `language_id` varchar(11) NOT NULL,
    `language_name_en` varchar(255) NOT NULL,
    `language_name_id` varchar(255) DEFAULT NULL,
    `language_name_fr` varchar(255) DEFAULT NULL,
    `language_name_es` varchar(255) DEFAULT NULL,
    `languages_native_name` varchar(255) DEFAULT NULL,
    `lang_region` varchar(10) DEFAULT NULL,
    `language_code` varchar(10) NOT NULL,
    `country_code` varchar(2) DEFAULT NULL,
    `language_active` tinyint(1) DEFAULT 1,
    `text_direction` enum('LTR','RTL') NOT NULL DEFAULT 'LTR',
    `plural_forms` varchar(255) DEFAULT NULL,
    `date_format` varchar(20) DEFAULT NULL,
    `time_format` varchar(20) DEFAULT NULL,
    `currency_code` varchar(10) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
    `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    `locale` varchar(10) DEFAULT NULL,
    `fallback_lang_id` varchar(11) DEFAULT NULL,
    PRIMARY KEY (`language_id`),
    KEY `idx_languages_active` (`language_active`),
    CONSTRAINT `fk_languages_fallback`
    FOREIGN KEY (`fallback_lang_id`) REFERENCES `languages_tb`(`language_id`)
                                                                ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- watersheds_tb
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `watersheds_tb` (
                                               `watershed_id` int(11) NOT NULL,
    `watershed_name` varchar(255) NOT NULL,
    `watershed_name_en` varchar(255) NOT NULL,
    `watershed_name_fr` varchar(255) NOT NULL,
    `watershed_name_es` varchar(255) NOT NULL,
    `watershed_name_id` varchar(255) NOT NULL,
    `continent_code` varchar(5) NOT NULL,
    `area_sq_km` decimal(15,2) DEFAULT NULL,
    `main_rivers` text DEFAULT NULL,
    `population` int(11) DEFAULT NULL,
    `description` text DEFAULT NULL,
    `average_rainfall_mm` decimal(8,2) DEFAULT NULL,
    `basin_type` enum('closed basin','river basin','lake basin','glacier basin','sea basin','ocean basin') DEFAULT 'river basin',
    `elevation_range_m` varchar(50) DEFAULT NULL,
    `biodiversity_index` decimal(5,2) DEFAULT NULL,
    `species_richness` int(11) DEFAULT NULL,
    `species_evenness` decimal(5,2) DEFAULT NULL,
    `simpsons_index` decimal(5,2) DEFAULT NULL,
    `shannon_wiener_index` decimal(5,2) DEFAULT NULL,
    PRIMARY KEY (`watershed_id`),
    KEY `idx_watersheds_continent` (`continent_code`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- communities_tb (InnoDB + PK + FK to countries)
-- Your original was MyISAM and had no PK; we fix that here.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `communities_tb` (
                                                `community_id` int(11) NOT NULL AUTO_INCREMENT,
    `com_name` varchar(255) NOT NULL,
    `com_country` varchar(100) NOT NULL,
    `com_type` varchar(100) NOT NULL,
    `com_location_full` text DEFAULT NULL,
    `com_lang` varchar(50) NOT NULL,
    `com_status` varchar(50) DEFAULT 'active',
    `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
    `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    `country_id` int(11) DEFAULT NULL,
    PRIMARY KEY (`community_id`),
    KEY `idx_communities_country` (`country_id`),
    KEY `idx_communities_status` (`com_status`),
    CONSTRAINT `fk_communities_country`
    FOREIGN KEY (`country_id`) REFERENCES `countries_tb`(`country_id`)
                                                                ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- users_tb (AirBuddy subset mirror of permissioned Buwana fields)
-- NOTE: We keep column names aligned with Buwana for easy copy/sync.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users_tb` (
                                          `buwana_id` int(11) NOT NULL,

    `open_id` varchar(255) DEFAULT NULL,
    `username` varchar(255) DEFAULT NULL,

    `first_name` varchar(255) NOT NULL,
    `last_name` varchar(255) DEFAULT NULL,
    `full_name` varchar(255) NOT NULL,

    `email` varchar(100) DEFAULT NULL,
    `account_status` varchar(100) DEFAULT NULL,
    `created_at` datetime DEFAULT NULL,

    `role` varchar(255) NOT NULL DEFAULT 'user',

    `gea_status` varchar(255) NOT NULL DEFAULT 'null',
    `terms_of_service` tinyint(1) NOT NULL DEFAULT 0,
    `notes` text DEFAULT NULL,
    `flagged` tinyint(1) NOT NULL DEFAULT 0,
    `suspended` tinyint(1) NOT NULL DEFAULT 0,

    `profile_pic` varchar(255) NOT NULL DEFAULT 'null',
    `country_id` int(11) DEFAULT NULL,
    `language_id` varchar(11) NOT NULL DEFAULT 'en',
    `earthen_newsletter_join` tinyint(1) DEFAULT 1,

    `birth_date` date DEFAULT NULL,
    `deleteable` tinyint(1) NOT NULL DEFAULT 1,
    `watershed_id` int(11) DEFAULT NULL,
    `continent_code` varchar(5) DEFAULT NULL,
    `location_full` varchar(254) DEFAULT NULL,
    `location_watershed` varchar(254) DEFAULT NULL,
    `location_lat` decimal(10,8) DEFAULT NULL,
    `location_long` decimal(11,8) DEFAULT NULL,
    `community_id` int(11) DEFAULT NULL,

    `earthling_emoji` varchar(4) DEFAULT NULL,
    `time_zone` varchar(50) NOT NULL DEFAULT 'Etc/GMT',

    PRIMARY KEY (`buwana_id`),

    UNIQUE KEY `uniq_users_open_id` (`open_id`),
    UNIQUE KEY `uniq_users_email` (`email`),

    KEY `idx_users_username` (`username`),
    KEY `idx_users_country` (`country_id`),
    KEY `idx_users_language` (`language_id`),
    KEY `idx_users_watershed` (`watershed_id`),
    KEY `idx_users_community` (`community_id`),

    CONSTRAINT `fk_users_country`
    FOREIGN KEY (`country_id`) REFERENCES `countries_tb`(`country_id`)
    ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT `fk_users_language`
    FOREIGN KEY (`language_id`) REFERENCES `languages_tb`(`language_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT `fk_users_watershed`
    FOREIGN KEY (`watershed_id`) REFERENCES `watersheds_tb`(`watershed_id`)
    ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT `fk_users_community`
    FOREIGN KEY (`community_id`) REFERENCES `communities_tb`(`community_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
