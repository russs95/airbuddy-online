// public/tvoc.js
(function () {
    "use strict";

    const Core = window.AirBuddyChartCore;
    if (!Core) return;

    const RANGES = Core.DEFAULT_RANGES_HOURS;

    function boot() {
        const canvas = document.getElementById("trend-tvoc");
        const select = document.getElementById("range-select");
        if (!canvas || !select) return;

        const timestamps = Core.readJSONAttr(canvas, "data-timestamps", []);
        const tvoc = Core.readJSONAttr(canvas, "data-tvocs", []);

        function redraw() {
            Core.drawTimeSeriesChart({
                canvas,
                rangeKey: select.value,
                rangesHours: RANGES,
                maxGapS: 240,
                timestamps,
                series: [
                    {
                        name: "TVOC",
                        color: "#ef6c00",
                        values: tvoc,
                        width: 2,
                        pointRadius: 3
                    }
                ],
                yLabelFmt: (v) => v.toFixed(0) + " ppb",
                showLegend: true
            });
        }

        select.addEventListener("change", redraw);
        window.addEventListener("resize", redraw);

        redraw();
    }

    boot();
})();