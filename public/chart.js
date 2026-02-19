// public/chart.js
(function () {
    const canvas = document.getElementById("trend");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    const readJsonAttr = (name) => {
        const raw = canvas.getAttribute(name);
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch {
            return [];
        }
    };

    const data = {
        labels: readJsonAttr("data-labels"),
        temps: readJsonAttr("data-temps"),
        rhs: readJsonAttr("data-rhs"),
        eco2s: readJsonAttr("data-eco2s"),
    };

    function minMax(arr) {
        let min = Infinity,
            max = -Infinity;
        for (const v of arr) {
            if (v == null) continue;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (min === Infinity) return { min: 0, max: 1 };
        if (min === max) return { min: min - 1, max: max + 1 };
        return { min, max };
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    let xMap = (i) => i;

    function drawLine(series, yMap, strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < series.length; i++) {
            const v = series[i];
            if (v == null) continue;
            const x = xMap(i);
            const y = yMap(v);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }

    function drawPoints(series, yMap, fillStyle) {
        ctx.fillStyle = fillStyle;
        for (let i = 0; i < series.length; i++) {
            const v = series[i];
            if (v == null) continue;
            const x = xMap(i);
            const y = yMap(v);
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function draw() {
        const W = canvas.getBoundingClientRect().width;
        const H = canvas.getBoundingClientRect().height;
        ctx.clearRect(0, 0, W, H);

        const padL = 44,
            padR = 44,
            padT = 16,
            padB = 26;
        const plotW = Math.max(1, W - padL - padR);
        const plotH = Math.max(1, H - padT - padB);

        const n = Math.max((data.labels || []).length, 1);
        xMap = (i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));

        const tMM = minMax(data.temps || []);
        const rMM = minMax(data.rhs || []);
        const cMM = minMax(data.eco2s || []);

        const yTemp = (v) => padT + (1 - (v - tMM.min) / (tMM.max - tMM.min)) * plotH;
        const yRh = (v) => padT + (1 - (v - rMM.min) / (rMM.max - rMM.min)) * plotH;
        const yCo2 = (v) => padT + (1 - (v - cMM.min) / (cMM.max - cMM.min)) * plotH;

        // Grid
        ctx.strokeStyle = "#eee";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k <= 4; k++) {
            const y = padT + (k * plotH) / 4;
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + plotW, y);
        }
        ctx.stroke();

        // Axes
        ctx.strokeStyle = "#ddd";
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, padT + plotH);
        ctx.lineTo(padL + plotW, padT + plotH);
        ctx.stroke();

        // Labels (minimal)
        ctx.fillStyle = "#666";
        ctx.font =
            "12px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif";
        ctx.fillText(tMM.max.toFixed(1) + "°C", 6, padT + 4);
        ctx.fillText(tMM.min.toFixed(1) + "°C", 6, padT + plotH);
        ctx.fillText(rMM.max.toFixed(1) + "%", padL + plotW + 6, padT + 4);
        ctx.fillText(rMM.min.toFixed(1) + "%", padL + plotW + 6, padT + plotH);

        // Lines + points
        drawLine(data.temps || [], yTemp, "#c62828"); // red
        drawLine(data.rhs || [], yRh, "#1565c0"); // blue
        drawLine(data.eco2s || [], yCo2, "#6a1b9a"); // purple

        drawPoints(data.temps || [], yTemp, "#c62828");
        drawPoints(data.rhs || [], yRh, "#1565c0");
        drawPoints(data.eco2s || [], yCo2, "#6a1b9a");
    }

    window.addEventListener("resize", resize);
    resize();
})();
