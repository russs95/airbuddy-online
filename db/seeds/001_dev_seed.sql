-- db/seeds/001_dev_seed.sql
-- Dev seed: 1 user, 1 home, 2 rooms, 1 device, 1 device key hash
-- Safe to run multiple times (uses INSERT IGNORE / ON DUPLICATE KEY)

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ----------------------------
-- Choose your test device identity
-- ----------------------------
SET @BUWANA_ID := 1;
SET @DEVICE_UID := 'AB-0001';
SET @DEVICE_KEY_RAW := 'devkey-please-change-me';  -- <-- raw key (keep secret in real life)
SET @DEVICE_KEY_HASH := SHA2(@DEVICE_KEY_RAW, 256);

-- ----------------------------
-- Ensure language exists (FK needs it)
-- ----------------------------
INSERT INTO languages_tb (
    language_id, language_name_en, language_code, language_active, text_direction
) VALUES (
             'en', 'English', 'en', 1, 'LTR'
         )
    ON DUPLICATE KEY UPDATE language_name_en=VALUES(language_name_en);

-- Optional: ensure a country exists (not required if country_id stays NULL)
-- Example: Indonesia (360). Adjust if you want.
INSERT INTO countries_tb (
    country_id, country_name, country_population, country_plastic_consumption,
    per_capita_consumption, country_code, country_language, continent_code
) VALUES (
             360, 'Indonesia', 0, 0.00, 0.00, 'ID', 'Indonesian', 'AS'
         )
    ON DUPLICATE KEY UPDATE country_name=VALUES(country_name);

-- Optional: ensure a community exists (not required if community_id stays NULL)
INSERT INTO communities_tb (
    community_id, com_name, com_country, com_type, com_lang, com_status, country_id
) VALUES (
             1, 'AirBuddy Dev Community', 'Indonesia', 'dev', 'en', 'active', 360
         )
    ON DUPLICATE KEY UPDATE com_name=VALUES(com_name);

-- ----------------------------
-- User (permissioned Buwana mirror)
-- ----------------------------
INSERT INTO users_tb (
    buwana_id, open_id, username, first_name, last_name, full_name, email,
    account_status, created_at, role,
    gea_status, terms_of_service, notes, flagged, suspended,
    profile_pic, country_id, language_id, earthen_newsletter_join,
    birth_date, deleteable, watershed_id, continent_code,
    location_full, location_watershed, location_lat, location_long,
    community_id, earthling_emoji, time_zone
) VALUES (
             @BUWANA_ID, 'dev-openid-1', 'devuser', 'Dev', 'User', 'Dev User', 'dev@example.com',
             'active', NOW(), 'user',
             'null', 1, NULL, 0, 0,
             'null', 360, 'en', 0,
             NULL, 1, NULL, 'AS',
             'Dev House', NULL, NULL, NULL,
             1, '🌍', 'Asia/Jakarta'
         )
    ON DUPLICATE KEY UPDATE
                         username=VALUES(username),
                         first_name=VALUES(first_name),
                         last_name=VALUES(last_name),
                         full_name=VALUES(full_name),
                         email=VALUES(email),
                         language_id=VALUES(language_id),
                         country_id=VALUES(country_id),
                         community_id=VALUES(community_id),
                         time_zone=VALUES(time_zone);

-- ----------------------------
-- Home
-- ----------------------------
INSERT INTO homes_tb (home_id, owner_buwana_id, home_name, time_zone, privacy_level)
VALUES (1, @BUWANA_ID, 'My Home (Dev)', 'Asia/Jakarta', 'private')
    ON DUPLICATE KEY UPDATE home_name=VALUES(home_name);

-- Membership
INSERT IGNORE INTO home_memberships_tb (home_id, buwana_id, role)
VALUES (1, @BUWANA_ID, 'owner');

-- ----------------------------
-- Rooms
-- ----------------------------
INSERT INTO rooms_tb (room_id, home_id, room_name, floor, notes)
VALUES
    (1, 1, 'Living Room', NULL, NULL),
    (2, 1, 'Bedroom', NULL, NULL)
    ON DUPLICATE KEY UPDATE room_name=VALUES(room_name);

-- ----------------------------
-- Device
-- ----------------------------
INSERT INTO devices_tb (
    device_id, device_uid, home_id, room_id, claimed_by_buwana_id,
    device_name, device_type, firmware_version, status
) VALUES (
             1, @DEVICE_UID, 1, 1, @BUWANA_ID,
             'AirBuddy Dev Unit', 'pico_w', '0.0.1', 'active'
         )
    ON DUPLICATE KEY UPDATE
                         device_uid=VALUES(device_uid),
                         home_id=VALUES(home_id),
                         room_id=VALUES(room_id),
                         claimed_by_buwana_id=VALUES(claimed_by_buwana_id),
                         device_name=VALUES(device_name);

-- ----------------------------
-- Device key (hashed)
-- ----------------------------
INSERT INTO device_keys_tb (device_id, key_hash, label)
VALUES (1, @DEVICE_KEY_HASH, 'dev key')
    ON DUPLICATE KEY UPDATE label=VALUES(label);

-- Helpful output
SELECT
    @BUWANA_ID AS buwana_id,
    @DEVICE_UID AS device_uid,
    @DEVICE_KEY_RAW AS device_key_raw,
    @DEVICE_KEY_HASH AS device_key_hash_sha256;
