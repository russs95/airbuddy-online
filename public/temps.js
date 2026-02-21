// public/temps.js
(function () {
"use strict";

const Core = window.AirBuddyChartCore;
if (!Core) return;

// If you ever want to override range options just for temperature, do it here.
const RANGES = Core.DEFAULT_RANGES_HOURS;

function boot() {
    const canvas = document.getElementById("trend-temp");
const select = document.getElementById("range-select");
if (!canvas || !select) return;

const timestamps = Core.readJSONAttr(canvas, "data-timestamps", []);
const temps = Core.readJSONAttr(canvas, "data-temps", []);
const rtcTemps = Core.readJSONAttr(canvas, "data-rtc-temps", []);

function redraw() {
    Core.drawTimeSeriesChart({
        canvas,
        rangeKey: select.value,
    rangesHours: RANGES,
    maxGapS: 240,
    timestamps,
series: [
    { name: "Temp", color: "#c62828", values: temps, width: 2, pointRadius: 3 },
    { name: "RTC", color: "#2e7d32", values: rtcTemps, width: 2, pointRadius: 3 },
],
yLabelFmt: (v) => v.toFixed(1) + "°C",
showLegend: true,
});
}

select.addEventListener("change", redraw);

// One resize handler (guarded)
if (!window.__airbuddyTempsResizeBound) {
window.__airbuddyTempsResizeBound = true;
window.addEventListener("resize", redraw);
}

redraw();
}

boot();
})();