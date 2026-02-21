// public/chart_core.js
(function () {
    "use strict";

    // -------------------------------------------------
    // Core config
    // -------------------------------------------------
    const DEFAULT_RANGES_HOURS = {
        "1h": 1,
        "6h": 6,
        "24h": 24,
        "72h": 72,
        "7d": 24 * 7,
        "30d": 24 * 30,
    };

    // -------------------------------------------------
    // Small helpers
    // -------------------------------------------------
    function readJSONAttr(el, name, fallback) {
        const raw = el.getAttribute(name);
        if (!raw) return fallback ?? [];
        try {
            return JSON.parse(raw);
        } catch {
            return fallback ?? [];
        }
    }

    function toFiniteNumber(x) {
        const n = Number(x);
        return Number.isFinite(n) ? n : null;
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
        if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
            return { min: 0, max: 1, step: 1 };
        }

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

    function formatTime(tsSec) {
        const d = new Date(tsSec * 1000);
        return d.toLocaleString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "short",
        });
    }

    // -------------------------------------------------
    // Drawing primitives
    // -------------------------------------------------
    function setupCanvas(canvas) {
        const ctx = canvas.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));

        // Use CSS pixels for drawing
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        return { ctx, W: rect.width, H: rect.height };
    }

    function drawGapMarker(ctx, x, padT, plotH) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.font =
            '11px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';
        ctx.fillText("stopped", x + 4, padT + plotH - 6);
        ctx.restore();
    }

    function drawSeriesWithGaps(ctx, data, xMap, yMap, color, width, maxGapS) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width || 2;

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

    function drawPoints(ctx, data, xMap, yMap, color, radius) {
        ctx.save();
        ctx.fillStyle = color;
        const r = radius == null ? 3 : radius;

        for (const d of data) {
            const x = xMap(d.t);
            const y = yMap(d.v);
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    function drawLegend(ctx, padL, padT, plotW, seriesList) {
        const x = padL + plotW - 8;
        let y = padT + 6;

        ctx.save();
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.font =
            '12px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';

        for (const s of seriesList) {
            if (!s || !s.name) continue;
            ctx.fillStyle = s.color || "#000";
            ctx.fillText(String(s.name), x, y);
            y += 14;
        }

        ctx.restore();
    }

    // -------------------------------------------------
    // Public API: time-series chart with gaps + markers
    // -------------------------------------------------
    function drawTimeSeriesChart(opts) {
        const canvas = opts.canvas;
        if (!canvas) return;

        const ctx0 = canvas.getContext("2d");
        if (!ctx0) return;

        const ranges = opts.rangesHours || DEFAULT_RANGES_HOURS;
        const rangeKey = opts.rangeKey || "24h";
        const hours = ranges[rangeKey] || 24;

        const maxGapS = Number.isFinite(opts.maxGapS) ? opts.maxGapS : 240;

        const now = opts.nowUnixSec != null ? Math.floor(opts.nowUnixSec) : Math.floor(Date.now() / 1000);
        const cutoff = now - hours * 3600;

        // Build timeline + series data
        const timestamps = Array.isArray(opts.timestamps) ? opts.timestamps : [];
        const seriesList = Array.isArray(opts.series) ? opts.series : [];

        // Telemetry reading timestamps: any timestamp where ANY series has a value
        const readingTimes = [];

        // Build each series as [{t,v}]
        const builtSeries = seriesList.map((s) => ({
            name: s.name || "",
            color: s.color || "#000",
            width: s.width || 2,
            pointRadius: s.pointRadius == null ? 3 : s.pointRadius,
            data: [],
        }));

        for (let i = 0; i < timestamps.length; i++) {
            const t = toFiniteNumber(timestamps[i]);
            if (t == null) continue;
            if (t < cutoff || t > now) continue;

            let anyVal = false;

            for (let si = 0; si < seriesList.length; si++) {
                const rawArr = seriesList[si]?.values;
                const arr = Array.isArray(rawArr) ? rawArr : [];
                const v = toFiniteNumber(arr[i]);
                if (v == null) continue;

                builtSeries[si].data.push({ t, v });
                anyVal = true;
            }

            if (anyVal) readingTimes.push(t);
        }

        const { ctx, W, H } = setupCanvas(canvas);
        ctx.clearRect(0, 0, W, H);

        if (!readingTimes.length) {
            ctx.fillStyle = "#666";
            ctx.font =
                '12px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';
            ctx.fillText("No data in range", 10, 20);
            return;
        }

        // Layout
        const padL = 60;
        const padR = 20;
        const padT = 20;
        const padB = 50;

        const plotW = Math.max(1, W - padL - padR);
        const plotH = Math.max(1, H - padT - padB);

        // Scales
        const minT = cutoff;
        const maxT = now;
        const xMap = (t) => padL + ((t - minT) / (maxT - minT)) * plotW;

        // Y bounds from all series
        const allVals = [];
        for (const s of builtSeries) {
            for (const d of s.data) allVals.push(d.v);
        }
        const minV = allVals.length ? Math.min(...allVals) : 0;
        const maxV = allVals.length ? Math.max(...allVals) : 1;
        const yB = niceBounds(minV, maxV, 5);

        const yMap = (v) =>
            padT + (1 - (v - yB.min) / (yB.max - yB.min)) * plotH;

        // Grid (horizontal)
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
        ctx.font =
            '12px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';
        const yFmt = typeof opts.yLabelFmt === "function" ? opts.yLabelFmt : (v) => String(v);
        for (let i = 0; i <= 4; i++) {
            const v = yB.max - (i / 4) * (yB.max - yB.min);
            const y = padT + (i / 4) * plotH;
            ctx.fillText(String(yFmt(v)), 8, y + 4);
        }

        // Time labels (start/mid/end)
        const midT = Math.floor((minT + maxT) / 2);
        ctx.fillStyle = "#777";
        ctx.fillText(formatTime(minT), padL, padT + plotH + 25);
        ctx.fillText(formatTime(midT), padL + plotW / 2 - 40, padT + plotH + 25);
        ctx.fillText(formatTime(maxT), padL + plotW - 80, padT + plotH + 25);

        // Gap markers based on reading times
        readingTimes.sort((a, b) => a - b);
        let prevT = null;
        for (const t of readingTimes) {
            if (prevT != null && (t - prevT) > maxGapS) {
                // marker at gap start (prev)
                drawGapMarker(ctx, xMap(prevT), padT, plotH);
            }
            prevT = t;
        }

        // Draw each series (sorted by time)
        for (const s of builtSeries) {
            s.data.sort((a, b) => a.t - b.t);
            drawSeriesWithGaps(ctx, s.data, xMap, yMap, s.color, s.width, maxGapS);
            drawPoints(ctx, s.data, xMap, yMap, s.color, s.pointRadius);
        }

        // Legend
        if (opts.showLegend !== false) {
            drawLegend(ctx, padL, padT, plotW, builtSeries);
        }
    }

    // -------------------------------------------------
    // Export
    // -------------------------------------------------
    window.AirBuddyChartCore = {
        DEFAULT_RANGES_HOURS,
        readJSONAttr,
        drawTimeSeriesChart,
    };
})();