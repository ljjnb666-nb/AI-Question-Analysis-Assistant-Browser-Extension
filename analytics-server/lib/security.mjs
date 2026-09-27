import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DEFAULT_HASH_KEYLEN = 32;

export function hashSecret(secret) {
  const normalized = String(secret || "");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(normalized, salt, DEFAULT_HASH_KEYLEN).toString("hex");
  return { salt, hash };
}

export function verifySecret(secret, salt, hash) {
  const normalized = String(secret || "");
  const normalizedSalt = String(salt || "");
  const normalizedHash = String(hash || "");
  if (!normalized || !normalizedSalt || !normalizedHash) return false;

  const next = scryptSync(normalized, normalizedSalt, DEFAULT_HASH_KEYLEN);
  const expected = Buffer.from(normalizedHash, "hex");
  return next.length === expected.length && timingSafeEqual(next, expected);
}

export function issueOpaqueToken(prefix = "tok") {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

export function createFixedWindowRateLimiter(now = () => Date.now()) {
  const buckets = new Map();

  return {
    consume(key, limit, windowMs) {
      const safeKey = String(key || "");
      if (!safeKey) {
        return { allowed: true, remaining: limit, resetAt: now() + windowMs };
      }

      const currentTime = now();
      const existing = buckets.get(safeKey);
      if (!existing || existing.resetAt <= currentTime) {
        const nextBucket = {
          count: 1,
          resetAt: currentTime + windowMs,
        };
        buckets.set(safeKey, nextBucket);
        return {
          allowed: true,
          remaining: Math.max(0, limit - nextBucket.count),
          resetAt: nextBucket.resetAt,
        };
      }

      existing.count += 1;
      return {
        allowed: existing.count <= limit,
        remaining: Math.max(0, limit - existing.count),
        resetAt: existing.resetAt,
      };
    },
  };
}

export function normalizeIpAddress(req) {
  const peerAddress = String(req.socket?.remoteAddress || "").trim();
  if (!peerAddress) return "unknown";

  const normalizedPeerAddress = peerAddress.toLowerCase();
  const isTrustedLoopbackProxy =
    normalizedPeerAddress === "127.0.0.1" ||
    normalizedPeerAddress === "::1" ||
    normalizedPeerAddress === "::ffff:127.0.0.1";

  if (!isTrustedLoopbackProxy) return peerAddress;

  // The deployed nginx proxy overwrites X-Real-IP with its observed $remote_addr.
  // X-Forwarded-For is append-only in that configuration, so its first value may
  // be attacker-controlled and is never used as rate-limit identity.
  return String(req.headers?.["x-real-ip"] || "").trim() || peerAddress;
}
