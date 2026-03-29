-- db/migrations/003_buwana_new_scopes.sql
-- Add columns to users_tb to store all claims from the new Buwana namespaced scope system:
--   buwana:basic, buwana:profile, buwana:community, buwana:bioregion
--
-- Columns that already existed in users_tb (earthling_emoji, role, gea_status, profile_pic,
-- birth_date, time_zone, community_id, location_full, watershed_id, location_watershed,
-- location_lat, location_long) are NOT re-added here — only new columns are.

SET NAMES utf8mb4;

ALTER TABLE `users_tb`
    -- buwana:profile — Buwana account creation date (separate from local created_at)
    ADD COLUMN `buwana_account_created_at` DATETIME DEFAULT NULL
        COMMENT 'created_at claim from buwana:profile — Buwana account creation date'
        AFTER `created_at`,

    -- buwana:profile — resolved language and country names (Buwana resolves these server-side;
    -- existing language_id / country_id columns store numeric IDs from the old flow)
    ADD COLUMN `language_name`  VARCHAR(100)    DEFAULT NULL
        COMMENT 'language claim from buwana:profile — resolved language name in English'
        AFTER `language_id`,
    ADD COLUMN `country_name`   VARCHAR(100)    DEFAULT NULL
        COMMENT 'country claim from buwana:profile — resolved country name'
        AFTER `country_id`,

    -- buwana:profile — brikcoin balance and connected apps
    ADD COLUMN `brikcoin_balance`   DECIMAL(15,4)   DEFAULT NULL
        COMMENT 'brikcoin_balance claim from buwana:profile',
    ADD COLUMN `connected_app_ids`  TEXT            DEFAULT NULL
        COMMENT 'connected_app_ids claim from buwana:profile — JSON array of connected Buwana app IDs',

    -- buwana:community — resolved community name
    ADD COLUMN `community_name` VARCHAR(255)    DEFAULT NULL
        COMMENT 'buwana:community claim — full name of the user''s primary community'
        AFTER `community_id`,

    -- buwana:bioregion — resolved continent name and resolved watershed name
    ADD COLUMN `continent_name` VARCHAR(100)    DEFAULT NULL
        COMMENT 'continent claim from buwana:bioregion — resolved continent name in English'
        AFTER `continent_code`,
    ADD COLUMN `watershed_name` VARCHAR(255)    DEFAULT NULL
        COMMENT 'watershed_name claim from buwana:bioregion — watershed name in English'
        AFTER `watershed_id`;
