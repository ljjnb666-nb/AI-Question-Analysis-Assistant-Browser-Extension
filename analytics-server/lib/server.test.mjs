// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createAnalyticsHandler } from "./server.mjs";

function createReq({ method = "GET", url = "/", headers = {}, body = "" } = {}) {
  const listeners = new Map();
  return {
    method,
    url,
    headers,
    socket: { remoteAddress: "127.0.0.1" },
    destroyed: false,
    on(event, listener) {
      listeners.set(event, listener);
    },
    destroy() {
      this.destroyed = true;
    },
    emitBody() {
      if (body) listeners.get("data")?.(body);
      listeners.get("end")?.();
    },
  };
}

function createRes() {
  return {
    statusCode: 0,
    headers: {},
    payload: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(payload) {
      this.payload = payload;
    },
  };
}

function parsePayload(res) {
  return JSON.parse(res.payload);
}

describe("analytics handler", () => {
  it("requires admin token for metrics endpoints", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      loadDbImpl: () => ({ devices: [], users: [], analytics_events: [], email_verification_codes: [] }),
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({ method: "GET", url: "/analytics/summary" });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(401);
    expect(parsePayload(res).error).toMatch(/admin authorization required/i);
  });

  it("rejects oversized json bodies", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      loadDbImpl: () => ({ devices: [], users: [], analytics_events: [], email_verification_codes: [] }),
      sendVerificationCodeEmail: vi.fn(),
    });

    const hugeValue = "x".repeat(70 * 1024);
    const req = createReq({
      method: "POST",
      url: "/analytics/events",
      body: JSON.stringify({ deviceId: "dev-1", event: "parse_success", data: hugeValue }),
    });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(413);
    expect(parsePayload(res).error).toMatch(/request body exceeds/i);
  });

  it("rate limits repeated verification code sends", async () => {
    const db = { devices: [], users: [], analytics_events: [], email_verification_codes: [] };
    const sendVerificationCodeEmail = vi.fn().mockResolvedValue(undefined);
    const createEmailVerificationCodeImpl = vi.fn().mockReturnValue({
      code: "123456",
      expiresAt: Date.now() + 60_000,
    });
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      createEmailVerificationCodeImpl,
      isMailerConfigured: () => true,
      loadDbImpl: () => db,
      sendVerificationCodeEmail,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const req = createReq({
        method: "POST",
        url: "/auth/send-verification-code",
        body: JSON.stringify({ email: "user@example.com" }),
      });
      const res = createRes();
      const promise = handler(req, res);
      req.emitBody();
      await promise;
      expect(res.statusCode).toBe(200);
    }

    const req = createReq({
      method: "POST",
      url: "/auth/send-verification-code",
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(429);
    expect(sendVerificationCodeEmail).toHaveBeenCalledTimes(3);
    expect(createEmailVerificationCodeImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects browser requests from non-extension origins", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => true,
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({
      method: "POST",
      url: "/analytics/events",
      headers: { origin: "https://example.com" },
      body: JSON.stringify({ deviceId: "dev-1", event: "parse_success" }),
    });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(403);
    expect(parsePayload(res).error).toMatch(/origin is not allowed/i);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("echoes extension origins in cors headers", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({
      method: "GET",
      url: "/healthz",
      headers: { origin: "chrome-extension://abcdefghijklmnop" },
    });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("chrome-extension://abcdefghijklmnop");
    expect(res.headers.Vary).toBe("Origin");
  });

  it("renders the dashboard when the admin token is present", async () => {
    const db = {
      devices: [{ deviceId: "dev-1" }],
      users: [{ userId: "usr-1", createdAt: Date.now() }],
      analytics_events: [{ event: "extension_installed", deviceId: "dev-1", ts: Date.now() }],
      email_verification_codes: [],
    };
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      loadDbImpl: () => db,
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({ method: "GET", url: "/?adminToken=admin-token" });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toMatch(/text\/html/i);
    expect(res.payload).toMatch(/<html lang="zh-CN">/);
    expect(res.payload).toMatch(/插件使用状态面板/);
  });

  it("renders an admin token gate when the root route is unauthenticated", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({ method: "GET", url: "/" });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toMatch(/text\/html/i);
    expect(res.payload).toMatch(/Admin Token/);
  });

  it("requires admin auth on the local admin data route", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({ method: "GET", url: "/admin/data" });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(401);
    expect(parsePayload(res).error).toMatch(/admin authorization required/i);
  });

  it("accepts admin token in query params for dashboard refresh data", async () => {
    const now = Date.now();
    const db = {
      devices: [{ deviceId: "dev-1" }],
      users: [{ userId: "usr-1", createdAt: now }],
      analytics_events: [{ event: "parse_success", deviceId: "dev-1", ts: now }],
      email_verification_codes: [],
    };
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      loadDbImpl: () => db,
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({ method: "GET", url: "/admin/data?adminToken=admin-token" });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(200);
    const payload = parsePayload(res);
    expect(payload.ok).toBe(true);
    expect(payload.summary.totals.devices).toBe(1);
    expect(Array.isArray(payload.series)).toBe(true);
  });
});
