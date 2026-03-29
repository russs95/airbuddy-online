export function requireUser(req, res, next) {
    if (!req.session?.user?.buwana_sub) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
}