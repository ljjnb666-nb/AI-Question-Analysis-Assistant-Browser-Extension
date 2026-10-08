import { randomUUID } from "node:crypto";
import http from "node:http";
import { expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";
import { readExtensionSettings, seedExtensionSettings, startTestAnalyticsBackend } from "./helpers/authUiHarness";

type RunMessage =
  | { type: "START_FULL_PAGE_DETECT" | "FULL_PAGE_DETECT_CANCELLED"; generationId: string }
  | { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT"; expectedUrl: string };

type RunResponse = { ok?: boolean; error?: string; snapshot?: { fullPage?: { running?: boolean } } };
type ProbeWindow = Window & { __submitEvents: number };

declare const chrome: {
  tabs: {
    query: (filter: { url: string }) => Promise<Array<{ id?: number }>>;
    sendMessage: (tabId: number, message: RunMessage, options: { frameId: number }) => Promise<RunResponse>;
  };
  scripting: {
    executeScript: (options: { target: { tabId: number; allFrames: boolean }; files: string[] }) =>
      Promise<Array<{ frameId: number }>>;
  };
  storage: { session: {
    set: (values: Record<string, unknown>) => Promise<void>;
    get: (keys: null) => Promise<Record<string, unknown>>;
  } };
};

function html(name: string, nested: boolean): string {
  return '<!doctype html><html><head><meta charset="utf-8"><title>E3B02A ' + name +
    '</title></head><body style="margin:0">' +
    '<form action="/__trap_submit" id="never-submit"><input name="answer"><button type="submit">Submit</button></form>' +
    '<section class="question-item" style="min-height:180px"><h2>' + name +
    '. What is the result of two plus two?</h2><p>A. 3 B. 4 C. 5</p></section>' +
    (nested ? '' : '<iframe id="question-frame" src="/nested" style="width:830px;height:650px;border:0"></iframe>') +
    '<div style="height:180000px"></div>' +
    '<script>window.__submitEvents=0;document.querySelector("form").addEventListener("submit",e=>{' +
    'e.preventDefault();window.__submitEvents++});</script></body></html>';
}

async function probeServer(): Promise<{ origin: string; submitted: () => number; close: () => Promise<void> }> {
  let submits = 0;
  const server = http.createServer((req, res) => {
    const route = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (route === "/__trap_submit") {
      submits += 1; // Catches native form.submit(), which bypasses submit events.
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end("submission detected");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html(route === "/nested" ? "frame" : route === "/a" ? "A" : "B", route === "/nested"));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("E3B02A server did not bind");
  return {
    origin: "http://127.0.0.1:" + address.port,
    submitted: () => submits,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function getWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function tabIdFor(worker: Worker, url: string): Promise<number> {
  const id = await worker.evaluate(async target => {
    const tabs = await chrome.tabs.query({ url: target });
    return tabs[0]?.id ?? null;
  }, url);
  if (id === null) throw Error("E3B02A tab missing");
  return id;
}

async function send(worker: Worker, tabId: number, frameId: number, message: RunMessage): Promise<RunResponse> {
  return worker.evaluate(({ tabId, frameId, message }) =>
    chrome.tabs.sendMessage(tabId, message, { frameId }), { tabId, frameId, message });
}

async function activeOwnerKeys(worker: Worker): Promise<string[]> {
  return worker.evaluate(async () => {
    const records = await chrome.storage.session.get(null);
    return Object.keys(records).filter(key => key.startsWith("protectedWorkOwner:")).sort();
  });
}

async function scrollPosition(page: Page): Promise<{ top: number; submitEvents: number }> {
  return page.evaluate(() => ({
    top: window.scrollY,
    submitEvents: (window as unknown as ProbeWindow).__submitEvents,
  }));
}

test("@phase14b-e3b2a REAL_SERVER_REVOCATION stops leased real Chromium Tab/Frame scans", async () => {
  test.setTimeout(150_000);
  const backend = await startTestAnalyticsBackend();
  const server = await probeServer();
  let context: BrowserContext | undefined;
  try {
    const account = await backend.registerAccount("e3b2a-real-revoke");
    context = await launchExtensionContext();
    const extId = await resolveExtensionId(context);
    const worker = await getWorker(context);
    await seedExtensionSettings(context, extId, {
      analyticsBaseUrl: backend.baseUrl,
      userId: account.userId,
      userEmail: account.email,
      authToken: account.authToken,
    });

    const sidepanel = await context.newPage();
    await sidepanel.goto("chrome-extension://" + extId + "/sidepanel/sidepanel.html");
    // This authenticated state MUST come from the real analytics handler.
    await expect(sidepanel.getByText(/^(工作台|Workspace)$/)).toBeVisible({ timeout: 25_000 });

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await tabA.goto(server.origin + "/a");
    await tabB.goto(server.origin + "/b");
    await expect(tabA.frameLocator("#question-frame").locator("#never-submit")).toBeVisible();
    const idA = await tabIdFor(worker, server.origin + "/a");
    const idB = await tabIdFor(worker, server.origin + "/b");
    expect(idA).not.toBe(idB);

    const framesA = await worker.evaluate(async tabId => chrome.scripting.executeScript({
      target: { tabId, allFrames: true }, files: ["content/content-main.js"],
    }), idA);
    const frameA = framesA.find(frame => frame.frameId !== 0)?.frameId;
    expect(frameA).toBeDefined();
    await worker.evaluate(async tabId => chrome.scripting.executeScript({
      target: { tabId, allFrames: false }, files: ["content/content-main.js"],
    }), idB);

    const generations = [randomUUID(), randomUUID(), randomUUID()] as const;
    const ownerKeys = [
      `protectedWorkOwner:fullPage:${idA}:${generations[0]}`,
      `protectedWorkOwner:fullPage:${idB}:${generations[1]}`,
      `protectedWorkOwner:fullPage:${idA}:${generations[2]}`,
    ];
    // Fixture boundary: seed immutable ownership records directly in REAL
    // chrome.storage.session. Runtime starts and auth-loss STOP transport use
    // the REAL extension. UI-driven START is a separate E3B-02B acceptance.
    await worker.evaluate(async ({ keys, tabIds }) => {
      const values: Record<string, unknown> = {};
      keys.forEach((key, index) => {
        values[key] = { active: true, tabId: tabIds[index], completionProtocol: "generation" };
      });
      await chrome.storage.session.set(values);
    }, { keys: ownerKeys, tabIds: [idA, idB, idA] });

    for (const [tabId, frameId, generationId] of [
      [idA, 0, generations[0]], [idB, 0, generations[1]], [idA, frameA!, generations[2]],
    ] as Array<[number, number, string]>) {
      expect(await send(worker, tabId, frameId, { type: "START_FULL_PAGE_DETECT", generationId }))
        .toEqual({ ok: true });
    }
    // Prove scans were in flight BEFORE revocation; the revoked session alone
    // does not prove that any content execution was actually interrupted.
    for (const [tabId, frameId, url] of [
      [idA, 0, server.origin + "/a"], [idB, 0, server.origin + "/b"],
      [idA, frameA!, server.origin + "/nested"],
    ] as Array<[number, number, string]>) {
      await expect.poll(async () => {
        const result = await send(worker, tabId, frameId,
          { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: url });
        return result.snapshot?.fullPage?.running === true;
      }, { timeout: 8_000 }).toBe(true);
    }

    await backend.revokeSession(account.userId, account.authToken);
    // A new real Popup must validate against the REVOKED server session.
    // Its authoritative 401 clears shared credentials; the already-open
    // Side Panel observes storage loss and delivers generation-tagged STOP.
    const popup = await context.newPage();
    await popup.goto("chrome-extension://" + extId + "/popup/popup.html");
    await expect(popup.getByRole("button", { name: /^(发送验证码|Send Code|登录|Login)$/ }).first())
      .toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const settings = await readExtensionSettings(sidepanel);
      return !settings.authToken && !settings.userId;
    }, { timeout: 20_000 }).toBe(true);
    await expect(sidepanel.getByText(/^(工作台|Workspace)$/)).toHaveCount(0, { timeout: 20_000 });

    await expect.poll(async () => (await activeOwnerKeys(worker)).filter(k => ownerKeys.includes(k)).length,
      { timeout: 15_000 }).toBe(0);
    // STOP/CANCEL was really delivered to the current runtime in EACH frame:
    // a duplicate targeted STOP must now be rejected as stale.
    expect(await send(worker, idA, 0, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: generations[0] }))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });
    expect(await send(worker, idB, 0, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: generations[1] }))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });
    expect(await send(worker, idA, frameA!, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: generations[2] }))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });

    await tabA.evaluate(() => window.scrollTo({ top: 418, behavior: "instant" }));
    await tabB.evaluate(() => window.scrollTo({ top: 527, behavior: "instant" }));
    await tabA.frameLocator("#question-frame").locator("body").evaluate(() =>
      window.scrollTo({ top: 336, behavior: "instant" }));
    const a = await scrollPosition(tabA);
    const b = await scrollPosition(tabB);
    const nested = await tabA.frameLocator("#question-frame").locator("body").evaluate(() => window.scrollY);
    await tabA.waitForTimeout(900);
    expect(await scrollPosition(tabA)).toEqual(a);
    expect(await scrollPosition(tabB)).toEqual(b);
    expect(await tabA.frameLocator("#question-frame").locator("body").evaluate(() => window.scrollY)).toBe(nested);
    expect(a.submitEvents).toBe(0);
    expect(b.submitEvents).toBe(0);
    expect(await tabA.frameLocator("#question-frame").locator("body").evaluate(() =>
      (window as unknown as ProbeWindow).__submitEvents)).toBe(0);
    expect(server.submitted()).toBe(0); // native HTMLFormElement.submit also prohibited.
  } finally {
    if (context) await closeExtensionContext(context);
    await server.close();
    await backend.close();
  }
});
