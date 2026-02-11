# 🌬️ AirBuddy Online

The public web server development for the  [airBuddy 2.1 open source hardware project]([https://github.com/russs95/airbuddy-online](https://github.com/russs95/airbuddy_v2/)). 

**Private air intelligence for your home.\
Community insight when you're ready.\
Global transparency when it matters.**

------------------------------------------------------------------------

## Overview

**AirBuddy Online** is the cloud companion to the AirBuddy hardware
device.

It is designed with a deliberate progression:

1.  🏠 **Home First** --- Understand your own air deeply and privately\
2.  🏘️ **Community Second** --- Share selectively with trusted groups\
3.  🌍 **Global Later** --- Contribute anonymized environmental insight

The system begins as a private home air console and grows outward only
when invited.

------------------------------------------------------------------------

## Philosophy

Air is invisible, yet it shapes sleep, cognition, health, and comfort.

Most air-quality platforms begin with public maps and dashboards.\
AirBuddy begins somewhere more meaningful:

> Your bedroom at 2:00am.\
> Your living room during dinner.\
> Your home as a breathing organism.

This project exists to make the invisible visible --- calmly, privately,
and responsibly.

------------------------------------------------------------------------

## Architecture (MVP)

**Stack**

-   Node.js 22 LTS (API layer)
-   Nginx (reverse proxy + TLS)
-   MySQL (local, private)
-   PM2 (process management)
-   Buwana (federated authentication)

**Domain**

    https://air.earthen.io

**High-level flow**

AirBuddy device → HTTPS → Node API → MySQL → Dashboard

------------------------------------------------------------------------

## System Layers

### 🏠 Home Layer (Phase 1)

-   Multiple AirBuddy devices per home
-   Devices assigned to rooms
-   Private dashboard
-   Historical telemetry storage
-   Event annotations (windows open, cooking, sleep)
-   Device confidence scoring

Privacy default: **private**

------------------------------------------------------------------------

### 🏘️ Community Layer (Phase 2)

-   Opt-in home participation
-   Aggregated room or device sharing
-   Neighborhood or school dashboards
-   Shared trends without exposing private home data

Privacy default: **opt-in**

------------------------------------------------------------------------

### 🌍 Global Layer (Phase 3)

-   Published streams (aggregated only)
-   Location fuzzing
-   Time delay controls
-   Public API access for research

Privacy default: **explicit publish only**

------------------------------------------------------------------------

## Repository Structure

    airbuddy-online/
    │
    ├── apps/
    │   └── api/              # Node API (telemetry ingestion + auth)
    │
    ├── db/
    │   ├── migrations/       # Schema evolution
    │   └── seeds/
    │
    ├── infra/
    │   ├── nginx/            # Nginx configs
    │   ├── pm2/              # PM2 ecosystem config
    │   └── scripts/          # Deployment helpers
    │
    └── docs/
        └── api.md

------------------------------------------------------------------------

## Core Concepts

### Homes

A private container for: - Rooms - Devices - Telemetry - Insights

### Rooms

Logical grouping inside a home: - Bedroom - Living Room - Kitchen -
Outdoor

### Devices

An AirBuddy unit with: - Unique device UID - Device key for ingestion
auth - Assigned room - Firmware + health metadata

### Telemetry

Time-series sensor readings: - CO₂ (ppm) - PM2.5 - Temperature -
Humidity - Confidence metrics - Optional GPS data

Raw data is stored first. Aggregations come later.

------------------------------------------------------------------------

## Authentication Model

Two separate auth domains:

### 1️⃣ Device Authentication

Used by hardware units.

-   `X-Device-Id`
-   `X-Device-Key`

Each device has its own secret.\
Keys are hashed in the database.

### 2️⃣ User Authentication

Handled by Buwana.

-   OAuth-style login
-   JWT validation in API
-   `users.buwana_user_id` links identity

Devices never authenticate via Buwana.\
Users never authenticate with device keys.

------------------------------------------------------------------------

## API (Initial)

### Health

    GET /api/health

### Telemetry Ingestion

    POST /api/v1/telemetry

Headers:

    X-Device-Id: AB-2049
    X-Device-Key: <secret>

Body:

``` json
{
  "recorded_at": 1700000000,
  "lat": -7.716,
  "lon": 114.008,
  "values": {
    "co2_ppm": 812,
    "temp_c": 26.8,
    "rh_pct": 68
  },
  "confidence": {
    "co2_ppm": 0.91
  }
}
```

------------------------------------------------------------------------

## Database Design Philosophy

-   Home-first ownership
-   Devices attach to homes
-   Telemetry attaches to devices
-   Communities attach to homes (optional)
-   Global publishing derives from private telemetry

Raw telemetry is never overwritten.

------------------------------------------------------------------------

## Deployment (VPS)

-   Ubuntu VPS
-   Nginx → reverse proxy to `127.0.0.1:3000`
-   MySQL bound to localhost
-   PM2 manages Node process
-   Let's Encrypt for TLS

------------------------------------------------------------------------

## Development Workflow

1.  Develop locally
2.  Push to GitHub
3.  SSH to VPS
4.  `git pull`
5.  Run migrations
6.  Restart PM2

Database managed via: - CLI for setup - Beekeeper Studio via SSH tunnel

------------------------------------------------------------------------

## Roadmap

### Phase 1 --- Log Real Data

-   [ ] Telemetry endpoint
-   [ ] Device key auth
-   [ ] Basic home schema
-   [ ] Historical storage

### Phase 2 --- Home Dashboard

-   [ ] Current status summary
-   [ ] Room comparison
-   [ ] Daily CO₂ cycle visualization
-   [ ] Event overlays

### Phase 3 --- Insights

-   [ ] Night CO₂ analysis
-   [ ] Ventilation impact detection
-   [ ] Sensor cross-validation

### Phase 4 --- Community Sharing

-   [ ] Home opt-in
-   [ ] Aggregated stats
-   [ ] Community dashboard

### Phase 5 --- Global Publishing

-   [ ] Public streams
-   [ ] Aggregated data API
-   [ ] Research export

------------------------------------------------------------------------

## Long-Term Vision

AirBuddy Online is not just a dashboard.

It is:

-   A home breathing monitor
-   A habit-shaping tool
-   A community science platform
-   A calm, ethical alternative to extractive sensor networks

It begins privately.

It scales intentionally.

It never forces exposure.
