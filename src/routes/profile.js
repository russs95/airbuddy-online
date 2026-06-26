// src/routes/profile.js
//
// User profile routes backed by the Buwana profile API. Buwana is the source of
// truth for a user's identity (location, community, watershed, language, tz); we
// read/update it server-to-server using the OAuth access token stored in the
// session at login (see src/routes/auth.js), then mirror the fresh values into
// users_tb so other AirBuddy queries stay consistent.
//
// Token expiry is handled with a simple "please log in again" prompt for now —
// a silent refresh-token flow is documented as the next step in docs/tasks.md.
import express from "express";

const BUWANA_API_URL =
    process.env.BUWANA_API_URL || "https://buwana.ecobricks.org";

const EMPTY_REFERENCE = { languages: [], timezones: {} };

const getAccessToken = (req) => req.session?.tokens?.accessToken || null;

/**
 * Fetch the authoritative Buwana profile + form reference (languages, timezones)
 * for the current session. Returns { profile, reference, error, status }.
 * On failure profile is null and (error, status) describe why so the caller can
 * map it to an HTTP response the SPA understands (e.g. token_expired → re-login).
 */
async function fetchBuwanaProfile(req) {
    const token = getAccessToken(req);
    if (!token) {
        return {
            profile: null,
            reference: EMPTY_REFERENCE,
            error: "no_token",
            status: 401,
        };
    }
    const url = `${BUWANA_API_URL}/api/profile.php`;
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            let code = "";
            try {
                code = JSON.parse(text).error || "";
            } catch {
                /* non-JSON body */
            }
            console.warn(
                `[profile] Buwana profile API HTTP ${res.status} ${code} body=${text.slice(0, 300)}`
            );
            // 401 means the access token is no longer valid → re-login.
            const error = res.status === 401 ? "token_expired" : code || "buwana_error";
            return { profile: null, reference: EMPTY_REFERENCE, error, status: res.status };
        }
        const data = await res.json();
        if (data.status !== "succeeded" || !data.profile) {
            console.warn(
                "[profile] unexpected Buwana payload:",
                JSON.stringify(data).slice(0, 300)
            );
            return {
                profile: null,
                reference: EMPTY_REFERENCE,
                error: "buwana_bad_payload",
                status: 502,
            };
        }
        return {
            profile: data.profile,
            reference: data.reference || EMPTY_REFERENCE,
            error: null,
            status: 200,
        };
    } catch (err) {
        const cause = err.cause
            ? ` (${err.cause.code || err.cause.message || err.cause})`
            : "";
        console.warn(`[profile] could not reach ${url}: ${err.message}${cause}`);
        return {
            profile: null,
            reference: EMPTY_REFERENCE,
            error: "buwana_unreachable",
            status: 502,
        };
    }
}

/**
 * Mirror the Buwana-derived profile values into users_tb. Best-effort: a failure
 * here is logged but never fails the request (the Buwana update already succeeded).
 */
async function mirrorToUsersTable(pool, buwanaSub, p) {
    try {
        await pool.query(
            `UPDATE users_tb SET
                earthling_emoji    = ?,
                language_name      = COALESCE(?, language_name),
                country_name       = ?,
                time_zone          = ?,
                community_id       = ?,
                community_name     = ?,
                continent_name     = ?,
                location_full      = ?,
                location_watershed = ?,
                location_lat       = ?,
                location_long      = ?
             WHERE buwana_sub = ?`,
            [
                p.earthling_emoji ?? null,
                p.language_name ?? null,
                p.country_name ?? null,
                p.time_zone ?? null,
                p.community_id ?? null,
                p.community_name ?? null,
                p.continent_name ?? null,
                p.location_full ?? null,
                p.location_watershed ?? null,
                p.location_lat ?? null,
                p.location_long ?? null,
                buwanaSub,
            ]
        );
    } catch (e) {
        console.error("[profile] users_tb mirror failed:", e?.code || e?.message || e);
    }
}

export function profileRouter(pool) {
    const router = express.Router();

    // Read the current user's Buwana profile + reference data for edit forms.
    router.get("/profile", async (req, res) => {
        const result = await fetchBuwanaProfile(req);
        if (!result.profile) {
            return res
                .status(result.status || 502)
                .json({ ok: false, error: result.error });
        }
        return res.json({
            ok: true,
            profile: result.profile,
            reference: result.reference,
        });
    });

    // Update the editable Buwana fields (emoji, location, watershed, language,
    // timezone). Country/continent/community are derived by Buwana from location
    // and are never sent. On success, mirror fresh values into users_tb.
    router.post("/profile", async (req, res) => {
        const token = getAccessToken(req);
        if (!token) {
            return res.status(401).json({ ok: false, error: "no_token" });
        }

        // Authoritative current profile — needed so we resubmit every required field.
        const current = await fetchBuwanaProfile(req);
        if (!current.profile) {
            return res
                .status(current.status || 502)
                .json({ ok: false, error: current.error });
        }
        const cur = current.profile;
        const body = req.body || {};
        const str = (v) => (typeof v === "string" ? v.trim() : "");
        const numOr = (v, fallback) => (v === "" || v == null ? fallback : Number(v));

        // Merge edits over current values (only editable fields change).
        const payload = {
            first_name: cur.first_name,
            last_name: cur.last_name,
            birth_date: cur.birth_date || "",
            community_id: cur.community_id,
            earthling_emoji: str(body.earthling_emoji) || cur.earthling_emoji,
            language_id: body.language_id || cur.language_id,
            time_zone: body.time_zone || cur.time_zone,
            location_full: str(body.location_full) || cur.location_full,
            latitude: numOr(body.latitude, cur.location_lat),
            longitude: numOr(body.longitude, cur.location_long),
            location_watershed: str(body.location_watershed) || cur.location_watershed,
        };

        let data;
        try {
            const apiRes = await fetch(`${BUWANA_API_URL}/api/profile_update.php`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            data = await apiRes.json().catch(() => ({}));
            if (!apiRes.ok || data.status !== "succeeded" || !data.profile) {
                const error =
                    apiRes.status === 401
                        ? "token_expired"
                        : data.error || "buwana_update_failed";
                return res.status(apiRes.ok ? 502 : apiRes.status).json({
                    ok: false,
                    error,
                    message: data.message || null,
                });
            }
        } catch (err) {
            console.warn(`[profile] update unreachable: ${err.message}`);
            return res.status(502).json({ ok: false, error: "buwana_unreachable" });
        }

        await mirrorToUsersTable(pool, req.session.user.buwana_sub, data.profile);

        return res.json({ ok: true, profile: data.profile });
    });

    return router;
}

export default profileRouter;
