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

type DriverWindow = Window & typeof globalThis & { __events: string[]; __candidateBlocks: unknown[] };

declare const chrome: {
  tabs: {
    query: (info: { url: string }) => Promise<Array<{ id: number } | undefined>>;
    sendMessage: (tabId: number, message: { type: string; [key: string]: unknown }) => Promise<unknown>;
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

const NATIVE_FRAME_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>native frame</title></head>
<body style="margin:0">
  <section class="question-item" data-question-id="21" style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">
    <p class="stem">21. Which value equals 2 + 2? Choose the correct option.</p>
    <label><input type="radio" name="frame-answer" value="A"> A. 3</label>
    <label><input type="radio" name="frame-answer" value="B"> B. 4</label>
    <label><input type="radio" name="frame-answer" value="C"> C. 5</label>
    <label><input type="radio" name="frame-answer" value="D"> D. 6</label>
  </section>
  <script>
    document.querySelectorAll('input[type="radio"]').forEach((input) => input.addEventListener("change", () => {
      if (input.checked) parent.postMessage({ type: "native-frame-choice", value: input.value }, location.origin);
    }));
  </script>
</body></html>`;

const NATIVE_HOST_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>native iframe host</title></head>
<body style="margin:0">
  <div style="height:24px">Top document decoy controls</div>
  <label><input type="radio" name="top-answer" value="A"> A. 3</label>
  <label><input type="radio" name="top-answer" value="B"> B. 4</label>
  <label><input type="radio" name="top-answer" value="C"> C. 5</label>
  <label><input type="radio" name="top-answer" value="D"> D. 6</label>
  <iframe id="native-frame" src="/native-frame" style="width:660px;height:260px;border:0"></iframe>
  <script>window.__frameChoices = []; window.addEventListener("message", (event) => { if (event.data?.type === "native-frame-choice") window.__frameChoices.push(event.data.value); });</script>
</body></html>`;

const NATIVE_SHADOW_FRAME_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>native shadow frame</title></head>
<body style="margin:0"><native-question-host id="native-host"></native-question-host>
  <script>
    const host = document.getElementById("native-host");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<section class="question-item" data-question-id="22" style="width:600px;min-height:220px;padding:12px;background:#fff;color:#000;font-size:18px">'
      + '<p class="stem">22. Which value equals 2 + 2? Choose the correct option.</p>'
      + '<label><input type="radio" name="shadow-frame-answer" value="A"> A. 3</label>'
      + '<label><input type="radio" name="shadow-frame-answer" value="B"> B. 4</label>'
      + '<label><input type="radio" name="shadow-frame-answer" value="C"> C. 5</label>'
      + '<label><input type="radio" name="shadow-frame-answer" value="D"> D. 6</label></section>';
    shadow.querySelectorAll('input[type="radio"]').forEach((input) => input.addEventListener("change", () => {
      if (input.checked) parent.postMessage({ type: "nested-native-choice", value: input.value }, location.origin);
    }));
  </script>
</body></html>`;

const NATIVE_SHADOW_HOST_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>native shadow host</title></head>
<body style="margin:0">
  <label><input type="radio" name="top-answer" value="B"> Top document decoy B. 4</label>
  <iframe id="native-frame" src="/native-shadow-frame" style="width:660px;height:260px;border:0"></iframe>
  <script>window.__nestedChoices = []; window.addEventListener("message", (event) => { if (event.data?.type === "nested-native-choice") window.__nestedChoices.push(event.data.value); });</script>
</body></html>`;

const SCROLLED_FRAME_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>scrolled frame host</title></head>
<body style="margin:0">
  <div style="height:1100px">scroll spacer</div>
  <iframe id="q-frame" src="/frame" style="width:660px;height:320px;border:0"></iframe>
  <div style="height:900px"></div>
  <script>window.scrollTo(0, 850);</script>
</body></html>`;

const RERENDER_HOST_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>rerender host</title></head>
<body style="margin:0"><iframe id="rerender-frame" src="/rerender-frame" style="width:760px;height:380px;border:0"></iframe></body></html>`;
const RERENDER_STOP_HOST_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>rerender stop host</title></head>
<body style="margin:0"><iframe id="rerender-frame" src="/rerender-frame?change-question=1" style="width:760px;height:380px;border:0"></iframe>
  <button id="next-question">Next question</button><script>window.__advanceClicks = 0; document.getElementById("next-question").addEventListener("click", () => window.__advanceClicks++);</script>
</body></html>`;

const RERENDER_FRAME_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>rerender-safe transaction</title></head>
<body style="margin:0">
  <section class="question-item" data-question-id="21" style="width:700px;min-height:260px;padding:16px;background:#fff;color:#000;font-size:18px">
    <p class="stem">21. Select all that apply: Which values are correct?</p>
    <ul id="options" style="list-style:none;margin:0;padding:0"></ul>
  </section>
  <script>
    window.__mutationEvents = [];
    window.__detachedMutations = [];
    const selected = new Set();
    let generation = -1;
    const options = document.getElementById("options");
    const stem = document.querySelector(".stem");
    const changeQuestionAfterFirst = new URLSearchParams(location.search).has("change-question");
    const render = () => {
      generation += 1;
      options.replaceChildren(...["A", "B", "C", "D"].map((key) => {
        const item = document.createElement("li");
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = key;
        input.checked = selected.has(key);
        input.dataset.generation = String(generation);
        input.addEventListener("click", () => {
          if (!input.isConnected) window.__detachedMutations.push({ key, generation: Number(input.dataset.generation) });
        });
        input.addEventListener("change", () => {
          if (input.checked) selected.add(key);
          else selected.delete(key);
          window.__mutationEvents.push({ key, generation: Number(input.dataset.generation) });
          if (changeQuestionAfterFirst && key === "A") {
            stem.textContent = "22. A different question has replaced the original question.";
            selected.clear();
            render();
            return;
          }
          render();
        });
        label.append(input, document.createTextNode(" " + key + ". " + ({ A: "Alpha", B: "Beta", C: "Gamma", D: "Delta" })[key]));
        item.append(label);
        return item;
      }));
    };
    render();
  </script>
</body></html>`;

type HeldProviderRequest = {
  respond: (answerLabel: string, questionType?: "single_choice" | "multi_choice") => Promise<void>;
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
    if (req.method === "GET" && url.pathname === "/native-host") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(NATIVE_HOST_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/scrolled-frame") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SCROLLED_FRAME_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/rerender") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(RERENDER_HOST_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/rerender-stop") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(RERENDER_STOP_HOST_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/rerender-frame") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(RERENDER_FRAME_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/native-frame") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(NATIVE_FRAME_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/native-shadow-host") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(NATIVE_SHADOW_HOST_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/native-shadow-frame") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(NATIVE_SHADOW_FRAME_PAGE_HTML);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        void chunks;
        let respond: (answerLabel: string, questionType?: "single_choice" | "multi_choice") => Promise<void> = async () => {};
        let reject: () => Promise<void> = async () => {};
        const settledPromise = new Promise<void>((resolveRelease) => {
          respond = async (answerLabel: string, questionType: "single_choice" | "multi_choice" = "single_choice") => {
            const answerKeys = answerLabel.split(",").map((key) => key.trim()).filter(Boolean);
            const modelJson = JSON.stringify({
              questionType,
              answer: answerLabel,
              confidence: 0.99,
              briefExplanation: "mocked",
              detailedExplanation: "mocked explanation",
              recognizedText: "",
              optionSelections: Object.fromEntries(answerKeys.map((key) => [key, true])),
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

async function startProductionAutoSolve(context: BrowserContext, extensionId: string, origin: string, _pagePath: string, startSolve = true): Promise<Page> {
  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await driver.evaluate(() => {
    const w = window as DriverWindow & { __payloads: string[] };
    w.__events = [];
    w.__payloads = [];
    w.__candidateBlocks = [];
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const typed = message as { type?: string; statusText?: string; message?: string; candidates?: unknown[] } | null;
      if (typed?.type) w.__events.push(typed.type);
      if (typed?.candidates) {
        w.__payloads.push(`candidates:${typed.candidates.length}`);
        if (typed.type === "AUTO_DETECT_RESULT_READY") {
          w.__candidateBlocks = typed.candidates.map((candidate) => (candidate as { block?: unknown } | null)?.block).filter(Boolean);
        }
      }
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

  if (startSolve) {
    await driver.evaluate(async (tab: number) => chrome.tabs.sendMessage(tab, { type: "START_AUTO_SOLVE_ALL" }), tabId);
  }
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
    const candidates = (w.__candidateBlocks as Array<{ id?: string; previewText?: string; questionTypeGuess?: string; completeness?: { state?: string; reasons?: string[] }; runtimeQuestionHandle?: string }>).map((block) => ({
      id: block.id,
      previewText: block.previewText,
      questionTypeGuess: block.questionTypeGuess,
      completeness: block.completeness,
      hasRuntimeHandle: Boolean(block.runtimeQuestionHandle),
    }));
    return { events: w.__events, payloads: w.__payloads, candidates };
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
  test("E2E-RERENDER-1: multi-choice fill reacquires controls after a synchronous framework rerender", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const quizPage = await context.newPage();
      await quizPage.goto(`${server.origin}/rerender`);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/rerender");

      await expect.poll(() => server.held.length, { timeout: 30_000 }).toBe(1).catch(async (err) => { await dumpDiagnostics(driver, "rerender-held-provider"); throw err; });
      await server.held[0].respond("A,B", "multi_choice");
      server.held[0].settled = true;
      await waitForEvent(driver, "AUTO_SOLVE_DONE").catch(async (err) => { await dumpDiagnostics(driver, "rerender-done"); throw err; });

      const state = await quizPage.evaluate(() => {
        const frame = document.getElementById("rerender-frame") as HTMLIFrameElement;
        const frameDocument = frame.contentDocument!;
        const current = Array.from(frameDocument.querySelectorAll<HTMLInputElement>('#options input[type="checkbox"]'))
          .filter((input) => input.checked)
          .map((input) => input.value)
          .sort();
        const debug = frame.contentWindow as unknown as {
          __mutationEvents: Array<{ key: string; generation: number }>;
          __detachedMutations: Array<{ key: string; generation: number }>;
        };
        return { current, mutations: debug.__mutationEvents, detached: debug.__detachedMutations };
      });

      expect(state.current).toEqual(["A", "B"]);
      expect(state.mutations).toEqual([{ key: "A", generation: 0 }, { key: "B", generation: 1 }]);
      expect(state.detached).toEqual([]);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("E2E-RERENDER-2: semantic replacement stops before the next mutation or question advance", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const quizPage = await context.newPage();
      await quizPage.goto(`${server.origin}/rerender-stop`);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/rerender-stop");

      await expect.poll(() => server.held.length, { timeout: 30_000 }).toBe(1).catch(async (err) => { await dumpDiagnostics(driver, "rerender-stop-held-provider"); throw err; });
      await server.held[0].respond("A,B", "multi_choice");
      server.held[0].settled = true;
      await waitForEvent(driver, "AUTO_SOLVE_DONE").catch(async (err) => { await dumpDiagnostics(driver, "rerender-stop-done"); throw err; });

      const state = await quizPage.evaluate(() => {
        const frame = document.getElementById("rerender-frame") as HTMLIFrameElement;
        const frameDocument = frame.contentDocument!;
        const debug = frame.contentWindow as unknown as {
          __mutationEvents: Array<{ key: string; generation: number }>;
          __detachedMutations: Array<{ key: string; generation: number }>;
        };
        return {
          mutations: debug.__mutationEvents,
          detached: debug.__detachedMutations,
          selected: Array.from(frameDocument.querySelectorAll<HTMLInputElement>('#options input[type="checkbox"]'))
            .filter((input) => input.checked)
            .map((input) => input.value),
          advanceClicks: (window as unknown as { __advanceClicks: number }).__advanceClicks,
        };
      });
      const messages = await driver.evaluate(() => (window as DriverWindow & { __payloads: string[] }).__payloads);

      expect(state.mutations).toEqual([{ key: "A", generation: 0 }]);
      expect(state.detached).toEqual([]);
      expect(state.selected).toEqual([]);
      expect(state.advanceClicks).toBe(0);
      expect(messages.some((message) => message.includes("PARTIAL_MUTATION_UNPROVABLE"))).toBe(true);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("E2E-FRAME-NATIVE: auto solve selects only a native radio in the same-origin frame", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      await spaPage.goto(`${server.origin}/native-host`);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/native-host");
      await expect.poll(() => server.held.length, { timeout: 30_000 }).toBe(1).catch(async (err) => { await dumpDiagnostics(driver, "native-frame-provider"); throw err; });
      await server.held[0].respond("B");
      server.held[0].settled = true;
      await waitForEvent(driver, "AUTO_SOLVE_DONE");

      const state = await spaPage.evaluate(() => {
        const frame = document.getElementById("native-frame") as HTMLIFrameElement;
        return {
          frameSelected: frame.contentDocument?.querySelector<HTMLInputElement>('input[value="B"]')?.checked,
          frameChoices: (window as unknown as { __frameChoices: string[] }).__frameChoices,
          topSelected: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="top-answer"]')).some((input) => input.checked),
        };
      });
      expect(state.frameSelected).toBe(true);
      expect(state.frameChoices).toContain("B");
      expect(state.topSelected).toBe(false);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("E2E-FRAME-SHADOW-NATIVE-1: auto solve selects only a native radio inside an open shadow root in a frame", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      await spaPage.goto(`${server.origin}/native-shadow-host`);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/native-shadow-host");
      await expect.poll(() => server.held.length, { timeout: 30_000 }).toBe(1).catch(async (err) => { await dumpDiagnostics(driver, "native-shadow-provider"); throw err; });
      await server.held[0].respond("B");
      server.held[0].settled = true;
      await waitForEvent(driver, "AUTO_SOLVE_DONE");

      const state = await spaPage.evaluate(() => {
        const frame = document.getElementById("native-frame") as HTMLIFrameElement;
        const shadow = frame.contentDocument?.querySelector("native-question-host")?.shadowRoot;
        return {
          shadowSelected: shadow?.querySelector<HTMLInputElement>('input[value="B"]')?.checked,
          topSelected: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="top-answer"]')).some((input) => input.checked),
        };
      });
      expect(state.shadowSelected).toBe(true);
      expect(state.topSelected).toBe(false);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("E2E-MESSAGE-ROUNDTRIP: panel candidate survives extension messaging and fills its exact frame", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      await spaPage.goto(`${server.origin}/host`);
      await spaPage.evaluate(() => {
        const topQuestion = document.createElement("section");
        topQuestion.className = "question-item";
        topQuestion.dataset.questionId = "12";
        topQuestion.style.marginTop = "100px";
        topQuestion.innerHTML = '<p class="stem">12. Which value equals 2 + 2? Choose the correct option.</p><img src="http://img.test/diagram-a.png" alt="figure">'
          + '<ul><li><button class="option">A. 3</button></li><li><button class="option">B. 4</button></li><li><button class="option">C. 5</button></li><li><button class="option">D. 6</button></li></ul>';
        document.body.append(topQuestion);
      });
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/host", false);
      await driver.waitForFunction(() => (window as DriverWindow).__candidateBlocks?.length >= 2, undefined, { timeout: 20_000 }).catch(async (err) => { await dumpDiagnostics(driver, "message-roundtrip-candidates"); throw err; });

      const result = await driver.evaluate(async (baseOrigin: string) => {
        const candidates = (window as DriverWindow).__candidateBlocks as Array<{ id: string; bbox: { y: number }; identity?: { stableId: string }; runtimeQuestionHandle?: string; runtimeOwnerKey?: string }>;
        const frameCandidate = [...candidates].sort((left, right) => left.bbox.y - right.bbox.y)[0]!;
        const [tab] = await chrome.tabs.query({ url: `${baseOrigin}/*` });
        if (!tab?.id) throw new Error("root e2e tab not found");
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "FILL_PARSED_ANSWER",
          block: frameCandidate,
          result: { blockId: frameCandidate.id, questionType: "single_choice", answer: "B", confidence: 0.99, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" },
        });
        return {
          handle: frameCandidate.runtimeQuestionHandle,
          ownerKey: frameCandidate.runtimeOwnerKey,
          response,
          stableIds: candidates.map((candidate) => candidate.identity?.stableId),
          candidateIds: candidates.map((candidate) => candidate.id),
          handles: candidates.map((candidate) => candidate.runtimeQuestionHandle),
        };
      }, server.origin);

      expect(result.handle).toMatch(/^rqh_[0-9a-f]{32}$/);
      expect(result.ownerKey).toBeUndefined();
      expect(new Set(result.handles).size).toBe(2);
      expect(new Set(result.candidateIds).size).toBe(2);
      expect(result.stableIds[0]).toBe(result.stableIds[1]);
      expect((result.response as { ok?: boolean }).ok).toBe(true);
      const state = await spaPage.evaluate(() => {
        const frame = document.getElementById("q-frame") as HTMLIFrameElement;
        return {
          frameSelected: frame.contentDocument?.querySelectorAll<HTMLButtonElement>(".option")[1]?.getAttribute("aria-checked"),
          topSelected: document.querySelector('[aria-checked="true"]') !== null,
        };
      });
      expect(state.frameSelected).toBe("true");
      expect(state.topSelected).toBe(false);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("E2E-SHADOW-DUPLICATE: identical top and shadow questions fill only the selected shadow instance", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      await spaPage.goto(`${server.origin}/shadow`);
      await spaPage.evaluate(() => {
        const topQuestion = document.createElement("section");
        topQuestion.className = "question-item";
        topQuestion.dataset.questionId = "12";
        topQuestion.style.marginTop = "100px";
        topQuestion.innerHTML = '<p class="stem">12. Which value equals 2 + 2? Choose the correct option.</p><img src="http://img.test/diagram-a.png" alt="figure">'
          + '<ul><li><button class="option">A. 3</button></li><li><button class="option">B. 4</button></li><li><button class="option">C. 5</button></li><li><button class="option">D. 6</button></li></ul>';
        document.body.append(topQuestion);
      });
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/shadow", false);
      await driver.waitForFunction(() => (window as DriverWindow).__candidateBlocks?.length >= 2, undefined, { timeout: 20_000 }).catch(async (err) => { await dumpDiagnostics(driver, "shadow-duplicate-candidates"); throw err; });
      const result = await driver.evaluate(async (baseOrigin: string) => {
        const candidates = (window as DriverWindow).__candidateBlocks as Array<{ id: string; bbox: { y: number } }>;
        const shadowCandidate = [...candidates].sort((left, right) => left.bbox.y - right.bbox.y)[0]!;
        const [tab] = await chrome.tabs.query({ url: `${baseOrigin}/*` });
        if (!tab?.id) throw new Error("root e2e tab not found");
        return chrome.tabs.sendMessage(tab.id, {
          type: "FILL_PARSED_ANSWER",
          block: shadowCandidate,
          result: { blockId: shadowCandidate.id, questionType: "single_choice", answer: "B", confidence: 0.99, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" },
        });
      }, server.origin);
      expect((result as { ok?: boolean }).ok).toBe(true);
      const state = await spaPage.evaluate(() => ({
        topSelected: document.querySelector('[aria-checked="true"]') !== null,
        shadowSelected: document.getElementById("q-host")!.shadowRoot!.querySelector('#opt-b')!.getAttribute("aria-checked"),
      }));
      expect(state.topSelected).toBe(false);
      expect(state.shadowSelected).toBe("true");
    } finally {
      await context.close();
      await server.close();
    }
  });

  test("E2E-SCROLLED-FRAME: nonzero outer scroll still locates and fills the frame question", async () => {
    test.setTimeout(90_000);
    const server = await startRootsServer();
    const context = await launchExtensionContext();
    try {
      const extensionId = await resolveExtensionId(context);
      const spaPage = await context.newPage();
      await spaPage.goto(`${server.origin}/scrolled-frame`);
      await expect.poll(() => spaPage.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(0);
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, "/scrolled-frame", false);
      await driver.waitForFunction(() => (window as DriverWindow).__candidateBlocks?.length > 0, undefined, { timeout: 20_000 });
      const result = await driver.evaluate(async (baseOrigin: string) => {
        const candidate = (window as DriverWindow).__candidateBlocks[0] as { id: string };
        const [tab] = await chrome.tabs.query({ url: `${baseOrigin}/*` });
        if (!tab?.id) throw new Error("root e2e tab not found");
        return chrome.tabs.sendMessage(tab.id, {
          type: "FILL_PARSED_ANSWER",
          block: candidate,
          result: { blockId: candidate.id, questionType: "single_choice", answer: "B", confidence: 0.99, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" },
        });
      }, server.origin);
      expect((result as { ok?: boolean }).ok).toBe(true);
      expect(await spaPage.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      expect(await spaPage.evaluate(() => (document.getElementById("q-frame") as HTMLIFrameElement).contentDocument?.querySelector('#opt-b')?.getAttribute("aria-checked"))).toBe("true");
    } finally {
      await context.close();
      await server.close();
    }
  });

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
