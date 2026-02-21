// public/chart.js
(function () {
    // -------------------------------------------------
    // Configurable time ranges (hours)
    // -------------------------------------------------
    const RANGES = {
        "1h": 1,
        "6h": 6,
        "24h": 24,
        "72h": 72,
        "7d": 24 * 7,
        "30d": 24 * 30,
    };

    // Break line + show marker if readings are too far apart
    const MAX_GAP_S = 240; // 4 minutes

    // -------------------------------------------------
    // Helpers
    // -------------------------------------------------
    function readJSONAttr(canvas, name) {
        const raw = canvas.getAttribute(name);
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }

    function niceStep(targetStep) {
        if (!Number.isFinite(targetStep) || targetStep <= 0) return 1;
        const pow = Math.pow(10, Math.floor(Math.log10(targetStep)));
        const base = targetStep / pow;
        let nice;
        if (base <= 1) nice = 1;
        else if (base <= 2) nice = 2;
        else if (base <= 5) nice = 5;
        else nice = 10;
        return nice * pow;
    }

    function niceBounds(minV, maxV, ticks) {
        if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return { min: 0, max: 1, step: 1 };

        if (minV === maxV) {
            const pad = minV === 0 ? 1 : Math.abs(minV) * 0.1;
            minV -= pad;
            maxV += pad;
        }

        const span = maxV - minV;
        const rawStep = span / Math.max(1, ticks - 1);
        const step = niceStep(rawStep);

        return {
            min: Math.floor(minV / step) * step,
            max: Math.ceil(maxV / step) * step,
            step,
        };
    }

    function formatTime(ts) {
        const d = new Date(ts * 1000);
        return d.toLocaleString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "short",
        });
    }

    function isFiniteNumber(x) {
        const n = Number(x);
        return Number.isFinite(n) ? n : null;
    }

    // -------------------------------------------------
    // Drawing helpers
    // -------------------------------------------------
    function drawGapMarker(ctx, x, padT, plotH) {
        // faint vertical marker line
        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // tiny label near bottom
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.font = '11px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';
        ctx.fillText("stopped", x + 4, padT + plotH - 6);
        ctx.restore();
    }

    function drawSeriesWithGaps(ctx, data, xMap, yMap, color, maxGapS) {
        // data: [{t, v}] sorted by t asc
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        let prevT = null;
        let pathOpen = false;

        for (const d of data) {
            const x = xMap(d.t);
            const y = yMap(d.v);

            const gapTooBig = prevT != null && (d.t - prevT) > maxGapS;

            if (!pathOpen || gapTooBig) {
                if (pathOpen) ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, y);
                pathOpen = true;
            } else {
                ctx.lineTo(x, y);
            }

            prevT = d.t;
        }

        if (pathOpen) ctx.stroke();
        ctx.restore();
    }

    function drawPoints(ctx, data, xMap, yMap, color) {
        ctx.save();
        ctx.fillStyle = color;
        for (const d of data) {
            const x = xMap(d.t);
            const y = yMap(d.v);
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawLegend(ctx, padL, padT, plotW) {
        // top-right inside plot
        const x = padL + plotW - 8;
        let y = padT + 6;

        ctx.save();
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.font = '12px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';

        ctx.fillStyle = "#c62828";
        ctx.fillText("Temp", x, y);
        y += 14;

        ctx.fillStyle = "#2e7d32";
        ctx.fillText("RTC", x, y);

        ctx.restore();
    }

    // -------------------------------------------------
    // Draw Temperature + RTC Temperature Chart
    // -------------------------------------------------
    function drawChart(canvas, timestamps, temps, rtcTemps, rangeKey) {
        const ctx = canvas.getContext("2d");
        const hours = RANGES[rangeKey] || 24;

        const now = Math.floor(Date.now() / 1000);
        const cutoff = now - hours * 3600;

        // Build base reading timeline (for gap markers)
        // Any reading with at least one value counts as "a telemetry reading"
        const readings = [];
        const tempData = [];
        const rtcData = [];

        for (let i = 0; i < timestamps.length; i++) {
            const t = isFiniteNumber(timestamps[i]);
            if (t == null) continue;
            if (t < cutoff || t > now) continue;

            const tv = isFiniteNumber(temps[i]);
            const rv = isFiniteNumber(rtcTemps[i]);

            if (tv != null) tempData.push({ t, v: tv });
            if (rv != null) rtcData.push({ t, v: rv });

            if (tv != null || rv != null) readings.push({ t });
        }

        // Setup canvas scaling (always)
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const W = rect.width;
        const H = rect.height;

        ctx.clearRect(0, 0, W, H);

        if (!readings.length) {
            ctx.fillStyle = "#666";
            ctx.font = '12px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';
            ctx.fillText("No data in range", 10, 20);
            return;
        }

        // Layout
        const padL = 60;
        const padR = 20;
        const padT = 20;
        const padB = 50;

        const plotW = W - padL - padR;
        const plotH = H - padT - padB;

        // X scale is time
        const minT = cutoff;
        const maxT = now;

        const xMap = (t) => padL + ((t - minT) / (maxT - minT)) * plotW;

        // Y bounds computed across BOTH series values (so they share axis)
        const allVals = [];
        for (const d of tempData) allVals.push(d.v);
        for (const d of rtcData) allVals.push(d.v);

        const minV = allVals.length ? Math.min(...allVals) : 0;
        const maxV = allVals.length ? Math.max(...allVals) : 1;
        const yBounds = niceBounds(minV, maxV, 5);

        const yMap = (v) =>
            padT + (1 - (v - yBounds.min) / (yBounds.max - yBounds.min)) * plotH;

        // Grid
        ctx.strokeStyle = "#eee";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
            const y = padT + (i / 4) * plotH;
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + plotW, y);
        }
        ctx.stroke();

        // Axes
        ctx.strokeStyle = "#ccc";
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, padT + plotH);
        ctx.lineTo(padL + plotW, padT + plotH);
        ctx.stroke();

        // Y labels
        ctx.fillStyle = "#666";
        ctx.font = '12px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';
        for (let i = 0; i <= 4; i++) {
            const v = yBounds.max - (i / 4) * (yBounds.max - yBounds.min);
            const y = padT + (i / 4) * plotH;
            ctx.fillText(v.toFixed(1) + "°C", 8, y + 4);
        }

        // Time labels (start/mid/end)
        const mid = Math.floor((minT + maxT) / 2);
        ctx.fillStyle = "#777";
        ctx.fillText(formatTime(minT), padL, padT + plotH + 25);
        ctx.fillText(formatTime(mid), padL + plotW / 2 - 40, padT + plotH + 25);
        ctx.fillText(formatTime(maxT), padL + plotW - 80, padT + plotH + 25);

        // Gap markers: based on actual telemetry reading timestamps
        readings.sort((a, b) => a.t - b.t);
        let prevT = null;
        for (const r of readings) {
            if (prevT != null && (r.t - prevT) > MAX_GAP_S) {
                // Marker at the GAP START (the last known good reading time)
                const x = xMap(prevT);
                drawGapMarker(ctx, x, padT, plotH);
            }
            prevT = r.t;
        }

        // Lines (break on gaps) + points
        // Temp
        tempData.sort((a, b) => a.t - b.t);
        drawSeriesWithGaps(ctx, tempData, xMap, yMap, "#c62828", MAX_GAP_S);
        drawPoints(ctx, tempData, xMap, yMap, "#c62828");

        // RTC Temp
        rtcData.sort((a, b) => a.t - b.t);
        drawSeriesWithGaps(ctx, rtcData, xMap, yMap, "#2e7d32", MAX_GAP_S);
        drawPoints(ctx, rtcData, xMap, yMap, "#2e7d32");

        // Legend
        drawLegend(ctx, padL, padT, plotW);
    }

    // -------------------------------------------------
    // Boot
    // -------------------------------------------------
    function boot() {
        const canvas = document.getElementById("trend-temp");
        const select = document.getElementById("range-select");
        if (!canvas || !select) return;

        const timestamps = readJSONAttr(canvas, "data-timestamps");
        const temps = readJSONAttr(canvas, "data-temps");
        const rtcTemps = readJSONAttr(canvas, "data-rtc-temps");

        function redraw() {
            drawChart(canvas, timestamps, temps, rtcTemps, select.value);
        }

        select.addEventListener("change", redraw);
        window.addEventListener("resize", redraw);

        redraw();
    }

    boot();
})();