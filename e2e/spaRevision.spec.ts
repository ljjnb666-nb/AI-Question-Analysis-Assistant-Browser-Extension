import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import { chromium, expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..", "dist");
const playwrightCacheDir = path.join(os.homedir(), ".cache", "ms-playwright");

type SpaPageWindow = Window & typeof globalThis & {
  __clicks: Array<{ generation: number; label: string }>;
  __armButtons: (root: Element, generation: number) => void;
  __optionClick: (generation: number) => (event: Event) => void;
};

type DriverWindow = Window & typeof globalThis & { __events: string[] };

declare const chrome: {
  tabs: {
    query: (info: { url: string }) => Promise<Array<{ id: number } | undefined>>;
    sendMessage: (tabId: number, message: { type: string }) => Promise<unknown>;
  };
  scripting: { executeScript: (injection: { target: { tabId: number }; files: string[] }) => Promise<unknown> };
  runtime: { onMessage: { addListener: (listener: (message: unknown) => void) => void } };
  storage: { local: { set: (items: Record<string, unknown>) => Promise<void> } };
};

const SPA_PAGE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>SPA revision e2e</title></head>
<body style="margin:0">
  <section class="question-item" id="q12" data-question-id="12"
           style="width:640px;min-height:240px;padding:16px;background:#fff;color:#000;font-size:18px">
    <p class="stem" id="stem">12. Which value is equal to 2 + 2? Choose the correct option.</p>
    <ul style="list-style:none;margin:0;padding:0">
      <li style="margin:6px 0"><button class="option" id="opt-a" style="display:block;padding:8px;width:200px">A. 3</button></li>
      <li style="margin:6px 0"><button class="option" id="opt-b" style="display:block;padding:8px;width:200px">B. 4</button></li>
      <li style="margin:6px 0"><button class="option" id="opt-c" style="display:block;padding:8px;width:200px">C. 5</button></li>
      <li style="margin:6px 0"><button class="option" id="opt-d" style="display:block;padding:8px;width:200px">D. 6</button></li>
    </ul>
  </section>
  <script>
    window.__clicks = [];
    window.__optionClick = (generation) => (event) => {
      const btn = event.currentTarget;
      const match = String(btn.textContent || "").trim().match(/^([ABCD])\\./);
      window.__clicks.push({ generation, label: match ? match[1] : "?" });
      const group = btn.closest("ul") || btn.parentElement;
      group.querySelectorAll(".option").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    };
    window.__armButtons = (root, generation) => {
      root.querySelectorAll(".option").forEach((btn) => {
        btn.addEventListener("click", window.__optionClick(generation), true);
      });
    };
    window.__armButtons(document, 0);
  </script>
</body>
</html>`;

type HeldProviderRequest = {
  respond: (answerLabel: string) => Promise<void>;
  reject: () => Promise<void>;
  settled: boolean;
};

/**
 * A real local origin that serves the synthetic SPA page and holds each
 * provider chat-completions request until the test releases it with a canned
 * answer, so the extension's production provider call stays pending while the
 * SPA mutates the question.
 */
async function startSpaServer(): Promise<{ origin: string; held: HeldProviderRequest[]; close: () => Promise<void> }> {
  const held: HeldProviderRequest[] = [];
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/q") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SPA_PAGE_HTML);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let respond: (answerLabel: string) => Promise<void> = async () => {};
        let reject: () => Promise<void> = async () => {};
        const settledPromise = new Promise<void>((resolveRelease) => {
          respond = async (answerLabel: string) => {
            const modelJson = JSON.stringify({
              questionType: "single_choice",
              answer: answerLabel,
              confidence: 0.99,
              briefExplanation: "mocked",
              detailedExplanation: "mocked explanation",
              recognizedText: "12. Which value is equal to 2 + 2? Choose the correct option. A. 3 B. 4 C. 5 D. 6",
              optionSelections: { [answerLabel]: true },
              warning: null,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content: modelJson } }] }));
            resolveRelease();
          };
          reject = async () => {
            // Deliberately unstable parse output: the orchestration gives up on
            // the mutated revision quickly instead of retrying network errors.
            const modelJson = JSON.stringify({
              questionType: "single_choice",
              answer: "需人工确认",
              confidence: 0.2,
              briefExplanation: "",
              detailedExplanation: "",
              recognizedText: "",
              warning: null,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content: modelJson } }] }));
            resolveRelease();
          };
        });
        held.push({ respond, reject, settled: false });
        await settledPromise;
      })();
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SPA server did not report a port");
  return { origin: `http://127.0.0.1:${address.port}`, held, close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))) };
}

function resolveChromiumExecutable(): string {
  const chromiumDirs = fs
    .readdirSync(playwrightCacheDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.split("-")[1]) - Number(left.split("-")[1]));

  for (const dirName of chromiumDirs) {
    const candidate = path.join(playwrightCacheDir, dirName, "chrome-win64", "chrome.exe");
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`No Playwright Chromium executable found under ${playwrightCacheDir}`);
}

async function launchExtensionContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext("", {
    executablePath: resolveChromiumExecutable(),
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
}

async function resolveExtensionId(context: BrowserContext) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  return new URL(serviceWorker.url()).host;
}

/** Boots the real extension content runtime in the SPA tab and starts the production SPA watch. */
async function startProductionAutoSolve(context: BrowserContext, extensionId: string, origin: string): Promise<Page> {
  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await driver.evaluate(() => {
    (window as DriverWindow).__events = [];
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const type = (message as { type?: string } | null)?.type;
      if (type) (window as DriverWindow).__events.push(type);
    });
  });

  await driver.evaluate((baseOrigin: string) => chrome.storage.local.set({
    appSettings: {
      providerId: "custom",
      apiKey: "e2e-key",
      apiModel: "qwen3-vl",
      preferredRoute: "text",
      language: "en",
      enableAnalytics: false,
      customBaseUrl: `${baseOrigin}/api`,
    },
  }), origin);

  const tabId = await driver.evaluate(async (baseOrigin: string) => {
    const [tab] = await chrome.tabs.query({ url: `${baseOrigin}/*` });
    return tab?.id ?? null;
  }, origin);
  if (tabId === null) throw new Error("SPA tab not found for content script injection");

  // Same injection path the background uses for on-demand bootstrap.
  await driver.evaluate((tab: number) => chrome.scripting.executeScript({ target: { tabId: tab }, files: ["content/content-main.js"] }), tabId);
  await driver.evaluate(async (tab: number) => chrome.tabs.sendMessage(tab, { type: "START_AUTO_DETECT" }), tabId);
  await driver.waitForFunction(() => (window as DriverWindow).__events?.includes("AUTO_DETECT_RESULT_READY"), undefined, { timeout: 15_000 });

  await driver.evaluate(async (tab: number) => chrome.tabs.sendMessage(tab, { type: "START_AUTO_SOLVE_ALL" }), tabId);
  return driver;
}

async function waitForEvent(driver: Page, eventType: string, timeout = 30_000): Promise<void> {
  await driver.waitForFunction(
    (type) => (window as DriverWindow).__events?.includes(type as string),
    eventType,
    { timeout },
  );
}

test.describe("Phase 6 synthetic SPA revision scenarios", () => {
  test("Scenario A: a late stale provider result after a semantic replace mutates nothing", async () => {
    test.setTimeout(60_000);
    const server = await startSpaServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      await spaPage.goto(`${server.origin}/q`);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin);

      await expect.poll(() => server.held.length, { timeout: 20_000 }).toBe(1);

      // The SPA replaces the question's semantic content while the provider is pending.
      await spaPage.evaluate(() => {
        document.getElementById("stem")!.textContent = "12. Which value is equal to 3 + 3? Choose the correct option.";
        document.getElementById("opt-a")!.textContent = "A. 6";
        document.getElementById("opt-b")!.textContent = "B. 7";
        document.getElementById("opt-c")!.textContent = "C. 8";
        document.getElementById("opt-d")!.textContent = "D. 9";
      });
      await spaPage.waitForTimeout(600);

      await server.held[0].respond("B");
      server.held[0].settled = true;
      // Later provider calls for the mutated revision are refused so the run
      // finishes deterministically without the stale answer ever filling.
      const drain = setInterval(() => {
        for (const request of server.held) {
          if (!request.settled) {
            request.settled = true;
            void request.reject();
          }
        }
      }, 400);
      try {
        await waitForEvent(driver, "AUTO_SOLVE_DONE");
      } finally {
        clearInterval(drain);
      }

      const clicks = await spaPage.evaluate(() => (window as SpaPageWindow).__clicks);
      expect(clicks).toEqual([]);
      expect(await spaPage.textContent("#stem")).toBe("12. Which value is equal to 3 + 3? Choose the correct option.");
      expect(await spaPage.textContent("#opt-a")).toBe("A. 6");
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("Scenario B: a semantic-equivalent owner replacement fails closed, then fresh detection remains available", async () => {
    test.setTimeout(60_000);
    const server = await startSpaServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      await spaPage.goto(`${server.origin}/q`);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin);

      await expect.poll(() => server.held.length, { timeout: 20_000 }).toBe(1);

      // React-style rerender: the container element is replaced but the
      // question's semantic content is identical.
      await spaPage.evaluate(() => {
        const section = document.getElementById("q12")!;
        const rerendered = section.cloneNode(true) as HTMLElement;
        (window as SpaPageWindow).__armButtons(rerendered, 1);
        section.replaceWith(rerendered);
      });
      await spaPage.waitForTimeout(600);

      await server.held[0].respond("B");
      server.held[0].settled = true;
      await waitForEvent(driver, "AUTO_SOLVE_DONE");

      const clicks = await spaPage.evaluate(() => (window as SpaPageWindow).__clicks);
      // Phase 7 binds an automatic candidate to its exact runtime owner. A
      // replacement owner is stale even when its semantic fingerprint matches.
      expect(clicks).toEqual([]);

      // The extension remains operational: a fresh detect round-trips.
      await driver.evaluate(async (baseOrigin: string) => {
        const [tab] = await chrome.tabs.query({ url: `${baseOrigin}/*` });
        await chrome.tabs.sendMessage(tab!.id, { type: "START_AUTO_DETECT" });
      }, server.origin);
      await driver.waitForFunction(
        () => (window as DriverWindow).__events.filter((type) => type === "AUTO_DETECT_RESULT_READY").length >= 2,
        undefined,
        { timeout: 15_000 },
      );
    } finally {
      await context.close();
      await server.close();
    }
  });
});
