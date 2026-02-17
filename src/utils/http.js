export function requireHeader(req, name) {
    const v = req.get(name);
    return v && String(v).trim() ? String(v).trim() : null;
}

export function isFiniteNumber(x) {
    return typeof x === "number" && Number.isFinite(x);
}

export function toMySQLDatetimeFromUnixSeconds(sec) {
    const d = new Date(sec * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    );
}
