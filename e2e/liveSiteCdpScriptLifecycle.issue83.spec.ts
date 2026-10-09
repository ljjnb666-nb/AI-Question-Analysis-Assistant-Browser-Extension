import { expect, test } from "@playwright/test";
import { createCdpScriptLifecycleDiagnostic } from "./helpers/liveSiteCdpScriptLifecycle";

test("ISSUE83_CDP_01 buckets script request host/path and lifecycle without exposing private input", () => {
  let now = 0;
  const probe = createCdpScriptLifecycleDiagnostic(() => now);
  probe.requestWillBeSent({
    requestId: "secret-request-id-A", type: "Script",
    request: { url: "https://pintia.cn/assets/secret.js?token=very-sensitive" },
  });
  probe.requestWillBeSent({
    requestId: "secret-request-id-B", type: "Script",
    request: { url: "https://api.pintia.cn/static/loader.js?key=do-not-log" },
  });
  probe.requestWillBeSent({
    requestId: "secret-request-id-C", type: "Script",
    request: { url: "https://pintia.cn.evil.invalid/evil.js?session=private" },
  });
  // Non-script, spoofed host, and hostile metadata must never be copied.
  probe.requestWillBeSent({
    requestId: "document-not-script", type: "Document",
    request: { url: "https://pintia.cn/assets/ignore.js?token=hidden" },
  });
  probe.requestWillBeSentExtraInfo({ requestId: "secret-request-id-A", headers: { Cookie: "private" } } as { requestId: string });
  probe.responseReceived({
    requestId: "secret-request-id-B",
    response: {
      fromDiskCache: true, fromServiceWorker: true, connectionReused: true,
      headers: { "Set-Cookie": "private" },
    },
  } as { requestId: string });
  now = 24_000;
  const out = probe.snapshot();
  expect(out).toMatchObject({
    observedScriptRequests: 3, pendingScriptRequests: 3, completedScriptRequests: 0,
    oldestPendingAge: "over17s",
    pendingByPathClass: [
      { pathClass: "assets", count: 1 },
      { pathClass: "static", count: 1 },
      { pathClass: "rootFile", count: 1 },
      { pathClass: "otherPath", count: 0 },
    ],
    responseSources: { fromDiskCache: 1, fromServiceWorker: 1, connectionReused: 1 },
  });
  expect(out.pendingByHostAndStage).toContainEqual({ hostClass: "pintiaApex", stage: "headersMetadataObserved", count: 1 });
  expect(out.pendingByHostAndStage).toContainEqual({ hostClass: "pintiaSubdomain", stage: "responseObserved", count: 1 });
  expect(out.pendingByHostAndStage).toContainEqual({ hostClass: "otherHost", stage: "requestObserved", count: 1 });
  const output = JSON.stringify(out);
  for (const secret of ["secret", "sensitive", "private", "evil.invalid", "loader.js", "request-id", "Set-Cookie", "http"]) {
    expect(output).not.toContain(secret);
  }
  expect(Object.keys(out)).not.toContain("ready");
  probe.loadingFailed({ requestId: "secret-request-id-A", errorText: "net::ERR_ABORTED" });
  probe.loadingFailed({ requestId: "secret-request-id-C", errorText: "private-network-unknown-error?token=abc" });
  probe.loadingFinished({ requestId: "secret-request-id-B" });
  const final = probe.snapshot();
  expect(final).toMatchObject({
    pendingScriptRequests: 0, completedScriptRequests: 1, failedScriptRequests: 2,
    failures: { aborted: 1, other: 1 },
  });
  expect(JSON.stringify(final)).not.toContain("private-network-unknown-error");
});

test("ISSUE83_CDP_02 strictly bounds pending records even if a page issues excessive requests", () => {
  const probe = createCdpScriptLifecycleDiagnostic();
  for (let i = 0; i < 80; i += 1) {
    probe.requestWillBeSent({ requestId: String(i), type: "Script", request: { url: "https://pintia.cn/secret.js" } });
  }
  const result = probe.snapshot();
  expect(result).toMatchObject({
    observedScriptRequests: 80, pendingScriptRequests: 64, droppedScriptEvents: 16,
  });
  expect(result.pendingByHostAndStage.reduce((n, item) => n + item.count, 0)).toBe(64);
});

test("ISSUE83_CDP_03 real Chromium CDP observes an intercepted slow script before its response", async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("https://controlled.invalid/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/static/slow.js") {
      await gate;
      await route.fulfill({ status: 200, contentType: "application/javascript",
        body: 'document.querySelector("#state").textContent = "SCRIPT_FINISHED";',
      }).catch(() => undefined);
    } else {
      await route.fulfill({ status: 200, contentType: "text/html",
        body: '<!doctype html><html><body><span id="state">SHELL</span><script src="/static/slow.js"></script></body></html>',
      });
    }
  });
  const session = await page.context().newCDPSession(page);
  const diagnostic = createCdpScriptLifecycleDiagnostic();
  session.on("Network.requestWillBeSent", (e) => diagnostic.requestWillBeSent(e));
  session.on("Network.requestWillBeSentExtraInfo", (e) => diagnostic.requestWillBeSentExtraInfo(e));
  session.on("Network.responseReceived", (e) => diagnostic.responseReceived(e));
  session.on("Network.loadingFinished", (e) => diagnostic.loadingFinished(e));
  session.on("Network.loadingFailed", (e) => diagnostic.loadingFailed(e));
  try {
    await session.send("Network.enable");
    await page.goto("https://controlled.invalid/problem", { waitUntil: "commit", timeout: 5_000 });
    await expect.poll(() => diagnostic.snapshot().pendingScriptRequests, { timeout: 3_000 }).toBe(1);
    const pending = diagnostic.snapshot();
    expect(pending).toMatchObject({
      observedScriptRequests: 1, pendingScriptRequests: 1, completedScriptRequests: 0,
    });
    expect(pending.pendingByHostAndStage.find(x => x.hostClass === "otherHost" && x.stage !== "responseObserved")?.count).toBe(1);
    release();
    await expect(page.locator("#state")).toHaveText("SCRIPT_FINISHED");
    await expect.poll(() => diagnostic.snapshot().pendingScriptRequests).toBe(0);
    expect(diagnostic.snapshot()).toMatchObject({
      completedScriptRequests: 1, failedScriptRequests: 0,
    });
  } finally {
    release();
    await session.detach().catch(() => undefined);
  }
});
