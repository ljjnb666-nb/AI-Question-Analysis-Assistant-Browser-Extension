import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { probePintiaOrigin, projectPublicOriginEvidence } from "./phase13-public-origin-probe.mjs";

test("ISSUE83_ORIGIN_01 only one fixed anonymous HEAD to Pintia apex, stages are allowlisted", async () => {
  let transportCalls = 0;
  let networkOptions;
  let tick = 1000;
  const transport = (options) => {
    transportCalls += 1;
    networkOptions = options;
    const req = new EventEmitter();
    req.destroy = () => undefined;
    req.end = () => {
      queueMicrotask(() => {
        const socket = new EventEmitter();
        req.emit("socket", socket);
        tick += 200;
        socket.emit("lookup", null, "SECRET_RESOLVED_IP", 4, "pintia.cn");
        tick += 300;
        socket.emit("connect");
        tick += 200;
        socket.emit("secureConnect");
        tick += 100;
        const response = new EventEmitter();
        response.statusCode = 405;
        response.resume = () => undefined;
        req.emit("response", response);
      });
    };
    return req;
  };
  const result = await probePintiaOrigin({ transport, clock: () => tick, timeoutMs: 50 });
  assert.equal(transportCalls, 1);
  assert.deepEqual(networkOptions, {
    protocol: "https:", hostname: "pintia.cn", port: 443,
    method: "HEAD", path: "/", agent: false,
    rejectUnauthorized: true, headers: { Accept: "*/*" },
  });
  assert.equal(result.outcome, "response");
  assert.equal(result.httpStatusClass, "4xx");
  assert.equal(result.totalLatencyBucket, "under1s");
  assert.deepEqual(result.milestones.map(x => x.phase), ["dns", "tcp", "tls", "headers"]);
  assert(result.milestones.every(x => x.observed));
  const output = JSON.stringify(result);
  for (const secret of ["SECRET_RESOLVED_IP", "private", "token", "errorText", "https://"]) {
    assert(!output.includes(secret), `Sensitive value in diagnostic: ${secret}`);
  }
});

test("ISSUE83_ORIGIN_02 timeout aborts a hung request without inventing DNS/TLS completion", async () => {
  let destroyed = 0;
  const transport = () => {
    const req = new EventEmitter();
    req.end = () => undefined;
    req.destroy = () => { destroyed += 1; };
    return req;
  };
  const result = await probePintiaOrigin({ transport, timeoutMs: 15 });
  assert.equal(result.outcome, "timeout");
  assert.equal(result.httpStatusClass, "none");
  assert.equal(destroyed, 1);
  assert(result.milestones.every(x => !x.observed && x.latencyBucket === "unobserved"));
  assert.equal(result.target, "pintia-public-apex");
});

test("ISSUE83_ORIGIN_03 raw transport error messages and arbitrary metadata never escape", async () => {
  const transport = () => {
    const req = new EventEmitter();
    req.end = () => {
      queueMicrotask(() => req.emit("error", new Error("SECRET https://evil.example/?token=123")));
    };
    req.destroy = () => undefined;
    return req;
  };
  const result = await probePintiaOrigin({ transport, timeoutMs: 50 });
  assert.equal(result.outcome, "error");
  assert(!JSON.stringify(result).includes("SECRET"));
  assert(!JSON.stringify(result).includes("evil.example"));
  const projected = projectPublicOriginEvidence({
    start: 0, finished: 20, marks: { dns: 4, privateToken: "do-not-emit" },
    outcome: "unsafe-private-secret", status: 777,
    userCookie: "token=private",
  });
  assert.equal(projected.outcome, "error");
  assert.equal(projected.httpStatusClass, "none");
  assert(!JSON.stringify(projected).includes("do-not-emit"));
  assert(!JSON.stringify(projected).includes("userCookie"));
  assert.equal(projected.milestones.find(x => x.phase === "dns").observed, true);
  assert.equal(projected.milestones.find(x => x.phase === "tls").observed, false);
});

test("ISSUE83_ORIGIN_04 invalid network budget is rejected before any request", async () => {
  let called = false;
  await assert.rejects(
    probePintiaOrigin({ timeoutMs: 60_000, transport: () => { called = true; } }),
    /PHASE13_ORIGIN_PROBE_BUDGET_INVALID/,
  );
  assert.equal(called, false);
});
