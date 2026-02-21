// public/chart.js
(function () {
    // -------------------------------------------------
    // Configurable time ranges (hours)
    // -------------------------------------------------
    const RANGES = {
        "6h": 6,
        "24h": 24,
        "72h": 72,
        "7d": 24 * 7,
        "30d": 24 * 30,
    };

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
        if (!Number.isFinite(minV) || !Number.isFinite(maxV))
            return { min: 0, max: 1, step: 1 };

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

    // -------------------------------------------------
    // Draw Temperature Chart
    // -------------------------------------------------
    function drawChart(canvas, timestamps, temps, rangeKey) {
        const ctx = canvas.getContext("2d");
        const hours = RANGES[rangeKey] || 24;

        const now = Math.floor(Date.now() / 1000);
        const cutoff = now - hours * 3600;

        // Filter by time window
        const data = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (timestamps[i] >= cutoff && temps[i] != null) {
                data.push({ t: timestamps[i], v: Number(temps[i]) });
            }
        }

        if (!data.length) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillText("No data in range", 10, 20);
            return;
        }

        // Setup canvas scaling
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const W = rect.width;
        const H = rect.height;

        const padL = 60;
        const padR = 20;
        const padT = 20;
        const padB = 50;

        const plotW = W - padL - padR;
        const plotH = H - padT - padB;

        const minT = cutoff;
        const maxT = now;

        const minV = Math.min(...data.map(d => d.v));
        const maxV = Math.max(...data.map(d => d.v));
        const yBounds = niceBounds(minV, maxV, 5);

        const xMap = t =>
            padL + ((t - minT) / (maxT - minT)) * plotW;

        const yMap = v =>
            padT + (1 - (v - yBounds.min) / (yBounds.max - yBounds.min)) * plotH;

        ctx.clearRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = "#eee";
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
        ctx.font = "12px Mulish";
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

        // Temperature line
        ctx.strokeStyle = "#c62828";
        ctx.lineWidth = 2;
        ctx.beginPath();

        let started = false;
        for (const d of data) {
            const x = xMap(d.t);
            const y = yMap(d.v);

            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
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

        function redraw() {
            drawChart(canvas, timestamps, temps, select.value);
        }

        select.addEventListener("change", redraw);
        window.addEventListener("resize", redraw);

        redraw();
    }

    boot();
})();