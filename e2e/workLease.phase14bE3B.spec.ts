import http from "node:http";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";

type ScanResponse = { ok?: boolean; error?: string };
type ScanMessage = { type: "START_FULL_PAGE_DETECT" | "FULL_PAGE_DETECT_CANCELLED"; generationId: string };
declare const chrome: {
  tabs: {
    query: (options: { url: string }) => Promise<Array<{ id?: number }>>;
    sendMessage: (tabId: number, message: ScanMessage, options?: { frameId: number }) => Promise<ScanResponse>;
  };
  scripting: {
    executeScript: (options: { target: { tabId: number; allFrames: boolean }; files: string[] }) =>
      Promise<Array<{ frameId: number }>>;
  };
};

type ProbeWindow = Window & { __scanScrollCalls: number; __scanSubmits: number };

function pageHtml(label: string, nested: boolean): string {
  return '<!doctype html><html><head><meta charset="utf-8"><title>E3B ' + label +
    '</title></head><body style="margin:0">' +
    '<form id="never-submit" action="/__trap_submit"><input name="answer"><button type="submit">Submit</button></form>' +
    '<section class="question-item" style="width:630px;min-height:170px">' +
    '<h2>' + label + '. Which value equals two plus two?</h2>' +
    '<button>A. 3</button><button>B. 4</button><button>C. 5</button></section>' +
    (nested ? '' : '<iframe id="question-frame" src="/nested" style="height:680px;width:830px;border:0"></iframe>') +
    '<div id="long-content" style="height:' + (nested ? 5200 : label === "B" ? 22000 : 8400) + 'px"></div>' +
    '<script>window.__scanScrollCalls=0;window.__scanSubmits=0;' +
    'window.addEventListener("scroll",()=>{window.__scanScrollCalls++});' +
    'document.querySelector("#never-submit").addEventListener("submit",(event)=>{' +
    'event.preventDefault();window.__scanSubmits++});</script></body></html>';
}

async function serveProbe(): Promise<{ origin: string; submitCount: () => number; close: () => Promise<void> }> {
  let submitCount = 0;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/__trap_submit") {
      // Detect native form.submit(): it bypasses DOM submit-event listeners.
      // The server count survives any form navigation or page reload.
      submitCount += 1;
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("submission detected");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(pageHtml(pathname === "/nested" ? "frame" : pathname === "/a" ? "A" : "B", pathname === "/nested"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("E3B probe server port not bound");
  return { origin: "http://127.0.0.1:" + address.port, submitCount: () => submitCount,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

async function serviceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function tabIdFor(worker: Worker, url: string): Promise<number> {
  const id = await worker.evaluate(async (target) => {
    const matches = await chrome.tabs.query({ url: target });
    return matches[0]?.id ?? null;
  }, url);
  if (id === null) throw Error("No E3B tab: " + url);
  return id;
}

async function inject(worker: Worker, tabId: number, allFrames: boolean): Promise<number[]> {
  const frames = await worker.evaluate(({ tabId, allFrames }) => chrome.scripting.executeScript({
    target: { tabId, allFrames }, files: ["content/content-main.js"],
  }), { tabId, allFrames });
  return frames.map(frame => frame.frameId);
}

async function send(worker: Worker, tabId: number, message: ScanMessage, frameId: number): Promise<ScanResponse> {
  return worker.evaluate(({ tabId, message, frameId }) =>
    chrome.tabs.sendMessage(tabId, message, { frameId }), { tabId, message, frameId });
}

async function scrollState(page: Page): Promise<{ calls: number; top: number; submits: number }> {
  return page.evaluate(() => {
    const w = window as unknown as ProbeWindow;
    return { calls: w.__scanScrollCalls, top: window.scrollY, submits: w.__scanSubmits };
  });
}

test("@phase14b-e3b REAL_CHROMIUM isolates two tabs, nested frame and reinjection generation", async () => {
  test.slow();
  const server = await serveProbe();
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const worker = await serviceWorker(context);
    const driver = await context.newPage();
    await driver.goto("chrome-extension://" + extensionId + "/popup/popup.html");

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await tabA.goto(server.origin + "/a");
    await tabB.goto(server.origin + "/b");
    await expect(tabA.frameLocator("#question-frame").locator("#never-submit")).toBeVisible();
    await tabA.evaluate(() => window.scrollTo(0, 920));
    await tabB.evaluate(() => window.scrollTo(0, 920));
    await tabA.frameLocator("#question-frame").locator("body").evaluate(() => window.scrollTo(0, 700));
    await expect.poll(async () => (await scrollState(tabA)).top).toBe(920);
    await expect.poll(async () => (await scrollState(tabB)).top).toBe(920);
    const idA = await tabIdFor(worker, server.origin + "/a");
    const idB = await tabIdFor(worker, server.origin + "/b");
    expect(idA).not.toBe(idB);

    const frameIdsA = await inject(worker, idA, true);
    expect(frameIdsA).toContain(0);
    const frameId = frameIdsA.find(x => x !== 0);
    expect(frameId).toBeDefined();
    expect(await inject(worker, idB, false)).toContain(0);

    const oldA = "18aabcde-0ee2-4e98-8e12-48fdce879112";
    const oldB = "18aabcde-0ee2-4e98-8e12-48fdce879113";
    const oldFrame = "18aabcde-0ee2-4e98-8e12-48fdce879114";
    expect(await send(worker, idA, { type: "START_FULL_PAGE_DETECT", generationId: oldA }, 0)).toEqual({ ok: true });
    expect(await send(worker, idB, { type: "START_FULL_PAGE_DETECT", generationId: oldB }, 0)).toEqual({ ok: true });
    expect(await send(worker, idA, { type: "START_FULL_PAGE_DETECT", generationId: oldFrame }, frameId!))
      .toEqual({ ok: true });

    await expect.poll(async () => (await scrollState(tabA)).top, { timeout: 8000 }).toBe(0);
    await expect.poll(async () => (await scrollState(tabB)).top, { timeout: 8000 }).toBe(0);
    await expect.poll(async () =>
      tabA.frameLocator("#question-frame").locator("body").evaluate(() => window.scrollY),
      { timeout: 8000 },
    ).toBe(0);
    expect(await send(worker, idA, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: oldA }, 0)).toEqual({ ok: true });
    expect(await send(worker, idA, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: oldFrame }, frameId!))
      .toEqual({ ok: true });
    expect(await send(worker, idB, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: oldA }, 0))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });

    const callsBeforeUserScroll = (await scrollState(tabA)).calls;
    await tabA.evaluate(() => window.scrollTo({ top: 418, behavior: "instant" }));
    // Scroll events are dispatched asynchronously even after window.scrollTo
    // synchronously sets scrollY. The initial snapshot must include the user
    // event itself; otherwise a delayed user event appears to be stale work.
    await expect.poll(async () => (await scrollState(tabA)).calls, { timeout: 3000 })
      .toBeGreaterThan(callsBeforeUserScroll);
    const afterUserScroll = await scrollState(tabA);
    expect(afterUserScroll.top).toBe(418);
    await tabA.waitForTimeout(750);
    // Keep the strict no-new-scroll-events contract after the user event.
    expect(await scrollState(tabA)).toEqual(afterUserScroll);

    // Reinjection must not make a revoked generation valid again.
    await inject(worker, idA, false);
    expect(await send(worker, idA, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: oldA }, 0))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });

    expect(await send(worker, idB, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: oldB }, 0)).toEqual({ ok: true });
    const newB = "18aabcde-0ee2-4e98-8e12-48fdce879115";
    await expect.poll(() => send(worker, idB,
      { type: "START_FULL_PAGE_DETECT", generationId: newB }, 0),
    { timeout: 10000 }).toEqual({ ok: true });
    expect(await send(worker, idB, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: oldB }, 0))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });
    expect(await send(worker, idB, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: newB }, 0))
      .toEqual({ ok: true });

    const frameSubmits = await tabA.frameLocator("#question-frame").locator("#never-submit").evaluate(form =>
      (form.ownerDocument.defaultView as unknown as ProbeWindow).__scanSubmits);
    expect(frameSubmits).toBe(0);
    expect((await scrollState(tabA)).submits).toBe(0);
    expect((await scrollState(tabB)).submits).toBe(0);
    // A DOM event listener alone misses native form.submit() calls.
    // Real HTTP submission must also remain absent across all frames.
    expect(server.submitCount()).toBe(0);
  } finally {
    await closeExtensionContext(context);
    await server.close();
  }
});
