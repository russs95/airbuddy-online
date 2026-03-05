// src/routes/auth.js
import express from "express";
import crypto from "crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";

const BUWANA_CLIENT_ID = process.env.BUWANA_CLIENT_ID || "airb_ca090536efc8";
const BUWANA_CLIENT_SECRET = process.env.BUWANA_CLIENT_SECRET || ""; // optional (some servers require it)

const BUWANA_AUTHORIZE_URL =
    process.env.BUWANA_AUTHORIZE_URL || "https://buwana.ecobricks.org/authorize.php";
const BUWANA_TOKEN_URL =
    process.env.BUWANA_TOKEN_URL || "https://buwana.ecobricks.org/token.php";
const BUWANA_JWKS_URI =
    process.env.BUWANA_JWKS_URI || "https://buwana.ecobricks.org/.well-known/jwks.php";

const BUWANA_REDIRECT_URI =
    process.env.BUWANA_REDIRECT_URI || "https://air2.earthen.io/api/auth/callback";

const BUWANA_SCOPE = process.env.BUWANA_SCOPE || "openid profile email";

// If you know exact issuer string, set it. Otherwise leave blank to skip issuer check.
const BUWANA_ISSUER = process.env.BUWANA_ISSUER || "";

// Where to send the user after login
const POST_LOGIN_REDIRECT = process.env.POST_LOGIN_REDIRECT || "https://air2.earthen.io/";

// ------------------------
// Small helpers
// ------------------------
function b64url(buf) {
    return Buffer.from(buf)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function sha256Base64Url(str) {
    const h = crypto.createHash("sha256").update(str).digest();
    return b64url(h);
}

function randomString(lenBytes = 32) {
    return b64url(crypto.randomBytes(lenBytes));
}

async function exchangeCodeForTokens({ code, codeVerifier }) {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("client_id", BUWANA_CLIENT_ID);
    body.set("redirect_uri", BUWANA_REDIRECT_URI);
    body.set("code", code);
    body.set("code_verifier", codeVerifier);

    // Some OAuth servers require client_secret even with PKCE.
    if (BUWANA_CLIENT_SECRET) {
        body.set("client_secret", BUWANA_CLIENT_SECRET);
    }

    const r = await fetch(BUWANA_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: body.toString(),
    });

    const text = await r.text();

    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(
            `Token endpoint did not return JSON. token_url=${BUWANA_TOKEN_URL} status=${r.status} body=${text.slice(
                0,
                200
            )}`
        );
    }

    if (!r.ok) {
        throw new Error(
            `Token exchange failed. token_url=${BUWANA_TOKEN_URL} status=${r.status} body=${text.slice(0, 400)}`
        );
    }

    return json;
}

async function verifyIdToken(idToken) {
    const jwks = createRemoteJWKSet(new URL(BUWANA_JWKS_URI));
    const opts = { audience: BUWANA_CLIENT_ID };
    if (BUWANA_ISSUER) opts.issuer = BUWANA_ISSUER;

    const { payload } = await jwtVerify(idToken, jwks, opts);
    return payload;
}

// ------------------------
// Router
// ------------------------
export function authRouter(pool) {
    const router = express.Router();

    // Start PKCE login
    router.get("/login", (req, res) => {
        const codeVerifier = randomString(48);
        const codeChallenge = sha256Base64Url(codeVerifier);
        const state = randomString(24);
        const nonce = randomString(24);

        req.session.buwana = {
            codeVerifier,
            state,
            nonce,
            createdAt: Date.now(),
        };

        const url = new URL(BUWANA_AUTHORIZE_URL);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", BUWANA_CLIENT_ID);
        url.searchParams.set("redirect_uri", BUWANA_REDIRECT_URI);
        url.searchParams.set("scope", BUWANA_SCOPE);
        url.searchParams.set("state", state);
        url.searchParams.set("nonce", nonce);
        url.searchParams.set("code_challenge", codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");

        return res.redirect(url.toString());
    });

    // Handle callback
    router.get("/callback", async (req, res) => {
        try {
            const { code, state, error, error_description } = req.query;

            if (error) {
                return res
                    .status(400)
                    .type("text")
                    .send(`buwana_error: ${error}${error_description ? ` (${error_description})` : ""}`);
            }

            if (!code || !state) {
                return res.status(400).type("text").send("missing_code_or_state");
            }

            const sess = req.session.buwana;
            if (!sess?.codeVerifier || !sess?.state) {
                return res.status(400).type("text").send("missing_session_state");
            }

            if (String(state) !== String(sess.state)) {
                return res.status(400).type("text").send("state_mismatch");
            }

            // Exchange code for tokens
            const tokenJson = await exchangeCodeForTokens({
                code: String(code),
                codeVerifier: sess.codeVerifier,
            });

            const idToken = tokenJson.id_token;
            if (!idToken) return res.status(400).type("text").send("missing_id_token");

            // Verify the ID token
            const claims = await verifyIdToken(idToken);

            // Nonce check (only if token includes nonce)
            if (claims.nonce && sess.nonce && String(claims.nonce) !== String(sess.nonce)) {
                return res.status(400).type("text").send("nonce_mismatch");
            }

            // ✅ IMPORTANT:
            // In your system:
            // - sub = open_id (string)  -> store as buwana_sub
            // - buwana_id = numeric     -> store if present
            const user = {
                buwana_sub: claims.sub ? String(claims.sub) : null,
                buwana_id: claims.buwana_id != null ? Number(claims.buwana_id) : null,
                email: claims.email || null,
                full_name: claims.name || claims.full_name || null,
                first_name: claims.given_name || claims.first_name || null,
                last_name: claims.family_name || claims.last_name || null,
                picture: claims.picture || null,
            };

            if (!user.buwana_sub) {
                return res.status(400).type("text").send("missing_sub");
            }

            // Save to session
            req.session.user = user;
            delete req.session.buwana;

            // Optional DB upsert (adapt columns to your AB_db schema)
            // Your AB_db users_tb: user_id PK, buwana_sub UNIQUE, buwana_id optional, email, first_name, last_name, full_name, created_at.
            try {
                await pool.query(
                    `
                        INSERT INTO users_tb (buwana_sub, buwana_id, email, first_name, last_name, full_name)
                        VALUES (?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE
                                                 buwana_id = VALUES(buwana_id),
                                                 email = VALUES(email),
                                                 first_name = VALUES(first_name),
                                                 last_name = VALUES(last_name),
                                                 full_name = VALUES(full_name)
                    `,
                    [
                        user.buwana_sub,
                        user.buwana_id,
                        user.email,
                        user.first_name || "",
                        user.last_name,
                        user.full_name || "",
                    ]
                );
            } catch (e) {
                // log but do not fail login
                console.error("[auth] users_tb upsert failed:", e?.code || e?.message || e);
            }

            return res.redirect(POST_LOGIN_REDIRECT);
        } catch (e) {
            console.error("auth callback error:", e && (e.stack || e.message || e));
            return res.status(500).type("text").send("auth_callback_failed");
        }
    });

    // Who am I? (canonical)
    router.get("/me", (req, res) => {
        const u = req.session?.user;
        if (!u) return res.status(401).json({ ok: false, error: "unauthorized" });
        return res.json({ ok: true, user: u });
    });

    // ✅ Alias so your frontend can just call /api/me
    // (mounting detail: server.js mounts this router at /api/auth,
    // but we also want /api/me globally, so we expose it here for server.js to mount too if desired)
    router.get("/__me_alias", (req, res) => {
        const u = req.session?.user;
        if (!u) return res.status(401).json({ ok: false, error: "unauthorized" });
        return res.json({ ok: true, user: u });
    });

    // Logout
    router.post("/logout", (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ ok: false, error: "logout_failed" });
            res.clearCookie(process.env.SESSION_COOKIE_NAME || "airbuddy_sid");
            return res.json({ ok: true });
        });
    });

    return router;
}