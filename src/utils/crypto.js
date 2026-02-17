import crypto from "node:crypto";

export function sha256Hex(str) {
    return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}
