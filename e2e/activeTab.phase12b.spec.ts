import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import type { BrowserContext, Worker } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext } from "./helpers/extensionHarness";

const execFileAsync = promisify(execFile);

type Phase12BTab = { id?: number; active?: boolean; url?: string };
type Phase12BInjectionResult = { result?: unknown };
declare const chrome: {
  commands: {
    getAll: () => Promise<Array<{ name?: string; shortcut?: string }>>;
  };
  tabs: {
    query: (query: { active?: boolean; currentWindow?: boolean }) => Promise<Phase12BTab[]>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  };
  scripting: {
    executeScript: (options: {
      target: { tabId: number };
      files?: string[];
      func?: () => Promise<unknown>;
    }) => Promise<Phase12BInjectionResult[]>;
  };
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown>;
  };
};

type CaptureResponse = { dataUrl?: string; error?: string };
type BlockCaptureResponse = { ok?: boolean; dataUrl?: string; error?: string };
type PngInfo = { bytes: number; width: number; height: number };

async function startProbeServer(label: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Phase 12B ${label} ${url.pathname}</title></head>
<body style="margin:0;background:${label === "A" ? "#dff4ff" : "#ffe8d8"};color:#102030">
  <main id="probe" style="width:720px;height:520px;padding:32px;box-sizing:border-box">
    <h1>Phase 12B ${label}</h1>
    <p data-path="${url.pathname}">${url.pathname}</p>
    <form id="never-submit"><input name="answer" value=""><button type="submit">Submit</button></form>
    <script>
      window.__phase12bSubmitCount = 0;
      document.querySelector("#never-submit").addEventListener("submit", (event) => {
        event.preventDefault();
        window.__phase12bSubmitCount += 1;
      });
    </script>
  </main>
</body>
</html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Phase 12B probe server did not report a port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function getExtensionWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

async function getRegisteredActionShortcut(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const commands = await chrome.commands.getAll();
    return commands.find((command) => command.name === "_execute_action")?.shortcut || "";
  });
}

async function getActiveTabId(worker: Worker): Promise<number> {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active HTTP tab");
    return tab.id;
  });
}

async function captureViaProductionRoute(worker: Worker, tabId: number): Promise<CaptureResponse> {
  return worker.evaluate(async (id) => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: async () => await chrome.runtime.sendMessage({ type: "CAPTURE_TAB_SCREENSHOT" }),
    });
    return (result || {}) as CaptureResponse;
  }, tabId);
}

async function captureBlockViaProductionRoute(
  worker: Worker,
  tabId: number,
): Promise<BlockCaptureResponse> {
  return worker.evaluate(async (id) => {
    try {
      await chrome.tabs.sendMessage(id, { type: "CAPTURE_BLOCK_IMAGE", bbox: { x: 20, y: 20, width: 280, height: 180 } });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        files: ["content/content-main.js"],
      });
    }
    return await chrome.tabs.sendMessage(id, {
      type: "CAPTURE_BLOCK_IMAGE",
      bbox: { x: 20, y: 20, width: 280, height: 180 },
    }) as BlockCaptureResponse;
  }, tabId);
}

function inspectPng(dataUrl: string | undefined): PngInfo {
  expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  const encoded = String(dataUrl).slice(String(dataUrl).indexOf(",") + 1);
  const bytes = Buffer.from(encoded, "base64");
  expect(bytes.length).toBeGreaterThan(512);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return {
    bytes: bytes.length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function authorityDenied(response: CaptureResponse | BlockCaptureResponse): boolean {
  return /Either the '<all_urls>' or 'activeTab' permission is required|activeTab|has not been invoked/i.test(
    String(response.error || ""),
  );
}

async function invokeRealBrowserActionShortcut(): Promise<{ windowId: string; windowName: string }> {
  const search = await execFileAsync("xdotool", [
    "search",
    "--onlyvisible",
    "--name",
    "Phase 12B A /one",
  ]);
  const windowIds = search.stdout.split(/\s+/).map((value) => value.trim()).filter(Boolean);
  if (windowIds.length === 0) {
    throw new Error("xdotool did not find the visible Phase 12B Chromium window");
  }

  let windowId = "";
  let windowName = "";
  for (const candidate of windowIds) {
    const name = await execFileAsync("xdotool", ["getwindowname", candidate]);
    if (name.stdout.includes("Phase 12B A /one")) {
      windowId = candidate;
      windowName = name.stdout.trim();
      break;
    }
  }
  if (!windowId) {
    throw new Error("xdotool found windows but none matched the Phase 12B browser title");
  }

  await execFileAsync("xdotool", ["windowraise", windowId]);
  await execFileAsync("xdotool", ["windowfocus", "--sync", windowId]);
  await execFileAsync("xdotool", ["key", "ctrl+shift+y"]);
  return { windowId, windowName };
}

async function writeDataUrlPng(filePath: string, dataUrl: string): Promise<void> {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  await writeFile(filePath, Buffer.from(encoded, "base64"));
}

test("@phase12b REAL_USER_ACTIVATION_ACTIVE_TAB_LIFECYCLE proves screenshot grant and revocation boundaries", async () => {
  test.slow();
  const serverA = await startProbeServer("A");
  const serverB = await startProbeServer("B");
  const context = await launchExtensionContext();
  const evidenceDir = path.resolve("test-results", "phase12b-evidence");

  try {
    await mkdir(evidenceDir, { recursive: true });
    const worker = await getExtensionWorker(context);
    const shortcut = await getRegisteredActionShortcut(worker);
    expect(shortcut).toBe("Ctrl+Shift+Y");

    const target = await context.newPage();
    await target.setViewportSize({ width: 1100, height: 760 });
    await target.goto(`${serverA.origin}/one`);
    await target.bringToFront();

    const targetTabId = await getActiveTabId(worker);
    const beforeGrant = await captureViaProductionRoute(worker, targetTabId);
    expect(beforeGrant.dataUrl).toBeUndefined();
    expect(authorityDenied(beforeGrant)).toBe(true);

    const xAction = await invokeRealBrowserActionShortcut();

    const grantedCapture = await expect.poll(
      async () => captureViaProductionRoute(worker, targetTabId),
      { timeout: 10_000, intervals: [200, 400, 800] },
    ).toMatchObject({ error: undefined }).then(async () => captureViaProductionRoute(worker, targetTabId));

    expect(grantedCapture.error).toBeUndefined();
    const grantedPng = inspectPng(grantedCapture.dataUrl);
    expect(grantedPng.width).toBeGreaterThanOrEqual(900);
    expect(grantedPng.height).toBeGreaterThanOrEqual(600);

    const blockCapture = await captureBlockViaProductionRoute(worker, targetTabId);
    expect(blockCapture.ok).toBe(true);
    expect(blockCapture.error).toBeUndefined();
    const blockPng = inspectPng(blockCapture.dataUrl);
    expect(blockPng.width).toBeGreaterThan(100);
    expect(blockPng.height).toBeGreaterThan(100);
    expect(blockPng.width).toBeLessThan(grantedPng.width);
    expect(blockPng.height).toBeLessThan(grantedPng.height);

    await target.goto(`${serverA.origin}/two`);
    await target.bringToFront();
    const sameOriginCapture = await captureViaProductionRoute(worker, targetTabId);
    expect(sameOriginCapture.error).toBeUndefined();
    const sameOriginPng = inspectPng(sameOriginCapture.dataUrl);

    const otherTab = await context.newPage();
    await otherTab.setViewportSize({ width: 1100, height: 760 });
    await otherTab.goto(`${serverA.origin}/other-tab`);
    await otherTab.bringToFront();
    const otherTabId = await getActiveTabId(worker);
    expect(otherTabId).not.toBe(targetTabId);

    const otherTabCapture = await captureViaProductionRoute(worker, otherTabId);
    expect(otherTabCapture.dataUrl).toBeUndefined();
    expect(authorityDenied(otherTabCapture)).toBe(true);

    const otherBlockCapture = await captureBlockViaProductionRoute(worker, otherTabId);
    expect(otherBlockCapture.ok).toBe(false);
    expect(otherBlockCapture.dataUrl).toBeUndefined();
    expect(authorityDenied(otherBlockCapture)).toBe(true);

    await target.bringToFront();
    const returnedCapture = await captureViaProductionRoute(worker, targetTabId);
    expect(returnedCapture.error).toBeUndefined();
    const returnedPng = inspectPng(returnedCapture.dataUrl);

    await target.goto(`${serverB.origin}/cross-origin`);
    await target.bringToFront();
    const crossOriginCapture = await captureViaProductionRoute(worker, targetTabId);
    expect(crossOriginCapture.dataUrl).toBeUndefined();
    expect(authorityDenied(crossOriginCapture)).toBe(true);

    const submitCount = await target.evaluate(() => (window as Window & { __phase12bSubmitCount?: number }).__phase12bSubmitCount || 0);
    expect(submitCount).toBe(0);

    if (!grantedCapture.dataUrl || !blockCapture.dataUrl) {
      throw new Error("Phase 12B accepted image evidence disappeared after validation");
    }
    await writeDataUrlPng(path.join(evidenceDir, "active-tab-full-after-user-action.png"), grantedCapture.dataUrl);
    await writeDataUrlPng(path.join(evidenceDir, "active-tab-block-after-user-action.png"), blockCapture.dataUrl);

    const userAgent = await worker.evaluate(() => navigator.userAgent);
    await writeFile(
      path.join(evidenceDir, "active-tab-lifecycle.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        userAgent,
        shortcut,
        xWindow: xAction,
        targetTabId,
        otherTabId,
        initialWithoutGrant: { error: beforeGrant.error },
        afterRealUserAction: grantedPng,
        blockAfterRealUserAction: blockPng,
        sameOriginNavigation: { url: `${serverA.origin}/two`, capture: sameOriginPng },
        differentUninvokedTab: { url: `${serverA.origin}/other-tab`, error: otherTabCapture.error },
        sidePanelEquivalentBlockWithoutFreshGrant: { error: otherBlockCapture.error },
        returnToOriginallyInvokedTab: returnedPng,
        crossOriginNavigation: { url: `${serverB.origin}/cross-origin`, error: crossOriginCapture.error },
        automaticSubmissionObserved: false,
      }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await closeExtensionContext(context);
    await Promise.all([serverA.close(), serverB.close()]);
  }
});
