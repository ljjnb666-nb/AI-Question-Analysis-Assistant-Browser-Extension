// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:sqlite", () => ({}));

const {
  ADMIN_AUDIT_EVENTS,
  createAdminAuditReadModel,
  createAdminAuditRecorder,
  normalizeAdminAuditQuery,
} = await import("./admin-audit.mjs");
const {
  ADMIN_AUDIT_RETENTION_MS,
  getStorageBackendInfo,
  loadDb,
  pruneAdminAuditEventsInStorage,
  resetDbConnectionForTests,
} = await import("./store.mjs");

let tempDir;

expect(getStorageBackendInfo().driver).toBe("json");

beforeEach(() => {
  resetDbConnectionForTests();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-admin-audit-json-"));
  process.env.ANALYTICS_DATA_DIR = tempDir;
  delete process.env.ANALYTICS_DB_FILE;
});

afterEach(() => {
  resetDbConnectionForTests();
  delete process.env.ANALYTICS_DATA_DIR;
  delete process.env.ANALYTICS_DB_FILE;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Phase 11E Admin Audit JSON compatibility", () => {
  it("E-AUDIT-J01 mirrors sanitized pagination and opaque cursor behavior", () => {
    let now = Date.parse("2026-10-07T12:00:00.000Z");
    let id = 0;
    const record = createAdminAuditRecorder({
      now: () => now,
      generateIdImpl: () => `adm_${String(++id).padStart(3, "0")}`,
    });

    record({
      event: ADMIN_AUDIT_EVENTS.LOGIN,
      outcome: "success",
      ip: "192.0.2.1",
      sessionToken: "session-secret",
      metadata: {
        method: "POST",
        path: "/admin/login",
        adminToken: "must-not-store",
      },
    });
    record({
      event: ADMIN_AUDIT_EVENTS.LOGOUT,
      outcome: "success",
      ip: "192.0.2.2",
      sessionToken: "another-secret",
    });
    now -= 1;
    record({
      event: ADMIN_AUDIT_EVENTS.ORIGIN_REJECTED,
      outcome: "rejected",
      ip: "192.0.2.3",
      metadata: { reason: "origin_mismatch" },
    });

    const read = createAdminAuditReadModel({ now: () => Date.parse("2026-10-07T13:00:00.000Z") });
    const first = read.list(normalizeAdminAuditQuery({ limit: "2" }));
    expect(first.data.map((item) => item.auditId)).toEqual(["adm_002", "adm_001"]);
    expect(first.page.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(first)).not.toContain("must-not-store");
    expect(JSON.stringify(first)).not.toContain("session-secret");
    expect(JSON.stringify(first)).not.toContain("192.0.2.1");

    const second = read.list(
      normalizeAdminAuditQuery({ limit: "2", cursor: first.page.nextCursor }),
    );
    expect(second.data.map((item) => item.auditId)).toEqual(["adm_003"]);
    expect(second.page.nextCursor).toBeNull();
  });

  it("E-AUDIT-J02 housekeeping physically removes expired JSON rows without a new Audit write", () => {
    const current = Date.parse("2026-10-07T12:00:00.000Z");
    const old = current - ADMIN_AUDIT_RETENTION_MS - 1;
    const record = createAdminAuditRecorder({
      now: () => old,
      generateIdImpl: () => "adm_json_expired",
    });

    record({
      event: ADMIN_AUDIT_EVENTS.LOGIN,
      outcome: "failure",
      ip: "expired-json-source",
    });
    expect(loadDb().admin_audit_events.map((entry) => entry.auditId)).toEqual([
      "adm_json_expired",
    ]);

    expect(pruneAdminAuditEventsInStorage(current)).toBeGreaterThan(0);
    expect(loadDb().admin_audit_events).toEqual([]);
  });
});
