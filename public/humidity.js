// public/humidity.js
(function () {
"use strict";

const Core = window.AirBuddyChartCore;
if (!Core) return;

const RANGES = Core.DEFAULT_RANGES_HOURS;

function boot() {
    const canvas = document.getElementById("trend-rh");
const select = document.getElementById("range-select");
if (!canvas || !select) return;

const timestamps = Core.readJSONAttr(canvas, "data-timestamps", []);
const rhs = Core.readJSONAttr(canvas, "data-rhs", []);

function redraw() {
    Core.drawTimeSeriesChart({
        canvas,
        rangeKey: select.value,
    rangesHours: RANGES,
    maxGapS: 240,
    timestamps,
series: [
    {
        name: "Humidity",
        color: "#1565c0",
        values: rhs,
        width: 2,
        pointRadius: 3
    }
],
yLabelFmt: (v) => v.toFixed(1) + " %",
showLegend: true
});
}

select.addEventListener("change", redraw);
window.addEventListener("resize", redraw);

redraw();
}

boot();
})();