# AirBuddy Online — CLAUDE.md

## Project Overview

**AirBuddy Online** is a Node.js Express API server for the AirBuddy 2.1 open-source air quality hardware project. It ingests sensor telemetry from physical AirBuddy devices, authenticates users via Buwana (federated OAuth/OIDC), and exposes APIs consumed by the AirBuddy Nuxt frontend (separate repo).

Design philosophy: **Home First → Community Second → Global Later** — data is private by default and shared only with explicit user consent.

## Stack

- **Runtime**: Node.js 22 LTS (ES modules — `"type": "module"` in package.json)
- **Framework**: Express 5.2.1
- **Database**: MySQL 8.0 via `mysql2/promise`
- **Auth**: Buwana PKCE/OIDC for users; SHA256-hashed device API keys for hardware
- **Sessions**: `express-session` + MySQL session store (`express-mysql-session`)
- **Security**: Helmet + per-request CSP nonces
- **Logging**: Morgan (tiny format)

Start the server: `node src/server.js`
Listens on `127.0.0.1:3000` (behind Nginx reverse proxy).

## Repository Structure

```
src/
  server.js                  # Entry point — Express app, middleware, route mounting
  routes/
    v1/
      telemetry.js           # POST /api/v1/telemetry  (device → store readings)
                             # GET  /api/v1/trends     (device → fetch history)
      device.js              # GET  /api/v1/device     (device metadata)
    auth.js                  # GET  /api/auth/login    (PKCE flow start)
                             # GET  /api/auth/callback (OAuth callback + JWT verify)
                             # GET  /api/auth/me       (current session user)
                             # POST /api/auth/logout
    dashboard.js             # GET  /api/dashboard/devices
                             # GET  /api/dashboard/bootstrap     (homes/rooms/devices)
                             # GET  /api/dashboard/device-live
                             # GET  /api/dashboard/device-trends
                             # POST /api/devices/register
                             # POST /api/devices/:deviceId/reset-key
    system.js                # GET  /api/live   (liveness probe)
                             # GET  /api/health  (liveness + DB check)
                             # GET  /api/me      (alias for auth/me)
    buwana.js                # POST /api/buwana/sync-user  (server-to-server webhook)
  middleware/
    deviceAuth.js            # Validates X-Device-Id + X-Device-Key headers
    requireUser.js           # Guards user routes — checks req.session.user.buwana_id
  db/
    pool.js                  # MySQL connection pool (timezone: UTC "Z")
  utils/
    crypto.js                # sha256Hex(str)
    http.js                  # requireHeader(), isFiniteNumber(), toMySQLDatetimeFromUnixSeconds()
  pages/
    landing.js               # Server-rendered HTML dashboard (MVP, hardcoded device)
public/
  chart_core.js              # Chart.js shared setup
  temps.js / humidity.js / co2.js / tvoc.js  # Per-metric chart renderers
```

## Authentication Model

Two completely separate auth systems:

### Device Auth (`src/middleware/deviceAuth.js`)
- Hardware sends `X-Device-Id` (device UID string) and `X-Device-Key` (plaintext key)
- Middleware SHA256-hashes the key and compares against `device_keys_tb`
- Only non-revoked keys (`revoked_at IS NULL`) are accepted
- Attaches `req.device = { device_id, device_uid }` on success
- Applied to all `/api/v1/*` routes

### User Auth (Buwana PKCE/OIDC)
- Login initiates PKCE flow → redirects to Buwana authorize endpoint
- Callback validates JWT (JWKS), upserts user into `users_tb`, creates session
- Session cookie: `airbuddy_sid` (httpOnly, secure, sameSite=lax, 14-day max)
- `requireUser` middleware checks `req.session?.user?.buwana_id`
- Applied to all `/api/dashboard/*` and `/api/devices/*` routes

## Database Tables (Key Schema)

| Table | Purpose |
|-------|---------|
| `devices_tb` | Device registry (device_uid, status, home_id, room_id, firmware_version, last_seen_at) |
| `device_keys_tb` | Hashed API keys (key_hash, device_id, revoked_at) |
| `telemetry_readings_tb` | Sensor data (device_id, recorded_at, received_at, values_json, confidence_json, flags_json, lat, lon, alt_m) |
| `users_tb` | Users (buwana_sub UNIQUE, buwana_id, email, first_name, last_name, full_name, time_zone) |
| `homes_tb` | Homes (home_id, home_name, owner_user_id, privacy_level, time_zone) |
| `rooms_tb` | Rooms (room_id, home_id, room_name, floor, notes) |
| `home_memberships_tb` | Access control (home_id, user_id, role) |
| `communities_tb` | Communities |

All timestamps stored as UTC in MySQL DATETIME columns. The pool uses `timezone: "Z"`.

## Telemetry Ingestion Rules (`src/routes/v1/telemetry.js`)

The `POST /api/v1/telemetry` endpoint applies these before storing:
1. **Timestamp validation**: `recorded_at` must be Unix seconds between year 2000–2100
2. **Bad-zero filter**: Readings where temp, humidity, or CO2 are exactly `0` are treated as boot garbage → returns `202 Accepted` (not stored)
3. **Duplicate handling**: Unique constraint on `(device_id, recorded_at)` — duplicates silently ignored
4. **last_seen_at**: Always updated on any valid ingest, even if reading is filtered

Sensor fields (stored as JSON in `values_json`):
- `eco2_ppm`, `temp_c`, `rh_pct`, `tvoc_ppb`, `aqi`, `rtc_temp_c`

## Device Registration Flow

`POST /api/devices/register` (user-authenticated):
1. Accepts `device_uid`, `device_name`, home (existing or new), room (existing or new)
2. Creates home/room if needed — wrapped in a transaction
3. Generates 18-byte base64url random device key
4. Stores SHA256 hash in `device_keys_tb`
5. Returns plaintext key **once** — user/device must save it immediately

`POST /api/devices/:deviceId/reset-key`:
- Revokes all existing keys (`revoked_at = NOW()`)
- Generates and returns a new key (same one-time pattern)

## Environment Variables

```bash
# Database
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASS=
DB_NAME=

# Server
PORT=3000
TZ=Asia/Jakarta
SESSION_SECRET=          # Required — crashes if missing
SESSION_COOKIE_NAME=airbuddy_sid
SESSION_COOKIE_DOMAIN=   # Optional

# Buwana OAuth
BUWANA_CLIENT_ID=airb_ca090536efc8
BUWANA_CLIENT_SECRET=    # Optional
BUWANA_AUTHORIZE_URL=https://buwana.ecobricks.org/authorize.php
BUWANA_TOKEN_URL=https://buwana.ecobricks.org/token.php
BUWANA_JWKS_URI=https://buwana.ecobricks.org/.well-known/jwks.php
BUWANA_REDIRECT_URI=https://air2.earthen.io/api/auth/callback
BUWANA_SCOPE=openid profile email
BUWANA_ISSUER=           # Optional — for JWT iss validation
POST_LOGIN_REDIRECT=https://air2.earthen.io/

# Buwana sync webhook
BUWANA_SYNC_SECRET=      # Shared secret — matched against X-Buwana-Secret header
```

## Key Conventions

- **ES modules throughout** — use `import`/`export`, not `require()`
- **UTC in DB, local in UI** — never store localized times; apply user timezone only at display layer
- **Chart X-axis uses `received_at`** (server truth), not `recorded_at` (device clock, may drift)
- **No rate limiting in app** — delegated to Nginx upstream
- **No CORS config** — same-origin enforced via CSP; Nuxt frontend proxies API calls
- **Error responses**: `{ ok: false, error: "snake_case_code" }` pattern
- **Success responses**: `{ ok: true, ... }` pattern
- **Device key is plaintext only at creation time** — never stored, never re-shown

## Nuxt Frontend Integration

The AirBuddy Nuxt site (separate repo) consumes these APIs:
- Uses `/api/auth/*` for user login/logout/session
- Uses `/api/dashboard/*` for authenticated user views
- Device hardware directly calls `/api/v1/*` with device key headers
- Session cookie (`airbuddy_sid`) is shared across the same domain

## Security Notes

- Device keys: SHA256 hashed at rest; plaintext only returned at registration
- CSP: Nonce generated per-request via `res.locals.nonce`; applied to all inline scripts
- Sessions: MySQL-backed, httpOnly secure cookies
- TLS: Handled by Nginx reverse proxy; app binds only to `127.0.0.1`
- No rate limiting in app layer — Nginx handles this
