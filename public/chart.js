// public/chart.js
(function () {
    // ----------------------------
    // Read data-* payload from canvas
    // ----------------------------
    function getDataFromCanvas(canvas) {
        const read = (name) => {
            const raw = canvas.getAttribute(name);
            if (!raw) return [];
            try {
                return JSON.parse(raw);
            } catch {
                return [];
            }
        };

        // New server.js writes: data-labels-short + data-labels-long
        // Backward compatible: if missing, fall back to data-labels
        const labelsShort = read("data-labels-short");
        const labelsLong = read("data-labels-long");
        const labelsLegacy = read("data-labels");

        return {
            labelsShort:
                Array.isArray(labelsShort) && labelsShort.length ? labelsShort : labelsLegacy,
            labelsLong:
                Array.isArray(labelsLong) && labelsLong.length ? labelsLong : labelsLegacy,
            temps: read("data-temps"),
            rhs: read("data-rhs"),
            eco2s: read("data-eco2s"),
        };
    }

    // ----------------------------
    // Numeric helpers
    // ----------------------------
    function finiteVals(arr) {
        const out = [];
        for (const v of arr) {
            if (v == null) continue;
            const n = Number(v);
            if (Number.isFinite(n)) out.push(n);
        }
        return out;
    }

    function niceStep(targetStep) {
        // "Nice numbers" for steps: 1,2,5 * 10^k
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
        // Expand bounds to "nice" tick step and round outward
        if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return { min: 0, max: 1, step: 1 };
        if (minV === maxV) {
            const pad = minV === 0 ? 1 : Math.abs(minV) * 0.1;
            minV -= pad;
            maxV += pad;
        }
        const span = maxV - minV;
        const rawStep = span / Math.max(1, (ticks - 1));
        const step = niceStep(rawStep);

        const niceMin = Math.floor(minV / step) * step;
        const niceMax = Math.ceil(maxV / step) * step;

        // If rounding collapses, push max
        if (niceMin === niceMax) return { min: niceMin, max: niceMax + step, step };
        return { min: niceMin, max: niceMax, step };
    }

    // ----------------------------
    // Drawing
    // ----------------------------
    function drawSeries(canvas, series, labelsShort, color, yLabelFmt) {
        const ctx = canvas.getContext("2d");

        // Ensure we only register one resize handler per canvas
        let resizeAttached = false;

        function resizeAndDraw() {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();

            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));

            // Use CSS pixel coords in all drawing calls
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw(rect.width, rect.height);
        }

        function drawLine(series, xMap, yMap) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < series.length; i++) {
                const v = series[i];
                if (v == null) continue;
                const n = Number(v);
                if (!Number.isFinite(n)) continue;

                const x = xMap(i);
                const y = yMap(n);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }

        function drawPoints(series, xMap, yMap) {
            ctx.fillStyle = color;
            for (let i = 0; i < series.length; i++) {
                const v = series[i];
                if (v == null) continue;
                const n = Number(v);
                if (!Number.isFinite(n)) continue;

                const x = xMap(i);
                const y = yMap(n);
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        function drawTextCentered(text, x, y) {
            const w = ctx.measureText(text).width;
            ctx.fillText(text, x - w / 2, y);
        }

        function draw(W, H) {
            ctx.clearRect(0, 0, W, H);

            // More bottom padding for time labels
            const padL = 52;
            const padR = 18;
            const padT = 16;
            const padB = 44;

            const plotW = Math.max(1, W - padL - padR);
            const plotH = Math.max(1, H - padT - padB);

            const n = Math.max(series.length, 1);
            const xMap = (i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));

            // Y scaling: "nice" bounds with 5 tick labels
            const vals = finiteVals(series);
            const rawMin = vals.length ? Math.min(...vals) : 0;
            const rawMax = vals.length ? Math.max(...vals) : 1;
            const nb = niceBounds(rawMin, rawMax, 5);

            const yMap = (v) => {
                const t = (v - nb.min) / (nb.max - nb.min);
                return padT + (1 - t) * plotH;
            };

            // --- Grid: horizontal (5 ticks) + vertical (5 ticks)
            ctx.strokeStyle = "#eee";
            ctx.lineWidth = 1;

            // Horizontal grid lines (0..4)
            ctx.beginPath();
            for (let k = 0; k <= 4; k++) {
                const y = padT + (k * plotH) / 4;
                ctx.moveTo(padL, y);
                ctx.lineTo(padL + plotW, y);
            }

            // Vertical grid lines (0..4)
            for (let k = 0; k <= 4; k++) {
                const x = padL + (k * plotW) / 4;
                ctx.moveTo(x, padT);
                ctx.lineTo(x, padT + plotH);
            }
            ctx.stroke();

            // --- Axes
            ctx.strokeStyle = "#ddd";
            ctx.beginPath();
            ctx.moveTo(padL, padT);
            ctx.lineTo(padL, padT + plotH);
            ctx.lineTo(padL + plotW, padT + plotH);
            ctx.stroke();

            // --- Y labels (5 ticks)
            ctx.fillStyle = "#666";
            ctx.font =
                '12px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';

            for (let k = 0; k <= 4; k++) {
                const v = nb.max - (k * (nb.max - nb.min)) / 4;
                const y = padT + (k * plotH) / 4;
                const label = yLabelFmt(v);
                // small offset so it doesn't overlap axis
                ctx.fillText(label, 6, y + 4);
            }

            // --- Bottom time labels: 3 labels (start / mid / end)
            const safeLabels = Array.isArray(labelsShort) ? labelsShort : [];
            const idx0 = 0;
            const idxMid = Math.floor((n - 1) / 2);
            const idxEnd = Math.max(0, n - 1);

            const t0 = safeLabels[idx0] ?? "";
            const tMid = safeLabels[idxMid] ?? "";
            const tEnd = safeLabels[idxEnd] ?? "";

            ctx.fillStyle = "#777";
            ctx.font =
                '12px "Mulish", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif';

            const yTime = padT + plotH + 22;

            if (t0) drawTextCentered(t0, xMap(idx0), yTime);
            if (tMid) drawTextCentered(tMid, xMap(idxMid), yTime);
            if (tEnd) drawTextCentered(tEnd, xMap(idxEnd), yTime);

            // --- Series
            drawLine(series, xMap, yMap);
            drawPoints(series, xMap, yMap);
        }

        if (!resizeAttached) {
            window.addEventListener("resize", resizeAndDraw);
            resizeAttached = true;
        }
        resizeAndDraw();
    }

    // ----------------------------
    // Boot
    // ----------------------------
    function boot() {
        const cTemp = document.getElementById("trend-temp");
        const cRh = document.getElementById("trend-rh");
        const cEco2 = document.getElementById("trend-eco2");
        if (!cTemp || !cRh || !cEco2) return;

        // All three canvases carry the same payload; read from first.
        const data = getDataFromCanvas(cTemp);

        drawSeries(
            cTemp,
            data.temps || [],
            data.labelsShort || [],
            "#c62828",
            (v) => v.toFixed(1) + "°C"
        );

        drawSeries(
            cRh,
            data.rhs || [],
            data.labelsShort || [],
            "#1565c0",
            (v) => v.toFixed(1) + "%"
        );

        drawSeries(
            cEco2,
            data.eco2s || [],
            data.labelsShort || [],
            "#6a1b9a",
            (v) => v.toFixed(0) + " ppm"
        );
    }

    boot();
})();


