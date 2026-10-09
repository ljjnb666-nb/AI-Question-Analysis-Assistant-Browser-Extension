import { expect, test } from "@playwright/test";
import { createScriptNetworkStageProbe } from "./helpers/liveSiteScriptNetworkStage";

type FakeRequest = { url(): string; resourceType(): string };
const fakeScript = (url: string): FakeRequest => ({ url: () => url, resourceType: () => "script" });

test("ISSUE83_NETWORK_01 separates pending response-headers stage without logging resource URLs", () => {
  let time = 100;
  const probe = createScriptNetworkStageProbe(() => time);
  const beforeHeaders = fakeScript("https://pintia.cn/secret.js?token=private-abc");
  const afterHeaders = fakeScript("https://api.pintia.cn/owned.js?key=private-def");
  const other = fakeScript("https://pintia.cn.attacker.invalid/evil.js?token=private-xyz");
  probe.onRequest(beforeHeaders);
  probe.onRequest(afterHeaders);
  probe.onRequest(other);
  probe.onResponse({ request: () => afterHeaders, status: () => 200 });
  time += 22_000;
  const snapshot = probe.snapshot();
  expect(snapshot).toMatchObject({
    observedScripts: 3, pendingScripts: 3, completedScripts: 0, failedScripts: 0,
    firstPartyBeforeHeaders: 1, firstPartyAfterHeaders: 1,
    otherBeforeHeaders: 1, otherAfterHeaders: 0,
    pending2xx: 1, oldestPendingAge: "over17s",
  });
  for (const secret of ["secret.js", "owned.js", "evil.js", "private-abc", "private-def", "private-xyz", "attacker.invalid"]) {
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  }
  probe.onFinished(afterHeaders);
  probe.onFailed(other);
  const final = probe.snapshot();
  expect(final).toMatchObject({
    pendingScripts: 1, firstPartyBeforeHeaders: 1,
    firstPartyAfterHeaders: 0, otherBeforeHeaders: 0,
    completedScripts: 1, failedScripts: 1,
  });
  expect(Object.keys(final)).not.toContain("ready");
});

test("ISSUE83_NETWORK_02 controlled Chromium reports an in-flight slow script before headers", async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const probe = createScriptNetworkStageProbe();
  page.on("request", (request) => probe.onRequest(request));
  page.on("response", (response) => probe.onResponse(response));
  page.on("requestfinished", (request) => probe.onFinished(request));
  page.on("requestfailed", (request) => probe.onFailed(request));
  await page.route("https://controlled.invalid/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/slow.js") {
      await gate;
      await route.fulfill({
        status: 200, contentType: "application/javascript",
        body: 'document.querySelector("#out").textContent = "REAL_JS_EXECUTED";',
      }).catch(() => undefined);
    } else {
      await route.fulfill({
        status: 200, contentType: "text/html",
        body: '<!doctype html><body><div id="out">APP_SHELL</div><script src="/slow.js"></script></body>',
      });
    }
  });
  try {
    const response = await page.goto("https://controlled.invalid/problem", { waitUntil: "commit", timeout: 5_000 });
    expect(response?.status()).toBe(200);
    await expect.poll(() => probe.snapshot().otherBeforeHeaders, { timeout: 2_000 }).toBe(1);
    expect(probe.snapshot()).toMatchObject({
      observedScripts: 1, pendingScripts: 1, firstPartyBeforeHeaders: 0,
      otherBeforeHeaders: 1, otherAfterHeaders: 0, pending2xx: 0,
    });
    expect(await page.locator("#out").textContent()).toBe("APP_SHELL");
    release();
    await expect(page.locator("#out")).toHaveText("REAL_JS_EXECUTED");
    await expect.poll(() => probe.snapshot().pendingScripts).toBe(0);
    expect(probe.snapshot()).toMatchObject({ completedScripts: 1, failedScripts: 0 });
  } finally {
    release();
  }
});
