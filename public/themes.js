// public/theme.js
(function () {
    "use strict";

    const KEY = "airbuddy_theme"; // "light" | "dark"

    function apply(theme) {
        const t = theme === "dark" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", t);
        try { localStorage.setItem(KEY, t); } catch {}
    }

    function init() {
        // Stored preference wins
        let saved = null;
        try { saved = localStorage.getItem(KEY); } catch {}

        if (saved === "dark" || saved === "light") {
            apply(saved);
            return;
        }

        // Else follow system preference initially
        const prefersDark =
            typeof window !== "undefined" &&
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches;

        apply(prefersDark ? "dark" : "light");
    }

    function toggle() {
        const cur = document.documentElement.getAttribute("data-theme");
        apply(cur === "dark" ? "light" : "dark");
    }

    // Expose a tiny API for the button
    window.AirBuddyTheme = { init, toggle, apply };

    // Auto-init on load
    init();
})();