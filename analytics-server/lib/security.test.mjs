// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter, hashSecret, verifySecret } from "./security.mjs";

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
});
