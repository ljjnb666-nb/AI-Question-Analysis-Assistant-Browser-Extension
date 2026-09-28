import http from "node:http";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";

declare const chrome: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } };

type ProbeTab = { id: number; url?: string; title?: string; windowId?: number; active?: boolean };
type PermissionProbeWindow = Window & typeof globalThis & {
  chrome: {
    tabs: {
      query: (query: { currentWindow?: boolean }) => Promise<ProbeTab[]>;
      get: (tabId: number) => Promise<ProbeTab>;
      update: (tabId: number, properties: { active?: boolean }) => Promise<ProbeTab>;
      sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
    };
    scripting: {
      executeScript: (options: { target: { tabId: number }; files?: string[]; func?: () => Promise<unknown> }) => Promise<Array<{ result?: unknown }>>;
    };
    action: { openPopup: () => Promise<void> };
  };
};

async function startHttpPage(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>Permission probe</title></head>
      <body><main style="width:360px;height:220px;background:#dff4ff;color:#102030;padding:24px">
      Arbitrary local learning page</main></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Permission probe server did not report a port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function openExtensionProbe(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return page;
}

test("P_REL_PERM_03_TABS_PERMISSION_REMOVAL proves matching-tab query, get, and messaging without tabs permission", async () => {
  const server = await startHttpPage();
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const originPage = await context.newPage();
    await originPage.goto(server.origin);
    const driver = await openExtensionProbe(context, extensionId);

    const report = await driver.evaluate(async (origin: string) => {
      const api = (window as PermissionProbeWindow).chrome;
      const tabs = await api.tabs.query({ currentWindow: true });
      const candidate = tabs.find((tab) => tab.url === `${origin}/`);
      if (!candidate) throw new Error("current-window query did not expose the matching HTTP tab");
      await api.tabs.update(candidate.id, { active: true });
      const activeTabs = await api.tabs.query({ currentWindow: true });
      const active = activeTabs.find((tab) => tab.id === candidate.id);
      const fetched = await api.tabs.get(candidate.id);
      await api.scripting.executeScript({ target: { tabId: candidate.id }, files: ["content/content-main.js"] });
      const response = await api.tabs.sendMessage(candidate.id, {
        type: "CAPTURE_BLOCK_IMAGE",
        bbox: { x: 0, y: 0, width: 280, height: 180 },
      }) as { ok?: boolean; dataUrl?: string; error?: string };
      return {
        id: candidate.id,
        url: candidate.url,
        windowId: candidate.windowId,
        active: active?.active,
        fetchedUrl: fetched.url,
        fetchedWindowId: fetched.windowId,
        messageResponseReceived: typeof response?.ok === "boolean",
      };
    }, server.origin);

    expect(report.id).toEqual(expect.any(Number));
    expect(report.url).toBe(`${server.origin}/`);
    expect(report.windowId).toEqual(expect.any(Number));
    expect(report.active).toBe(true);
    expect(report.fetchedUrl).toBe(`${server.origin}/`);
    expect(report.fetchedWindowId).toBe(report.windowId);
    expect(report.messageResponseReceived).toBe(true);
  } finally {
    await closeExtensionContext(context);
    await server.close();
  }
});

test("P_REL_PERM_04_SCREENSHOT_AUTHORITY returns real PNG data or an explicit Chrome authority error", async () => {
  const server = await startHttpPage();
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const originPage = await context.newPage();
    await originPage.goto(server.origin);
    const driver = await openExtensionProbe(context, extensionId);
    await driver.evaluate(async (origin: string) => {
      const api = (window as PermissionProbeWindow).chrome;
      const target = (await api.tabs.query({ currentWindow: true })).find((tab) => tab.url === `${origin}/`);
      if (!target) throw new Error("the action target tab was not found");
      await api.tabs.update(target.id, { active: true });
    }, server.origin);
    await driver.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Invoke extension action";
      button.addEventListener("click", () => void (window as PermissionProbeWindow).chrome.action.openPopup());
      document.body.append(button);
    });
    await driver.getByRole("button", { name: "Invoke extension action" }).click();

    const screenshot = await driver.evaluate(async (origin: string) => {
      const api = (window as PermissionProbeWindow).chrome;
      const tabs = await api.tabs.query({ currentWindow: true });
      const target = tabs.find((tab) => tab.url === `${origin}/`);
      if (!target) throw new Error("the screenshot target tab was not found");
      await api.tabs.update(target.id, { active: true });
      const [{ result }] = await api.scripting.executeScript({
        target: { tabId: target.id },
        func: async () => await chrome.runtime.sendMessage({ type: "CAPTURE_TAB_SCREENSHOT" }),
      });
      const response = result as { dataUrl?: string; error?: string } | undefined;
      return { targetUrl: target.url, dataUrl: response?.dataUrl, error: response?.error };
    }, server.origin);

    expect(screenshot.targetUrl).toBe(`${server.origin}/`);
    if (screenshot.dataUrl) {
      expect(screenshot.error).toBeUndefined();
      expect(screenshot.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(screenshot.dataUrl.length).toBeGreaterThan(500);
    } else {
      expect(screenshot.error).toMatch(/Either the '<all_urls>' or 'activeTab' permission is required/);
    }

    const tabId = await driver.evaluate(async (origin: string) => {
      const api = (window as PermissionProbeWindow).chrome;
      const target = (await api.tabs.query({ currentWindow: true })).find((tab) => tab.url === `${origin}/`);
      if (!target) throw new Error("the block-capture target tab was not found");
      await api.scripting.executeScript({ target: { tabId: target.id }, files: ["content/content-main.js"] });
      return target.id;
    }, server.origin);
    const blockCapture = await driver.evaluate(async (id: number) => {
      const api = (window as PermissionProbeWindow).chrome;
      return await api.tabs.sendMessage(id, { type: "CAPTURE_BLOCK_IMAGE", bbox: { x: 0, y: 0, width: 280, height: 180 } }) as { ok?: boolean; dataUrl?: string; error?: string };
    }, tabId);
    if (screenshot.dataUrl) {
      expect(blockCapture.ok).toBe(true);
      expect(blockCapture.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(blockCapture.dataUrl!.length).toBeGreaterThan(250);
    } else {
      expect(blockCapture.ok).toBe(false);
      expect(blockCapture.error).toMatch(/Either the '<all_urls>' or 'activeTab' permission is required/);
      expect(blockCapture.dataUrl).toBeUndefined();
    }
  } finally {
    await closeExtensionContext(context);
    await server.close();
  }
});
