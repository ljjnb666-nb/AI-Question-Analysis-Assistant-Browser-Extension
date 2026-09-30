import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DEFAULT_HASH_KEYLEN = 32;

// Resource bounds for the rate limiter. The production default is a code-level
// safety value on purpose: a misconfigured override must not be able to push
// the single analytics process back into unbounded memory growth.
export const DEFAULT_RATE_LIMIT_MAX_BUCKETS = 4096;
export const DEFAULT_RATE_LIMIT_MAX_STORED_KEY_BYTES = 512;

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

export function normalizeRateLimitKey(
  key,
  maxStoredKeyBytes = DEFAULT_RATE_LIMIT_MAX_STORED_KEY_BYTES,
) {
  if (!Number.isInteger(maxStoredKeyBytes) || maxStoredKeyBytes < 1) {
    throw new RangeError("maxStoredKeyBytes must be a positive integer");
  }

  const raw = String(key || "");
  if (!raw) return "";
  // Hash instead of truncating: two distinct attacker-controlled keys that
  // share a prefix must never be merged into one bucket.
  if (Buffer.byteLength(raw, "utf8") <= maxStoredKeyBytes) return raw;
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

export function createFixedWindowRateLimiter(options = {}) {
  // Compatibility: the limiter used to take the clock directly,
  // e.g. createFixedWindowRateLimiter(() => now). New code should pass options.
  const resolved = typeof options === "function" ? { now: options } : options;
  const {
    maxBuckets = DEFAULT_RATE_LIMIT_MAX_BUCKETS,
    maxStoredKeyBytes = DEFAULT_RATE_LIMIT_MAX_STORED_KEY_BYTES,
    now = () => Date.now(),
  } = resolved || {};

  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }
  if (!Number.isInteger(maxBuckets) || maxBuckets < 1) {
    throw new RangeError("maxBuckets must be a positive integer");
  }
  if (!Number.isInteger(maxStoredKeyBytes) || maxStoredKeyBytes < 1) {
    throw new RangeError("maxStoredKeyBytes must be a positive integer");
  }

  const buckets = new Map();

  // Reclaim watermark: always <= the earliest resetAt stored in the map. It is
  // only ever lowered (bucket insert/reset) or recomputed exactly (sweep), so
  // it can go stale-earlier but never stale-later: an expired bucket becomes
  // reclaimable no later than its own expiry. A stale-earlier watermark costs
  // at most one extra sweep that recomputes it.
  let nextReclaimAt = Infinity;
  let sweepCount = 0;

  function noteResetAt(resetAt) {
    if (resetAt < nextReclaimAt) nextReclaimAt = resetAt;
  }

  function reclaimExpired(currentTime) {
    sweepCount += 1;
    let earliest = Infinity;
    for (const [storedKey, bucket] of buckets) {
      if (bucket.resetAt <= currentTime) buckets.delete(storedKey);
      else if (bucket.resetAt < earliest) earliest = bucket.resetAt;
    }
    nextReclaimAt = earliest;
  }

  return {
    consume(key, limit, windowMs) {
      const storedKey = normalizeRateLimitKey(key, maxStoredKeyBytes);
      if (!storedKey) {
        return { allowed: true, remaining: limit, resetAt: now() + windowMs };
      }

      const currentTime = now();
      const existing = buckets.get(storedKey);
      if (existing && existing.resetAt > currentTime) {
        // Active buckets are never evicted and never reset by capacity
        // pressure, or churn could erase the rate-limit authority of a
        // caller that has already spent its window.
        existing.count += 1;
        return {
          allowed: existing.count <= limit,
          remaining: Math.max(0, limit - existing.count),
          resetAt: existing.resetAt,
        };
      }

      const windowResetAt = currentTime + windowMs;
      if (existing) {
        // Expired bucket: reset in place; no capacity is consumed.
        buckets.set(storedKey, { count: 1, resetAt: windowResetAt });
        noteResetAt(windowResetAt);
        return {
          allowed: true,
          remaining: Math.max(0, limit - 1),
          resetAt: windowResetAt,
        };
      }

      if (buckets.size >= maxBuckets) {
        // Capacity pressure: reclaim expired entries only once the watermark
        // says at least one bucket may have expired, so sustained new-key
        // pressure before the earliest expiry stays O(1) per request.
        if (currentTime >= nextReclaimAt) reclaimExpired(currentTime);
        if (buckets.size >= maxBuckets) {
          return {
            allowed: false,
            reason: "capacity",
            remaining: 0,
            resetAt: nextReclaimAt,
          };
        }
      }

      buckets.set(storedKey, { count: 1, resetAt: windowResetAt });
      noteResetAt(windowResetAt);
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        resetAt: windowResetAt,
      };
    },
    get size() {
      return buckets.size;
    },
    get maxBuckets() {
      return maxBuckets;
    },
    // Test/debug introspection only: counts and a timestamp, never key
    // material such as client IPs or email addresses.
    stats() {
      return { size: buckets.size, maxBuckets, nextReclaimAt, sweepCount };
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
