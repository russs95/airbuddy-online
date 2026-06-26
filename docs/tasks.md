# AirBuddy — Upcoming Tasks

Running list of planned follow-up work. Newest at top.

---

## Profile page: silent refresh-token flow

**Status:** planned (v1 ships with a re-login prompt instead).

### Context
The profile page (`/profile` in airbuddy-spa, backed by `/api/profile` in
airbuddy-online) reads and writes the user's Buwana account server-to-server using
the OAuth **access token** captured at login. As of 2026-06-26 that token is stored
in the session:

```js
// src/routes/auth.js — OAuth callback
req.session.tokens = {
  accessToken:  tokenJson.access_token  || null,
  refreshToken: tokenJson.refresh_token || null,   // ← captured but not yet used
  expiresAt:    tokenJson.expires_in ? Date.now() + expires_in * 1000 : null,
};
```

Access tokens are short-lived. **v1 behaviour:** when Buwana returns `401`, the
profile API responds `{ ok: false, error: "token_expired" }` and the SPA shows a
"your session expired — please log in again" message. Functional, but the user has
to manually re-authenticate.

### Goal
Use the stored `refresh_token` to transparently mint a fresh access token when the
current one is expired/near-expiry, so profile reads/writes succeed without a
visible re-login.

### Implementation sketch (airbuddy-online)
1. **Add a token-refresh helper** in `src/routes/auth.js` (or a new
   `src/utils/buwanaTokens.js`):
   ```js
   // POST BUWANA_TOKEN_URL with grant_type=refresh_token
   //   client_id, refresh_token, (client_secret if configured)
   // → { access_token, refresh_token?, expires_in }
   async function refreshAccessToken(refreshToken) { ... }
   ```
2. **Add `ensureFreshToken(req)`** middleware/helper:
   - If `req.session.tokens.expiresAt` is missing or within ~60s of now, call
     `refreshAccessToken(req.session.tokens.refreshToken)`.
   - Persist the new `accessToken` / `refreshToken` / `expiresAt` back to the
     session. Buwana may rotate refresh tokens — always store the returned one.
   - On refresh failure (revoked / expired refresh token), clear
     `req.session.tokens` and surface `token_expired` so the SPA falls back to the
     existing re-login prompt.
3. **Wire it into the profile routes** (`src/routes/profile.js`): call
   `ensureFreshToken(req)` before each Buwana call; keep the `401 → token_expired`
   path as the final fallback.
4. **Confirm scope** — the authorize request must include `offline_access` (or the
   Buwana equivalent) for a refresh token to be issued. Verify `BUWANA_SCOPE`
   actually yields `refresh_token` in the callback; if not, add the scope.

### Acceptance
- A user idle past the access-token lifetime can still open `/profile` and save an
  edit without re-logging in.
- A revoked/expired refresh token degrades gracefully to the v1 re-login prompt.

---

## Deployment notes for the profile feature (do on rollout)

- **Env var:** set `BUWANA_API_URL` (defaults to `https://buwana.ecobricks.org`) in
  airbuddy-online if the profile API host ever differs.
- **CSP / nginx (airbuddy-spa):** the SPA now loads the FontAwesome Kit and calls
  Nominatim directly from the browser. If a CSP is enforced at the edge, allow:
  - `script-src`  → `https://kit.fontawesome.com`
  - `connect-src` → `https://ka-f.fontawesome.com`, `https://nominatim.openstreetmap.org`
  - `font-src`    → `https://ka-f.fontawesome.com`
- **Nominatim usage policy:** browser-side geocoding from the profile editor is
  debounced (300ms, ≥3 chars). If volume grows, consider proxying through
  airbuddy-online with a descriptive `User-Agent`, per OSM's usage policy.
