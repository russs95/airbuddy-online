// public/co2.js
(function () {
    "use strict";

    const Core = window.AirBuddyChartCore;
    if (!Core) return;

    const RANGES = Core.DEFAULT_RANGES_HOURS;

    function boot() {
        const canvas = document.getElementById("trend-eco2");
        const select = document.getElementById("range-select");
        if (!canvas || !select) return;

        const timestamps = Core.readJSONAttr(canvas, "data-timestamps", []);
        const eco2 = Core.readJSONAttr(canvas, "data-eco2s", []);

        function redraw() {
            Core.drawTimeSeriesChart({
                canvas,
                rangeKey: select.value,
                rangesHours: RANGES,
                maxGapS: 240,
                timestamps,
                series: [
                    {
                        name: "eCO₂",
                        color: "#6a1b9a",
                        values: eco2,
                        width: 2,
                        pointRadius: 3
                    }
                ],
                yLabelFmt: (v) => v.toFixed(0) + " ppm",
                showLegend: true
            });
        }

        select.addEventListener("change", redraw);
        window.addEventListener("resize", redraw);

        redraw();
    }

    boot();
})();