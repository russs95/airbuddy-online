// src/routes/auth.js
import express from "express";
import crypto from "crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";

// Buwana config (from your message)
const BUWANA_CLIENT_ID = process.env.BUWANA_CLIENT_ID || "airb_ca090536efc8";
const BUWANA_AUTHORIZE_URL = process.env.BUWANA_AUTHORIZE_URL || "https://buwana.ecobricks.org/authorize.php";
const BUWANA_TOKEN_URL = process.env.BUWANA_TOKEN_URL || "https://buwana.ecobricks.org/token.php";
const BUWANA_JWKS_URI = process.env.BUWANA_JWKS_URI || "https://buwana.ecobricks.org/well-known/jwks.php";
const BUWANA_REDIRECT_URI =
    process.env.BUWANA_REDIRECT_URI || "https://air2.earthen.io/api/auth/callback";

// Scope: keep minimal unless you know extra Buwana scopes you want
const BUWANA_SCOPE = process.env.BUWANA_SCOPE || "openid profile email";

// Optional: issuer check. If you know Buwana’s `iss` claim value, set it.
// Example: BUWANA_ISSUER="https://buwana.ecobricks.org/"
const BUWANA_ISSUER = process.env.BUWANA_ISSUER || "";

// Where to send the user after login
const POST_LOGIN_REDIRECT = process.env.POST_LOGIN_REDIRECT || "https://air2.earthen.io/";

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

function parseBuwanaId(sub) {
    // Accept numeric sub, or strings that contain a numeric id
    if (sub == null) return null;
    const s = String(sub);
    if (/^\d+$/.test(s)) return Number(s);
    const m = s.match(/(\d+)/);
    return m ? Number(m[1]) : null;
}

async function exchangeCodeForTokens({ code, codeVerifier }) {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("client_id", BUWANA_CLIENT_ID);
    body.set("redirect_uri", BUWANA_REDIRECT_URI);
    body.set("code", code);
    body.set("code_verifier", codeVerifier);

    const r = await fetch(BUWANA_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        body: body.toString(),
    });

    const text = await r.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(`Token endpoint did not return JSON. status=${r.status} body=${text.slice(0, 200)}`);
    }

    if (!r.ok) {
        throw new Error(`Token exchange failed. status=${r.status} body=${text.slice(0, 300)}`);
    }

    return json;
}

async function verifyIdToken(idToken) {
    const jwks = createRemoteJWKSet(new URL(BUWANA_JWKS_URI));
    const opts = {
        audience: BUWANA_CLIENT_ID,
    };
    if (BUWANA_ISSUER) opts.issuer = BUWANA_ISSUER;

    const { payload } = await jwtVerify(idToken, jwks, opts);
    return payload;
}

export function authRouter(pool) {
    const router = express.Router();

    // Start PKCE login
    router.get("/login", (req, res) => {
        const codeVerifier = randomString(48);
        const codeChallenge = sha256Base64Url(codeVerifier);
        const state = randomString(24);
        const nonce = randomString(24);

        // Store transient secrets in session
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

        res.redirect(url.toString());
    });

    // Handle callback
    router.get("/callback", async (req, res) => {
        try {
            const { code, state, error, error_description } = req.query;

            if (error) {
                return res
                    .status(400)
                    .type("text")
                    .send(`buwana_error: ${error} ${error_description ? `(${error_description})` : ""}`);
            }

            if (!code || !state) {
                return res.status(400).type("text").send("missing_code_or_state");
            }

            const sess = req.session.buwana;
            if (!sess || !sess.codeVerifier || !sess.state) {
                return res.status(400).type("text").send("missing_session_state");
            }

            if (String(state) !== String(sess.state)) {
                return res.status(400).type("text").send("state_mismatch");
            }

            // Exchange code for tokens (PKCE)
            const tokenJson = await exchangeCodeForTokens({
                code: String(code),
                codeVerifier: sess.codeVerifier,
            });

            const idToken = tokenJson.id_token;
            if (!idToken) {
                return res.status(400).type("text").send("missing_id_token");
            }

            // Verify JWT against JWKS (audience = client_id)
            const claims = await verifyIdToken(idToken);

            // Optional nonce check (if token includes nonce)
            if (claims.nonce && sess.nonce && String(claims.nonce) !== String(sess.nonce)) {
                return res.status(400).type("text").send("nonce_mismatch");
            }

            const buwanaId = parseBuwanaId(claims.sub);
            if (!buwanaId) {
                return res.status(400).type("text").send("invalid_sub_no_buwana_id");
            }

            const user = {
                buwana_id: buwanaId,
                email: claims.email || null,
                full_name: claims.name || claims.full_name || null,
                given_name: claims.given_name || null,
                family_name: claims.family_name || null,
                picture: claims.picture || null,
                // keep tokenJson off-session unless you explicitly need it
            };

            // Save user into session
            req.session.user = user;

            // Clear transient PKCE data
            delete req.session.buwana;

            // Optional: upsert into users_tb if it exists.
            // If you haven't created users_tb yet, this will fail and we ignore it.
            try {
                await pool.query(
                    `
          INSERT INTO users_tb (buwana_id, email, full_name, created_at, updated_at)
          VALUES (?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            email = VALUES(email),
            full_name = VALUES(full_name),
            updated_at = NOW()
          `,
                    [user.buwana_id, user.email, user.full_name]
                );
            } catch {
                // ignore for now — we can add users_tb properly when you’re ready
            }

            return res.redirect(POST_LOGIN_REDIRECT);
        } catch (e) {
            console.error("auth callback error:", e && (e.stack || e.message || e));
            return res.status(500).type("text").send("auth_callback_failed");
        }
    });

    // Who am I?
    router.get("/me", (req, res) => {
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