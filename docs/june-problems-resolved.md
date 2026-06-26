# June 2026 — Problems Resolved

---

## ECharts x-axis label overlap on mobile

**Symptom:** On narrow screens (< ~480 px) the time labels on the x-axis of ECharts trend
charts all pile into one overlapping line of text, making them illegible.

**Root cause:** The label formatter was returning `"12 Jun 14:00"` style strings for ranges
≥ 24 h. These strings are wide enough that ECharts places far fewer ticks than it can
actually fit, and the leftover ticks collide.

**Fix (two-part — apply both):**

### 1. `hideOverlap: true` on `axisLabel`

Tells ECharts 5 to automatically hide any label that would overlap the previous one.
Acts as a safe backstop regardless of screen width.

```js
xAxis: {
  type: 'time',
  axisLabel: {
    hideOverlap: true,   // ← add this
    formatter: ...
  }
}
```

### 2. Responsive formatter — drop the date portion on narrow screens

For sub-7d ranges on narrow viewports (< 480 px), emit only `HH:mm` instead of
`"12 Jun 14:00"`. The date context is less critical when the user can see the range
selector, and the shorter string leaves room for more ticks.

```js
formatter: (val) => {
  const hours = RANGE_HOURS[range] ?? 1;   // RANGE_HOURS maps range key → hours
  const narrow = window.innerWidth < 480;

  if (hours >= 168) return fmtAxisDay.format(new Date(val));     // "12 Jun"
  if (hours >= 24)  return narrow
    ? fmtAxisTime.format(new Date(val))                           // "14:00"
    : fmtAxisDayTime.format(new Date(val));                       // "12 Jun 14:00"
  return fmtAxisTime.format(new Date(val));                       // "14:00"  (already short)
}
```

Where the formatters are (example using `Intl.DateTimeFormat`, `en-GB`, `hour12: false`):

```js
const timeFmt = (opts) => new Intl.DateTimeFormat('en-GB', { hour12: false, ...opts });
const fmtAxisTime    = timeFmt({ hour: '2-digit', minute: '2-digit' });
const fmtAxisDay     = timeFmt({ month: 'short', day: 'numeric' });
const fmtAxisDayTime = timeFmt({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
```

**Applied in:** `hopeTurtles.org/public/js/myturtle.js` — `makeTrendChart()` → `render()` → `xAxis.axisLabel`.

**To apply to airbuddy-spa:** The equivalent location is
`airbuddy-spa/app/components/charts/AirTrendChart.vue`. The chart option builder
there uses the same ECharts `xAxis` shape — add `hideOverlap: true` and wrap the
formatter's `hours >= 24` branch in the same `narrow` check.

**✅ Resolved in airbuddy-spa (2026-06-26):** `app/components/charts/AirTrendChart.vue`
— added `hideOverlap: true` to `xAxis.axisLabel` and gated the `hours >= 24` branch
behind `const narrow = typeof window !== 'undefined' && window.innerWidth < 480`
(the `typeof window` guard keeps it safe even though the chart is client-only).

---

## OpenStreetMap tile 403 — "Referrer is required"

**Symptom:** Leaflet map panel shows no tiles; browser console logs a 403 from
`tile.openstreetmap.org` with the message _"Access blocked — Referrer is required
by tile usage policy of OpenStreetMap's volunteer-run servers"_.

**Root cause:** [Helmet](https://helmetjs.github.io/) (the Express security middleware)
sets a `Referrer-Policy: no-referrer` HTTP header by default. This instructs the
browser to omit the `Referer` header on all cross-origin requests — including the
image requests Leaflet makes to `tile.openstreetmap.org`. OSM's tile servers
enforce a usage policy that requires a valid `Referer` header to identify the
calling application, so they return 403 when it is absent.

**Fix:** Override Helmet's default `referrerPolicy` to `strict-origin-when-cross-origin`.
This policy sends the bare origin (`https://your-domain.com`) as `Referer` on
cross-origin HTTPS→HTTPS requests (satisfying OSM) while still suppressing it on
protocol downgrades.

```js
// server.js (or wherever Helmet is configured)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  })
);
```

**Applied in:** `hopeTurtles.org/server.js`.

**To apply to airbuddy-spa / any other Express app:** Find the `helmet({...})` call
and add the `referrerPolicy` line above. If the app uses a different framework or
sets headers manually, add:

```
Referrer-Policy: strict-origin-when-cross-origin
```

as an HTTP response header (nginx: `add_header Referrer-Policy "strict-origin-when-cross-origin";`).

**Note:** This fix applies to any third-party tile provider that enforces a Referer
check (OSM, Stadia, etc.). Mapbox tiles do not require a Referer — they authenticate
via the access token in the URL — so this issue would not occur if you switch to
Mapbox.

**✅ Resolved in airbuddy-online (2026-06-26):** added
`referrerPolicy: { policy: "strict-origin-when-cross-origin" }` to the existing
`helmet({...})` call in `src/server.js` (kept the repo's real CSP config — did not
copy the doc example's `contentSecurityPolicy: false`).

**✅ Resolved in airbuddy-spa (2026-06-26):** the SPA is `ssr: false` with no Helmet
layer, so the equivalent is a document-level referrer policy. Added
`<meta name="referrer" content="strict-origin-when-cross-origin">` via
`app.head.meta` in `nuxt.config.ts`. `app/components/LocationMap.vue` loads OSM tiles
directly, so this guarantees a valid `Referer` regardless of the serving layer.

---

## Latest Packets panel — hide checkboxes behind "Manage Telemetry"

**Symptom:** The checkbox column appears in the packets table on page load, cluttering
the view for users who only want to read data and never bulk-delete.

**Fix:** Three coordinated changes:

### 1. CSS — hide `.check-cell` by default; reveal via a manage-mode class

```css
/* myturtle.css */
.check-cell {
  width: 36px;
  text-align: center;
  display: none;                       /* hidden by default */
}

#packets.packets-manage-mode .check-cell {
  display: table-cell;                 /* shown only when managing */
}
```

The `#packets` scoping means the rule only fires when the packets section itself
has the `packets-manage-mode` class, so no other table on the page is affected.

### 2. HTML — add "Manage Telemetry" button; replace `‹`/`›` text with FA icons

```html
<!-- pagination-bar, inside #packets -->
<div class="pagination-bar">
  <button class="button ghost" type="button" data-manage-telemetry>Manage Telemetry</button>
  <button class="button ghost" type="button" data-page-prev>
    <i class="fa-solid fa-chevron-left"></i> Prev
  </button>
  <span class="pagination-info tiny muted" data-page-info></span>
  <button class="button ghost" type="button" data-page-next>
    Next <i class="fa-solid fa-chevron-right"></i>
  </button>
  ...
</div>
```

`fa-solid fa-chevron-left` / `fa-chevron-right` are free in Font Awesome 6 (available
via Kit or CDN).

### 3. JS — toggle `packets-manage-mode`; clear selection on exit

```js
const manageTelemetryBtn = packetsSection.querySelector('[data-manage-telemetry]');

manageTelemetryBtn.addEventListener('click', () => {
  const managing = packetsSection.classList.toggle('packets-manage-mode');
  manageTelemetryBtn.textContent = managing ? 'Done' : 'Manage Telemetry';
  if (!managing) {
    selectedPacketIds.clear();   // drop checked state
    renderPackets();             // re-render clears bulk-actions bar via updateBulkUi()
  }
});
```

**Applied in:** `hopeTurtles.org/public/js/myturtle.js`,
`hopeTurtles.org/public/css/myturtle.css`,
`hopeTurtles.org/views/myturtle.ejs`.

**To apply to airbuddy-spa:** Same pattern — add `display: none` to the checkbox
column by default, scope the reveal to a manage-mode class toggled by a button in
the pagination row, and clear selections when the mode is exited.

**✅ Resolved in airbuddy-spa (2026-06-26):** `app/pages/dashboard.vue` —
- CSS: `.checkCell { display: none }` by default; revealed via
  `.packetTable.packets-manage-mode .checkCell { display: table-cell }`.
- Template: bound `:class="{ 'packets-manage-mode': packetsManageMode }"` on the
  `.packetTable`, and added a "Manage Telemetry" / "Done" toggle button in the
  `.paginationBar`.
- Script: `packetsManageMode` ref + `toggleManageMode()`, which calls the existing
  `clearSelection()` on exit so the bulk-actions bar disappears too.
- Note: the doc's FontAwesome chevron swap was **not** ported in this change — the
  SPA kept its text `‹`/`›` chevrons. (FontAwesome was later added to the SPA via a
  shared Kit script in `nuxt.config.ts` for the profile page work, so the icons are
  now available if a future change wants them.)

---

## FontAwesome — shared Kit added to airbuddy-spa

**✅ Resolved in airbuddy-spa (2026-06-26):** ported the FontAwesome Kit used on
hopeturtles.org (`https://kit.fontawesome.com/735e38ff98.js`, same account) into
`airbuddy-spa/nuxt.config.ts` via `app.head.script`. This enables the
`fa-solid fa-*` icon classes (matching hopeturtles) across the SPA — primarily for
the forthcoming profile page, which reuses hopeturtles' icon set.

**Deployment note:** if the SPA is served behind an nginx CSP, add
`kit.fontawesome.com` to `script-src` and `ka-f.fontawesome.com` to
`connect-src`/`font-src` so the Kit loader and its webfonts/SVGs are not blocked.
