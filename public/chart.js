// public/chart.js
(function () {
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

        return {
            labels: read("data-labels"),
            temps: read("data-temps"),
            rhs: read("data-rhs"),
            eco2s: read("data-eco2s"),
        };
    }

    function minMax(arr) {
        let min = Infinity, max = -Infinity;
        for (const v of arr) {
            if (v == null) continue;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (min === Infinity) return { min: 0, max: 1 };
        if (min === max) return { min: min - 1, max: max + 1 };
        return { min, max };
    }

    function drawSeries(canvas, series, color, leftLabelFmt) {
        const ctx = canvas.getContext("2d");

        function resize() {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw();
        }

        let xMap = (i) => i;

        function drawLine(series, yMap) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < series.length; i++) {
                const v = series[i];
                if (v == null) continue;
                const x = xMap(i);
                const y = yMap(v);
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        function drawPoints(series, yMap) {
            ctx.fillStyle = color;
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

            const padL = 44, padR = 18, padT = 16, padB = 26;
            const plotW = Math.max(1, W - padL - padR);
            const plotH = Math.max(1, H - padT - padB);

            const n = Math.max(series.length, 1);
            xMap = (i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));

            const mm = minMax(series);
            const yMap = (v) => padT + (1 - (v - mm.min) / (mm.max - mm.min)) * plotH;

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
            ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif";
            ctx.fillText(leftLabelFmt(mm.max), 6, padT + 4);
            ctx.fillText(leftLabelFmt(mm.min), 6, padT + plotH);

            // Series
            drawLine(series, yMap);
            drawPoints(series, yMap);
        }

        window.addEventListener("resize", resize);
        resize();
    }

    function boot() {
        const cTemp = document.getElementById("trend-temp");
        const cRh = document.getElementById("trend-rh");
        const cEco2 = document.getElementById("trend-eco2");
        if (!cTemp || !cRh || !cEco2) return;

        // all three canvases carry the same data-* payload
        const data = getDataFromCanvas(cTemp);

        drawSeries(
            cTemp,
            data.temps || [],
            "#c62828",
            (v) => v.toFixed(1) + "°C"
        );

        drawSeries(
            cRh,
            data.rhs || [],
            "#1565c0",
            (v) => v.toFixed(1) + "%"
        );

        drawSeries(
            cEco2,
            data.eco2s || [],
            "#6a1b9a",
            (v) => v.toFixed(0) + " ppm"
        );
    }

    boot();
})();
