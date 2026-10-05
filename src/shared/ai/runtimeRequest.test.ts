import { describe, expect, it } from "vitest";
import type { AIConnectionRuntimeConfig } from "../types/connection";
import { applyRuntimeAuth, redactRequestSecret, safeRequestLabel, validateRuntimeEndpoint } from "./runtimeRequest";

describe("E2B2A endpoint and auth request boundaries", () => {
  it.each([
    "https://api.example.com/v1",
    "http://localhost:11434",
    "http://127.0.0.1:3000",
    "http://127.99.1.2:3000",
    "http://[::1]:11434",
  ])("accepts the permitted endpoint %s", endpoint => {
    expect(validateRuntimeEndpoint(endpoint).href).toBe(new URL(endpoint).href);
  });
  it.each([
    "http://api.example.com", "http://192.168.1.1", "http://10.0.0.5", "http://localhost.evil.test",
    "http://127.0.0.1.example.com", "http://0.0.0.0", "http://[::]",
    "ftp://localhost", "https://user:pass@api.example.com", "invalid",
  ])("rejects the forbidden endpoint %s without exposing it", endpoint => {
    expect(() => validateRuntimeEndpoint(endpoint)).toThrow(/^AI_ENDPOINT_/);
  });
  it("auth scheme alone selects custom header or safely encoded query placement", () => {
    const runtime = { authScheme: { kind: "query", parameterName: "custom token" } } as AIConnectionRuntimeConfig;
    const context = { runtime, credential: "secret +&?#", language: "en" as const, beforeDispatch: async () => {} };
    const url = new URL("https://example.com/v1?existing=1");
    const headers = {};
    applyRuntimeAuth(url, headers, context);
    expect(url.searchParams.get("custom token")).toBe(context.credential);
    expect(url.searchParams.get("existing")).toBe("1");
    expect(headers).toEqual({});
    expect(safeRequestLabel(url)).toBe("https://example.com/v1");
    runtime.authScheme = { kind: "header", headerName: "x-custom-key" };
    applyRuntimeAuth(new URL("https://example.com"), headers, context);
    expect(headers).toEqual({ "x-custom-key": context.credential });
  });
  it("rejects invalid header names before constructing a network request", () => {
    const runtime = { authScheme: { kind: "header", headerName: "x-key\r\nInjected: value" } } as AIConnectionRuntimeConfig;
    expect(() => applyRuntimeAuth(new URL("https://example.com"), {}, {
      runtime, credential: "secret", language: "en", beforeDispatch: async () => {},
    })).toThrow("AI_AUTH_HEADER_INVALID");
  });
  it.each(["content-type", "__proto__"])("valid custom header %s carries the exact credential", headerName => {
    const runtime = { authScheme: { kind: "header", headerName } } as AIConnectionRuntimeConfig;
    const headers = { "Content-Type": "application/json" } as Record<string, string>;
    applyRuntimeAuth(new URL("https://example.com"), headers, { runtime, credential: "exact-header-secret", language: "en", beforeDispatch: async () => {} });
    expect(Object.prototype.hasOwnProperty.call(headers, headerName)).toBe(true);
    expect(headers[headerName]).toBe("exact-header-secret");
    if (headerName === "content-type") expect(headers).not.toHaveProperty("Content-Type");
    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype);
  });
  it("redacts direct, URI, and form encoded credential echoes", () => {
    const secret = "secret +&?#";
    const echo = `${secret} ${encodeURIComponent(secret)} ${new URLSearchParams({ key: secret })}`;
    const safe = redactRequestSecret(echo, secret);
    expect(safe).not.toContain(secret);
    expect(safe).not.toContain(encodeURIComponent(secret));
    expect(safe).not.toContain(new URLSearchParams({ key: secret }).toString().slice(4));
  });
});
