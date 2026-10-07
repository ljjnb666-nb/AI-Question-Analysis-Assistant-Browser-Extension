// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_EVENTS,
  AdminAuditError,
  createAdminAuditReadModel,
  createAdminAuditRecorder,
  normalizeAdminAuditQuery,
} from "./admin-audit.mjs";
import {
  ADMIN_AUDIT_RETENTION_MS,
  resetDbConnectionForTests,
} from "./store.mjs";

let tempDir;

beforeEach(() => {
  resetDbConnectionForTests();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-admin-audit-"));
  process.env.ANALYTICS_DATA_DIR = tempDir;
  delete process.env.ANALYTICS_DB_FILE;
});

afterEach(() => {
  resetDbConnectionForTests();
  delete process.env.ANALYTICS_DATA_DIR;
  delete process.env.ANALYTICS_DB_FILE;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Phase 11E Admin Audit authority", () => {
  it("E-AUDIT-01 stores only sanitized event metadata and irreversible tags", () => {
    const now = Date.parse("2026-10-07T12:00:00.000Z");
    const record = createAdminAuditRecorder({
      now: () => now,
      generateIdImpl: () => "adm_fixed",
    });

    record({
      event: ADMIN_AUDIT_EVENTS.LOGIN,
      outcome: "success",
      ip: "203.0.113.10",
      sessionToken: "super-secret-session-token",
      metadata: {
        method: "POST",
        path: "/admin/login",
        reason: "invalid_credentials",
        adminToken: "long-lived-admin-secret",
        csrfToken: "csrf-secret",
        email: "private@example.test",
        deviceId: "raw-device-secret",
      },
    });

    const response = createAdminAuditReadModel({ now: () => now }).list(
      normalizeAdminAuditQuery(),
    );
    expect(response.data).toHaveLength(1);
    expect(response.data[0]).toMatchObject({
      auditId: "adm_fixed",
      event: "admin_login",
      outcome: "success",
      createdAt: "2026-10-07T12:00:00.000Z",
      metadata: {
        method: "POST",
        path: "/admin/login",
        reason: "invalid_credentials",
      },
    });
    expect(response.data[0].ipHash).toMatch(/^ip_[0-9a-f]{16}$/);
    expect(response.data[0].sessionTag).toMatch(/^session_[0-9a-f]{16}$/);

    const serialized = JSON.stringify(response);
    for (const forbidden of [
      "203.0.113.10",
      "super-secret-session-token",
      "long-lived-admin-secret",
      "csrf-secret",
      "private@example.test",
      "raw-device-secret",
      "adminToken",
      "csrfToken",
      "email",
      "deviceId",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("E-AUDIT-02 paginates deterministically with opaque cursor", () => {
    let now = Date.parse("2026-10-07T12:00:00.000Z");
    let id = 0;
    const record = createAdminAuditRecorder({
      now: () => now,
      generateIdImpl: () => `adm_${String(++id).padStart(3, "0")}`,
    });

    record({ event: ADMIN_AUDIT_EVENTS.LOGIN, outcome: "success", ip: "a" });
    record({ event: ADMIN_AUDIT_EVENTS.LOGOUT, outcome: "success", ip: "b" });
    now -= 1;
    record({ event: ADMIN_AUDIT_EVENTS.CSRF_REJECTED, outcome: "rejected", ip: "c" });

    const read = createAdminAuditReadModel({ now: () => Date.parse("2026-10-07T13:00:00.000Z") });
    const first = read.list(normalizeAdminAuditQuery({ limit: "2" }));
    expect(first.data.map((item) => item.auditId)).toEqual(["adm_002", "adm_001"]);
    expect(first.page.nextCursor).toEqual(expect.any(String));

    const second = read.list(
      normalizeAdminAuditQuery({ limit: "2", cursor: first.page.nextCursor }),
    );
    expect(second.data.map((item) => item.auditId)).toEqual(["adm_003"]);
    expect(second.page.nextCursor).toBeNull();
  });

  it("E-AUDIT-03 rejects malformed query cursors and unapproved vocabularies", () => {
    for (const limit of ["0", "101", "-1", "1.5", "abc", " 50 "]) {
      expect(() => normalizeAdminAuditQuery({ limit }), limit).toThrow(AdminAuditError);
    }
    expect(() => normalizeAdminAuditQuery({ cursor: "%%%" })).toThrow(AdminAuditError);

    const record = createAdminAuditRecorder({
      now: () => Date.parse("2026-10-07T12:00:00.000Z"),
    });
    expect(() =>
      record({ event: "user_supplied_event", outcome: "success" }),
    ).toThrow(AdminAuditError);
    expect(() =>
      record({ event: ADMIN_AUDIT_EVENTS.LOGIN, outcome: "maybe" }),
    ).toThrow(AdminAuditError);

    record({
      event: ADMIN_AUDIT_EVENTS.MUTATION_REJECTED,
      outcome: "rejected",
      metadata: {
        path: "/admin/api/attackerSecret123",
        reason: "unsupported_mutation",
      },
    });
    const sanitized = createAdminAuditReadModel({
      now: () => Date.parse("2026-10-07T12:00:00.000Z"),
    }).list();
    const mutation = sanitized.data.find(
      (item) => item.event === ADMIN_AUDIT_EVENTS.MUTATION_REJECTED,
    );
    expect(mutation?.metadata).toEqual({ reason: "unsupported_mutation" });
    expect(JSON.stringify(sanitized)).not.toContain("attackerSecret123");
  });

  it("E-AUDIT-04 prunes records outside the security retention window", () => {
    const current = Date.parse("2026-10-07T12:00:00.000Z");
    let now = current - ADMIN_AUDIT_RETENTION_MS - 1;
    let id = 0;
    const record = createAdminAuditRecorder({
      now: () => now,
      generateIdImpl: () => `adm_${++id}`,
    });
    record({ event: ADMIN_AUDIT_EVENTS.LOGIN, outcome: "failure", ip: "old" });

    now = current;
    record({ event: ADMIN_AUDIT_EVENTS.LOGIN, outcome: "success", ip: "new" });

    const response = createAdminAuditReadModel({ now: () => current }).list();
    expect(response.data.map((item) => item.auditId)).toEqual(["adm_2"]);
  });

  it("E-AUDIT-05 never leaks raw storage failures", () => {
    const read = createAdminAuditReadModel({
      now: () => Date.parse("2026-10-07T12:00:00.000Z"),
      readImpl: () => {
        throw new Error("/private/data/analytics-db.sqlite");
      },
    });
    expect(() => read.list()).toThrowError("ADMIN_STORAGE_UNAVAILABLE");
  });
});
