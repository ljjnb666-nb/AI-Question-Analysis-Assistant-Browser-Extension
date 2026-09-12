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

/** Shared host page: hosts iframes/shadow widgets and recycles on demand. */
const HOST_PAGE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Phase 7 roots e2e</title></head>
<body style="margin:0">
  <div id="mount"></div>
  <script>
    window.__clicks = [];
    window.__armButtons = (root, tag) => {
      root.querySelectorAll(".option").forEach((btn) => {
        if (btn.__armed) return;
        btn.__armed = true;
        btn.addEventListener("click", () => {
          const match = String(btn.textContent || "").trim().match(/^([ABCD])\\\\./);
          window.__clicks.push({ tag, label: match ? match[1] : "?", generation: btn.dataset.generation ?? "0" });
          const group = btn.closest("ul") || btn.parentElement;
          group.querySelectorAll(".option").forEach((other) => other.setAttribute("aria-checked", String(other === btn)));
        }, true);
      });
    };
    window.__renderIframeQuestion = (nativeId, media, generation) => {
      const html = '<section class="question-item" data-question-id="' + nativeId + '" style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">'
        + '<p class="stem">' + nativeId + '. Which value equals 2 + 2? Choose the correct option.</p>'
        + '<img src="http://img.test/' + media + '.png" alt="figure" style="width:80px;height:40px">'
        + '<ul style="list-style:none;margin:0;padding:0">'
        + ['A. 3', 'B. 4', 'C. 5', 'D. 6'].map((label) => '<li style="margin:6px 0"><button class="option" data-generation="' + generation + '" style="padding:8px;width:200px">' + label + '</button></li>').join('')
        + '</ul></section>';
      const mount = document.getElementById("mount");
      mount.innerHTML = '<iframe id="q-frame" style="width:660px;height:320px;border:0"></iframe>';
      const frame = document.getElementById("q-frame");
      frame.srcdoc = '<!doctype html><html><body style="margin:0">' + html + '</body></html>';
      frame.addEventListener("load", () => { window.__armButtons(frame.contentDocument, "iframe"); });
    };
    window.__renderShadowQuestion = (nativeId, media, generation) => {
      const mount = document.getElementById("mount");
      mount.innerHTML = "";
      const host = document.createElement("my-e2e-host");
      host.id = "q-host";
      mount.append(host);
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = '<section class="question-item" data-question-id="' + nativeId + '" style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">'
        + '<p class="stem">' + nativeId + '. Which value equals 2 + 2? Choose the correct option.</p>'
        + '<img src="http://img.test/' + media + '.png" alt="figure" style="width:80px;height:40px">'
        + '<ul style="list-style:none;margin:0;padding:0">'
        + ['A. 3', 'B. 4', 'C. 5', 'D. 6'].map((label) => '<li style="margin:6px 0"><button class="option" data-generation="' + generation + '" style="padding:8px;width:200px">' + label + '</button></li>').join('')
        + '</ul></section>';
      window.__armButtons(shadow, "shadow");
    };
    window.__recycle = (nativeId, media, generation) => {
      const mount = document.getElementById("mount");
      const host = document.getElementById("q-host");
      if (host) {
        const shadow = host.shadowRoot;
        shadow.innerHTML = '<section class="question-item" data-question-id="' + nativeId + '" style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">'
          + '<p class="stem">' + nativeId + '. Which value equals 3 + 3? Choose the correct option.</p>'
          + '<img src="http://img.test/' + media + '.png" alt="figure" style="width:80px;height:40px">'
          + '<ul style="list-style:none;margin:0;padding:0">'
          + ['A. 6', 'B. 7', 'C. 8', 'D. 9'].map((label) => '<li style="margin:6px 0"><button class="option" data-generation="' + generation + '" style="padding:8px;width:200px">' + label + '</button></li>').join('')
          + '</ul></section>';
        window.__armButtons(shadow, "shadow");
        return;
      }
      const frame = document.getElementById("q-frame");
      if (frame) {
        frame.srcdoc = '<!doctype html><html><body style="margin:0">'
          + '<section class="question-item" data-question-id="' + nativeId + '" style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">'
          + '<p class="stem">' + nativeId + '. Which value equals 3 + 3? Choose the correct option.</p>'
          + '<ul style="list-style:none;margin:0;padding:0">'
          + ['A. 6', 'B. 7', 'C. 8', 'D. 9'].map((label) => '<li style="margin:6px 0"><button class="option" data-generation="' + generation + '" style="padding:8px;width:200px">' + label + '</button></li>').join('')
          + '</ul></section></body></html>';
        frame.addEventListener("load", () => { window.__armButtons(frame.contentDocument, "iframe"); });
      }
    };
    window.__renderIframeQuestion("12", "diagram-a", "0");
    window.__armButtons(document, "top");
  </script>
</body>
</html>`;

const FRAME_PAGE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>frame</title></head>
<body style="margin:0">
  <section class="question-item" data-question-id="12"
           style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">
    <p class="stem">12. Which value equals 2 + 2? Choose the correct option.</p>
    <img src="http://img.test/diagram-a.png" alt="figure" style="width:80px;height:40px">
    <ul style="list-style:none;margin:0;padding:0">
      <li style="margin:6px 0"><button class="option" style="padding:8px;width:200px">A. 3</button></li>
      <li style="margin:6px 0"><button class="option" id="opt-b" style="padding:8px;width:200px">B. 4</button></li>
      <li style="margin:6px 0"><button class="option" style="padding:8px;width:200px">C. 5</button></li>
      <li style="margin:6px 0"><button class="option" style="padding:8px;width:200px">D. 6</button></li>
    </ul>
  </section>
  <script>
    window.__armButtons = (root) => {
      root.querySelectorAll(".option").forEach((btn) => {
        if (btn.__armed) return;
        btn.__armed = true;
        btn.addEventListener("click", () => {
          const match = String(btn.textContent || "").trim().match(/^([ABCD])\\\\./);
          parent.postMessage({ type: "frame-click", label: match ? match[1] : "?" }, "*");
          const group = btn.closest("ul");
          group.querySelectorAll(".option").forEach((other) => other.setAttribute("aria-checked", String(other === btn)));
        }, true);
      });
    };
    window.__armButtons(document);
    window.addEventListener("message", () => window.__armButtons(document));
  </script>
</body>
</html>`;

const SHADOW_PAGE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>shadow</title></head>
<body style="margin:0">
  <div id="mount"></div>
  <script>
    window.__clicks = [];
    window.__armButtons = (root) => {
      root.querySelectorAll(".option").forEach((btn) => {
        if (btn.__armed) return;
        btn.__armed = true;
        btn.addEventListener("click", () => {
          const match = String(btn.textContent || "").trim().match(/^([ABCD])\./);
          window.__clicks.push({ tag: "shadow", label: match ? match[1] : "?", generation: btn.dataset.generation ?? "0" });
          const group = btn.closest("ul") || btn.parentElement;
          group.querySelectorAll(".option").forEach((other) => other.setAttribute("aria-checked", String(other === btn)));
        }, true);
      });
    };
    const mount = document.getElementById("mount");
    const host = document.createElement("my-e2e-host");
    host.id = "q-host";
    mount.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<section class="question-item" data-question-id="12" style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">'
      + '<p class="stem">12. Which value equals 2 + 2? Choose the correct option.</p>'
      + '<img src="http://img.test/diagram-a.png" alt="figure" style="width:80px;height:40px">'
      + '<ul style="list-style:none;margin:0;padding:0">'
      + ['A. 3', 'B. 4', 'C. 5', 'D. 6'].map((label, index) => '<li style="margin:6px 0"><button class="option" id="' + (index === 1 ? 'opt-b' : 'opt-' + index) + '" style="padding:8px;width:200px">' + label + '</button></li>').join('')
      + '</ul></section>';
    window.__armButtons(shadow);
  </script>
</body>
</html>`;

type HeldProviderRequest = {
  respond: (answerLabel: string) => Promise<void>;
  reject: () => Promise<void>;
  settled: boolean;
};

async function startRootsServer(): Promise<{ origin: string; held: HeldProviderRequest[]; close: () => Promise<void> }> {
  const held: HeldProviderRequest[] = [];
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    console.log("[roots-server]", req.method, req.url);
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/host") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HOST_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/frame") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(FRAME_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/shadow") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SHADOW_PAGE_HTML);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        void chunks;
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
              recognizedText: "",
              optionSelections: { [answerLabel]: true },
              warning: null,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content: modelJson } }] }));
            resolveRelease();
          };
          reject = async () => {
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
  if (!address || typeof address === "string") throw new Error("no port");
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

async function startProductionAutoSolve(context: BrowserContext, extensionId: string, origin: string, _pagePath: string): Promise<Page> {
  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await driver.evaluate(() => {
    const w = window as DriverWindow & { __payloads: string[] };
    w.__events = [];
    w.__payloads = [];
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const typed = message as { type?: string; statusText?: string; message?: string; candidates?: unknown[] } | null;
      if (typed?.type) w.__events.push(typed.type);
      if (typed?.candidates) w.__payloads.push(`candidates:${typed.candidates.length}`);
      if (typed?.statusText || typed?.message) w.__payloads.push(typed.statusText || typed.message || "");
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
  if (tabId === null) throw new Error("root e2e tab not found");
  console.log("[roots-e2e] tabId", tabId);
  driver.on("console", (msg) => console.log(`[driver-console][${msg.type()}]`, msg.text().slice(0, 200)));

  await driver.evaluate((tab: number) => chrome.scripting.executeScript({ target: { tabId: tab }, files: ["content/content-main.js"] }), tabId);
  console.log("[roots-e2e] injected");
  const detectResponse = await driver.evaluate(async (tab: number) => chrome.tabs.sendMessage(tab, { type: "START_AUTO_DETECT" }), tabId);
  console.log("[roots-e2e] detect response", JSON.stringify(detectResponse));
  await driver.waitForFunction(() => (window as DriverWindow).__events?.includes("AUTO_DETECT_RESULT_READY"), undefined, { timeout: 20_000 });

  await driver.evaluate(async (tab: number) => chrome.tabs.sendMessage(tab, { type: "START_AUTO_SOLVE_ALL" }), tabId);
  return driver;
}

declare global {
  interface Window {
    __events: string[];
    __payloads: string[];
  }
}

async function dumpDiagnostics(driver: Page, label: string): Promise<void> {
  const events = await driver.evaluate(() => {
    const w = window as DriverWindow & { __payloads: string[] };
    return { events: w.__events, payloads: w.__payloads };
  });
  console.log(`[${label}]`, JSON.stringify(events));
}

async function waitForEvent(driver: Page, eventType: string, timeout = 45_000): Promise<void> {
  await driver.waitForFunction(
    (type) => (window as DriverWindow).__events?.includes(type as string),
    eventType,
    { timeout },
  );
}

test.describe("Phase 7 accessible roots E2E", () => {
  test("FRAME-A: an iframe document replaced while pending never receives the stale answer", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      spaPage.on("console", (msg) => console.log(`[spa-console][${msg.type()}]`, msg.text().slice(0, 220)));
      await spaPage.goto(`${server.origin}/host`);
      // Point the host page at a server-served same-origin frame document.
      await spaPage.evaluate((baseOrigin: string) => {
        const mount = document.getElementById("mount")!;
        mount.innerHTML = '<iframe id="q-frame" style="width:660px;height:340px;border:0"></iframe>';
        const frame = document.getElementById("q-frame") as HTMLIFrameElement;
        frame.src = `${baseOrigin}/frame`;
      }, server.origin);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/host");

      await expect.poll(() => server.held.length, { timeout: 30_000 }).toBe(1).catch(async (err) => { await dumpDiagnostics(driver, "held-poll"); throw err; });

      // Replace the iframe's whole document while the provider is pending.
      await spaPage.evaluate(() => {
        const frame = document.getElementById("q-frame") as HTMLIFrameElement;
        frame.srcdoc = '<!doctype html><html><body style="margin:0"><p>reloaded empty frame</p></body></html>';
      });
      await spaPage.waitForTimeout(700);

      await server.held[0].respond("B");
      server.held[0].settled = true;
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

      // The reloaded frame document contains no question controls at all and
      // the stale answer never appeared anywhere.
      const clicks = await spaPage.evaluate(() => (window as unknown as { __clicks: unknown[] }).__clicks);
      expect(clicks).toEqual([]);
      const frameText = await spaPage.evaluate(() => {
        const frame = document.getElementById("q-frame") as HTMLIFrameElement;
        return frame.contentDocument?.body?.textContent ?? "";
      });
      expect(frameText).not.toContain("aria");
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("SHADOW-A: a question inside an open shadow root is detected, solved and verified", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      spaPage.on("console", (msg) => console.log(`[spa-console][${msg.type()}]`, msg.text().slice(0, 220)));
      await spaPage.goto(`${server.origin}/shadow`);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/shadow");

      await expect.poll(() => server.held.length, { timeout: 30_000 }).toBe(1).catch(async (err) => { await dumpDiagnostics(driver, "held-poll"); throw err; });
      await server.held[0].respond("B");
      server.held[0].settled = true;
      await waitForEvent(driver, "AUTO_SOLVE_DONE").catch(async (err) => { await dumpDiagnostics(driver, "done-wait"); throw err; });

      const clicks = await spaPage.evaluate(() => (window as unknown as { __clicks: unknown[] }).__clicks);
      expect(clicks).toEqual([{ tag: "shadow", label: "B", generation: "0" }]);
      const checked = await spaPage.evaluate(() => {
        const host = document.getElementById("q-host")!;
        return host.shadowRoot!.querySelector("#opt-b")!.getAttribute("aria-checked");
      });
      expect(checked).toBe("true");
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("VIRT-A: a recycled shadow container never receives the previous question's answer", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      spaPage.on("console", (msg) => console.log(`[spa-console][${msg.type()}]`, msg.text().slice(0, 220)));
      await spaPage.goto(`${server.origin}/shadow`);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/shadow");

      await expect.poll(() => server.held.length, { timeout: 30_000 }).toBe(1).catch(async (err) => { await dumpDiagnostics(driver, "held-poll"); throw err; });

      // Recycle the same component to a different question while pending.
      await spaPage.evaluate(() => {
        const host = document.getElementById("q-host")!;
        const shadow = host.shadowRoot!;
        shadow.innerHTML = '<section class="question-item" data-question-id="13" style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">'
          + '<p class="stem">13. Which value equals 3 + 3? Choose the correct option.</p>'
          + '<ul style="list-style:none;margin:0;padding:0">'
          + ['A. 6', 'B. 7', 'C. 8', 'D. 9'].map((label) => '<li style="margin:6px 0"><button class="option" style="padding:8px;width:200px">' + label + '</button></li>').join('')
          + '</ul></section>';
      });
      await spaPage.waitForTimeout(700);

      await server.held[0].respond("B");
      server.held[0].settled = true;
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

      const clicks = await spaPage.evaluate(() => (window as unknown as { __clicks: unknown[] }).__clicks);
      expect(clicks).toEqual([]);
      const checked = await spaPage.evaluate(() => {
        const host = document.getElementById("q-host")!;
        return host.shadowRoot!.querySelectorAll('[aria-checked="true"]').length;
      });
      expect(checked).toBe(0);
    } finally {
      await context.close();
      await server.close();
    }
  });
});
