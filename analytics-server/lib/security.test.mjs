// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createFixedWindowRateLimiter,
  hashSecret,
  normalizeIpAddress,
  normalizeRateLimitKey,
  verifySecret,
} from "./security.mjs";

describe("security helpers", () => {
  it("hashes and verifies secrets", () => {
    const digest = hashSecret("super-secret");

    expect(digest.hash).toBeTruthy();
    expect(digest.salt).toBeTruthy();
    expect(verifySecret("super-secret", digest.salt, digest.hash)).toBe(true);
    expect(verifySecret("wrong-secret", digest.salt, digest.hash)).toBe(false);
  });

  it("enforces fixed-window rate limits", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter(() => now);

    expect(limiter.consume("ip:1", 2, 500).allowed).toBe(true);
    expect(limiter.consume("ip:1", 2, 500).allowed).toBe(true);
    expect(limiter.consume("ip:1", 2, 500).allowed).toBe(false);

    now = 1_600;
    expect(limiter.consume("ip:1", 2, 500).allowed).toBe(true);
  });

  it("P_REL_ADM_10_DIRECT_CLIENT_HEADER_SPOOF: ignores forwarded headers from direct clients", () => {
    const req = {
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
      },
      socket: { remoteAddress: "203.0.113.50" },
    };

    expect(normalizeIpAddress(req)).toBe("203.0.113.50");
  });

  it("P_REL_ADM_11_TRUSTED_PROXY_REAL_IP: uses X-Real-IP from loopback and ignores spoofed XFF", () => {
    const headers = {
      "x-forwarded-for": "1.1.1.1, 203.0.113.50",
      "x-real-ip": "203.0.113.50",
    };

    expect(normalizeIpAddress({ headers, socket: { remoteAddress: "127.0.0.1" } })).toBe("203.0.113.50");
    expect(normalizeIpAddress({ headers, socket: { remoteAddress: "::1" } })).toBe("203.0.113.50");
    expect(normalizeIpAddress({ headers, socket: { remoteAddress: "::ffff:127.0.0.1" } })).toBe("203.0.113.50");
    expect(normalizeIpAddress({ headers: { "x-forwarded-for": "1.1.1.1" }, socket: { remoteAddress: "::1" } })).toBe("::1");
  });
});

describe("rate limiter resource bounds (REL-RATE-01)", () => {
  it("RATE_01_BASIC_FIXED_WINDOW_UNCHANGED: count, denial, and window reset match the original semantics", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter(() => now);

    expect(limiter.consume("ip:1", 3, 500)).toEqual({ allowed: true, remaining: 2, resetAt: 1_500 });
    expect(limiter.consume("ip:1", 3, 500)).toEqual({ allowed: true, remaining: 1, resetAt: 1_500 });
    expect(limiter.consume("ip:1", 3, 500)).toEqual({ allowed: true, remaining: 0, resetAt: 1_500 });
    expect(limiter.consume("ip:1", 3, 500)).toEqual({ allowed: false, remaining: 0, resetAt: 1_500 });

    now = 1_500;
    expect(limiter.consume("ip:1", 3, 500)).toEqual({ allowed: true, remaining: 2, resetAt: 2_000 });

    // Empty keys keep their historical no-bucket semantics.
    expect(limiter.consume("", 2, 500)).toEqual({ allowed: true, remaining: 2, resetAt: 2_000 });
    expect(limiter.stats().size).toBe(1);
  });

  it("RATE_02_EXPIRED_BUCKETS_RECLAIMED: capacity pressure reclaims expired buckets without revisiting their keys", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 3 });

    limiter.consume("A", 1, 500);
    limiter.consume("B", 1, 500);
    limiter.consume("C", 1, 500);
    expect(limiter.stats().size).toBe(3);

    now = 2_000;
    expect(limiter.consume("D", 1, 500).allowed).toBe(true);
    expect(limiter.stats().size).toBe(1);
  });

  it("RATE_03_BUCKET_COUNT_NEVER_EXCEEDS_BOUND: mixed churn, hits, and expiry never grow past maxBuckets", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 4 });

    for (let round = 0; round < 25; round += 1) {
      limiter.consume("existing", 5, 500);
      for (let i = 0; i < 10; i += 1) {
        limiter.consume(`churn-${round}-${i}`, 5, 500);
      }
      if (round % 5 === 4) now += 600;
      expect(limiter.stats().size).toBeLessThanOrEqual(4);
      expect(limiter.stats().maxBuckets).toBe(4);
    }
  });

  it("RATE_04_ACTIVE_BUCKET_NOT_EVICTED: capacity pressure never resets an active bucket's authority", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 3 });

    let lastA;
    for (let i = 0; i < 5; i += 1) lastA = limiter.consume("A", 4, 10_000);
    expect(lastA.allowed).toBe(false);
    const blockedResetAt = lastA.resetAt;

    limiter.consume("B", 1, 10_000);
    limiter.consume("C", 1, 10_000);

    for (let i = 0; i < 50; i += 1) {
      const rejected = limiter.consume(`churn-${i}`, 1, 10_000);
      expect(rejected.allowed).toBe(false);
      expect(rejected.reason).toBe("capacity");
    }

    const stillBlocked = limiter.consume("A", 4, 10_000);
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.resetAt).toBe(blockedResetAt);
    expect(limiter.stats().size).toBe(3);
  });

  it("RATE_05_CAPACITY_NEW_KEY_FAILS_CLOSED: a full limiter rejects new keys without inserting or failing open", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 2 });
    const first = limiter.consume("A", 1, 2_000);
    limiter.consume("B", 5, 5_000);

    expect(limiter.consume("C", 1, 2_000)).toEqual({
      allowed: false,
      reason: "capacity",
      remaining: 0,
      resetAt: first.resetAt,
    });
    expect(limiter.stats().size).toBe(2);
  });

  it("RATE_06_ONE_NAMESPACE_DOES_NOT_STARVE_ANOTHER: separate limiter instances have independent capacity", () => {
    let now = 1_000;
    const sendCodeEmail = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 2 });
    const sessionIp = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 2 });

    sendCodeEmail.consume("email-a", 1, 60_000);
    sendCodeEmail.consume("email-b", 1, 60_000);
    expect(sendCodeEmail.consume("email-c", 1, 60_000).reason).toBe("capacity");

    expect(sessionIp.consume("203.0.113.9", 1, 60_000).allowed).toBe(true);
  });

  it("RATE_07_LONG_KEY_NOT_STORED_UNBOUNDED: oversized keys collapse to a fixed-length digest", () => {
    const short = "login:ip:203.0.113.7";
    expect(normalizeRateLimitKey(short, 512)).toBe(short);

    const exactBoundary = "x".repeat(512);
    expect(normalizeRateLimitKey(exactBoundary, 512)).toBe(exactBoundary);

    const overBoundary = "x".repeat(513);
    expect(normalizeRateLimitKey(overBoundary, 512)).toMatch(/^sha256:[0-9a-f]{64}$/);

    // UTF-8 byte length, not JS string length: 300 two-byte chars = 600 bytes.
    const multibyte = "é".repeat(300);
    expect(normalizeRateLimitKey(multibyte, 512)).toMatch(/^sha256:[0-9a-f]{64}$/);

    const longA = `send-code:email:${"a".repeat(600)}@example.test`;
    const longB = `send-code:email:${"b".repeat(600)}@example.test`;
    const normalizedA = normalizeRateLimitKey(longA, 512);
    expect(normalizedA).toBe(`sha256:${createHash("sha256").update(longA, "utf8").digest("hex")}`);
    expect(normalizedA).toBe(normalizeRateLimitKey(longA, 512));
    expect(normalizedA).not.toBe(normalizeRateLimitKey(longB, 512));
  });

  it("RATE_08_WINDOW_RESET_STILL_WORKS: expiry reset and reclaim survive a capacity episode", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 2 });

    limiter.consume("A", 1, 500);
    limiter.consume("B", 1, 500);
    expect(limiter.consume("C", 1, 500).reason).toBe("capacity");

    now = 1_500;
    expect(limiter.consume("A", 1, 500)).toEqual({ allowed: true, remaining: 0, resetAt: 2_000 });

    expect(limiter.consume("D", 1, 500).allowed).toBe(true);
    expect(limiter.stats().size).toBe(2);
  });

  it("RATE_09_CAPACITY_REJECT_DOES_NOT_RESWEEP_BEFORE_EARLIEST_EXPIRY: sustained pressure stays O(1) per rejection", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 3 });

    limiter.consume("A", 1, 60_000);
    limiter.consume("B", 1, 60_000);
    limiter.consume("C", 1, 60_000);

    expect(limiter.consume("D", 1, 60_000)).toMatchObject({
      allowed: false,
      reason: "capacity",
      resetAt: 61_000,
    });
    const { sweepCount } = limiter.stats();

    for (let i = 0; i < 100; i += 1) {
      const rejected = limiter.consume(`burst-${i}`, 1, 60_000);
      expect(rejected.allowed).toBe(false);
      expect(rejected.reason).toBe("capacity");
    }

    expect(limiter.stats().sweepCount).toBe(sweepCount);
    expect(limiter.stats().size).toBe(3);
  });

  it("RATE_10_RECLAIM_SWEEP_RESUMES_AT_EXPIRY: the CPU guard never blocks real expiry cleanup", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({ now: () => now, maxBuckets: 3 });

    limiter.consume("A", 1, 10_000);
    limiter.consume("B", 1, 60_000);
    limiter.consume("C", 1, 60_000);

    expect(limiter.consume("D", 1, 60_000).reason).toBe("capacity");
    const sweepsBeforeExpiry = limiter.stats().sweepCount;

    now = 11_000;
    expect(limiter.consume("E", 1, 60_000).allowed).toBe(true);
    expect(limiter.stats().sweepCount).toBe(sweepsBeforeExpiry + 1);
    expect(limiter.stats().size).toBe(3);
    expect(limiter.stats().nextReclaimAt).toBe(61_000);

    // The recomputed watermark guards again: pressure before the new earliest
    // expiry must not sweep a second time.
    expect(limiter.consume("F", 1, 60_000).reason).toBe("capacity");
    expect(limiter.stats().sweepCount).toBe(sweepsBeforeExpiry + 1);
  });

  it("validates limiter construction options", () => {
    expect(() => createFixedWindowRateLimiter({ maxBuckets: 0 })).toThrow(RangeError);
    expect(() => createFixedWindowRateLimiter({ maxBuckets: 1.5 })).toThrow(RangeError);
    expect(() => createFixedWindowRateLimiter({ maxStoredKeyBytes: 0 })).toThrow(RangeError);
    expect(() => createFixedWindowRateLimiter({ now: () => 0, maxBuckets: 1 })).not.toThrow();
    expect(() => createFixedWindowRateLimiter(() => 0)).not.toThrow();
  });
});
