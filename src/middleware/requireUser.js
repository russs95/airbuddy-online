export function requireUser(req, res, next) {
    if (!req.session?.user?.buwana_id) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
}