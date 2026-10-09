import { EventEmitter } from "node:events";
import type { ClientRequest, RequestOptions } from "node:http";
import { expect, test } from "@playwright/test";
import {
  createPendingPintiaScriptHostTracker, isPublicIpv4, probePendingPintiaScriptHost,
} from "./helpers/pintiaScriptSubdomainNetworkProbe";

const fakeRequest = (type: string, url: string) => ({
  resourceType: () => type,
  url: () => url,
});

test("ISSUE83_HOST_01 selects only still-pending HTTPS Pintia subdomain scripts", () => {
  const tracker = createPendingPintiaScriptHostTracker();
  const apex = fakeRequest("script", "https://pintia.cn/client.js");
  const spoof = fakeRequest("script", "https://api.pintia.cn.evil.invalid/steal.js");
  const userInfo = fakeRequest("script", "https://token@api.pintia.cn/secret.js");
  const wrongScheme = fakeRequest("script", "http://api.pintia.cn/script.js");
  const document = fakeRequest("document", "https://static.pintia.cn/ignored.js");
  const valid = fakeRequest("script", "https://static.pintia.cn/deep/script.mjs?token=NEVER_PRINT");
  for (const req of [apex, spoof, userInfo, wrongScheme, document, valid]) tracker.started(req);
  expect(tracker.publicSummary()).toEqual({
    eligiblePendingScripts: 1, distinctPendingSubdomainCount: 1,
  });
  // The private hostname is consumed only by the probe and must never be printed.
  expect(tracker.pendingHost()).toBe("static.pintia.cn");
  tracker.finished(valid);
  expect(tracker.pendingHost()).toBeNull();
  expect(JSON.stringify(tracker.publicSummary())).not.toContain("static.pintia.cn");
  expect(JSON.stringify(tracker.publicSummary())).not.toContain("NEVER_PRINT");
});

test("ISSUE83_HOST_02 rejects SSRF targets, non-public DNS and mixed public/private records", async () => {
  for (const addr of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.169.254",
    "100.64.1.1", "192.0.2.1", "198.51.100.4", "203.0.113.2",
    "198.18.0.1", "224.0.0.1", "::1",
  ]) {
    expect(isPublicIpv4(addr), addr).toBe(false);
  }
  expect(isPublicIpv4("8.8.8.8")).toBe(true);
  let calls = 0;
  const request = (() => {
    calls += 1;
    throw new Error("REQUEST_MUST_NOT_BE_SENT");
  }) as unknown as (options: RequestOptions) => ClientRequest;
  const blocked = await probePendingPintiaScriptHost("static.pintia.cn", {
    resolve: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ],
    request,
  });
  expect(blocked.outcome).toBe("blockedResolution");
  expect(calls).toBe(0);
  const skipped = await probePendingPintiaScriptHost("pintia.cn", { request });
  expect(skipped.outcome).toBe("ineligibleHost");
  expect(calls).toBe(0);
});

test("ISSUE83_HOST_03 one pinned-public-IP anonymous HEAD, sanitized DNS/TCP/TLS/header stages", async () => {
  let tick = 100;
  let calls = 0;
  let observedOptions: RequestOptions | null = null;
  const transport = ((options: RequestOptions) => {
    calls += 1;
    observedOptions = options;
    const req = new EventEmitter() as ClientRequest;
    req.destroy = (() => req) as ClientRequest["destroy"];
    req.end = (() => {
      queueMicrotask(() => {
        const socket = new EventEmitter();
        req.emit("socket", socket);
        tick += 250;
        socket.emit("connect");
        tick += 250;
        socket.emit("secureConnect");
        tick += 400;
        const resp = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
        resp.statusCode = 405;
        resp.resume = () => undefined;
        req.emit("response", resp);
      });
      return req;
    }) as unknown as ClientRequest["end"];
    return req;
  }) as (options: RequestOptions) => ClientRequest;
  const result = await probePendingPintiaScriptHost("cdn.pintia.cn", {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: transport,
    now: () => tick,
    timeoutMs: 200,
  });
  expect(calls).toBe(1);
  expect(observedOptions).toMatchObject({
    hostname: "cdn.pintia.cn", servername: "cdn.pintia.cn", protocol: "https:",
    method: "HEAD", path: "/", agent: false, rejectUnauthorized: true,
    headers: { Accept: "*/*" },
  });
  expect((observedOptions as unknown as { lookup: (host: string, o: unknown, cb: (err: null, ip: string, family: number) => void) => void }).lookup).toBeTypeOf("function");
  const lookupFn = (observedOptions as unknown as { lookup: (host: string, o: unknown, cb: (err: null, ip: string, family: number) => void) => void }).lookup;
  let ip: string | undefined;
  lookupFn("cdn.pintia.cn", {}, (_err, resolved) => { ip = resolved; });
  expect(ip).toBe("8.8.8.8");
  expect(result).toMatchObject({
    target: "pending-pintia-script-subdomain",
    requestMethod: "HEAD", requestPath: "/",
    outcome: "response", httpStatusClass: "4xx",
    totalLatencyBucket: "under1s",
  });
  expect(result.milestones.every(x => x.observed)).toBe(true);
  for (const secret of ["cdn.pintia.cn", "8.8.8.8", "token", "password", "Cookie", "http"]) {
    expect(JSON.stringify(result)).not.toContain(secret);
  }
});

test("ISSUE83_HOST_04 bounded DNS timeout and raw error cannot turn failure into a pass", async () => {
  let requestCalls = 0;
  const transport = (() => {
    requestCalls += 1;
    throw new Error("NEVER_EXECUTE");
  }) as unknown as (options: RequestOptions) => ClientRequest;
  const timed = await probePendingPintiaScriptHost("cdn.pintia.cn", {
    resolve: async () => await new Promise(() => undefined),
    request: transport, timeoutMs: 20,
  });
  expect(timed.outcome).toBe("timeout");
  expect(requestCalls).toBe(0);
  expect(timed.milestones.every(m => !m.observed)).toBe(true);
  const errored = await probePendingPintiaScriptHost("cdn.pintia.cn", {
    resolve: async () => { throw new Error("private DNS full response with secret IP"); },
    request: transport,
  });
  expect(errored.outcome).toBe("dnsUnavailable");
  expect(JSON.stringify(errored)).not.toContain("private");
  expect(requestCalls).toBe(0);
});
