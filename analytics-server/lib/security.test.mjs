// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter, hashSecret, normalizeIpAddress, verifySecret } from "./security.mjs";

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
