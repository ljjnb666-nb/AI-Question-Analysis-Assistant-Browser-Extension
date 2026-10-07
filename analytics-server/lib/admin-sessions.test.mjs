// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createAdminSessionStore } from "./admin-sessions.mjs";

describe("Phase 11E Admin session credential invariants", () => {
  it("E-SESSION-01 issues non-empty unique session and CSRF credentials", () => {
    const sessionTokens = ["", "session-a", "session-b"];
    const csrfTokens = ["", "session-a", "csrf-shared", "csrf-shared", "csrf-b"];
    const store = createAdminSessionStore({
      createToken: () => sessionTokens.shift(),
      createCsrfToken: () => csrfTokens.shift(),
      now: () => 1_000,
      ttlMs: 10_000,
      maxSessions: 4,
    });

    const first = store.issue();
    expect(first.token).toBe("session-a");
    expect(first.csrfToken).toBe("csrf-shared");

    const second = store.issue();
    expect(second.token).toBe("session-b");
    expect(second.csrfToken).toBe("csrf-b");

    expect(first.token).not.toBe(second.token);
    expect(first.csrfToken).not.toBe(second.csrfToken);
    expect(first.csrfToken).not.toBe(first.token);
    expect(second.csrfToken).not.toBe(second.token);
  });

  it("E-SESSION-02 expiry removes the CSRF authority together with the session", () => {
    let now = 1_000;
    const store = createAdminSessionStore({
      createToken: () => "session-expiring",
      createCsrfToken: () => "csrf-expiring",
      now: () => now,
      ttlMs: 50,
    });

    const issued = store.issue();
    expect(store.get(issued.token)?.csrfToken).toBe("csrf-expiring");

    now = 1_051;
    expect(store.get(issued.token)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("E-SESSION-03 bounded eviction removes the evicted session and its CSRF authority", () => {
    let tokenSequence = 0;
    let csrfSequence = 0;
    const store = createAdminSessionStore({
      createToken: () => `session-${++tokenSequence}`,
      createCsrfToken: () => `csrf-${++csrfSequence}`,
      now: () => 1_000,
      ttlMs: 10_000,
      maxSessions: 1,
    });

    const first = store.issue();
    const second = store.issue();

    expect(store.get(first.token)).toBeNull();
    expect(store.get(second.token)?.csrfToken).toBe(second.csrfToken);
    expect(store.size).toBe(1);
  });
});
