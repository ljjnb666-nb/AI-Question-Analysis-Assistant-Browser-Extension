import http from "node:http";
import type { CandidateWorkspaceSnapshot } from "../src/shared/types/workspace";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";
import { startTestAnalyticsBackend, type TestAnalyticsBackend } from "./helpers/authUiHarness";
import { seedAIConnection } from "./helpers/aiConnectionHarness";

// Mock values are assembled at runtime so security scanners do not mistake
// synthetic test fixtures for committed credentials.
const PHASE8A_E2E_KEY = ["phase8a", "e2e", "key"].join("-");

type SpaPageWindow = Window & typeof globalThis & {
  __clicks: Array<{ generation: number; label: string }>;
  __armButtons: (root: Element, generation: number) => void;
  __optionClick: (generation: number) => (event: Event) => void;
};

type DriverWindow = Window & typeof globalThis & { __events: string[] };

declare const chrome: {
  tabs: {
    query: (info: { url?: string; active?: boolean; currentWindow?: boolean }) => Promise<Array<{ id: number; title?: string; url?: string }>>;
    sendMessage: (tabId: number, message: { type: string; expectedUrl?: string }) => Promise<unknown>;
    update: (tabId: number, properties: { active?: boolean }) => Promise<unknown>;
  };
  scripting: { executeScript: (injection: { target: { tabId: number }; files: string[] }) => Promise<unknown> };
  runtime: { onMessage: { addListener: (listener: (message: unknown) => void) => void } };
  storage: { local: {
    get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
  } };
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

/** Boots the real extension content runtime in the SPA tab and starts the production SPA watch. */
async function startProductionAutoSolve(context: BrowserContext, extensionId: string, origin: string, analyticsOptIn = false): Promise<Page> {
  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await driver.evaluate(() => {
    (window as DriverWindow).__events = [];
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const type = (message as { type?: string } | null)?.type;
      if (type) (window as DriverWindow).__events.push(type);
    });
  });

  await driver.evaluate(({ baseOrigin, analyticsOptIn }: { baseOrigin: string; analyticsOptIn: boolean }) => chrome.storage.local.set({
    parseHistory: [],
    analyticsLog: [],
    appSettings: {
      preferredRoute: "text",
      language: "en",
      enableAnalytics: analyticsOptIn,
      analyticsConsentVersion: 1,
      analyticsBaseUrl: baseOrigin,
    },
  }), { baseOrigin: origin, analyticsOptIn });
  await seedAIConnection(driver, { providerId: "custom", apiModel: "qwen3-vl", customBaseUrl: `${origin}/api`, customProviderProtocol: "openai", credential: { action: "REPLACE", value: "e2e-key" } });

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

async function installControlledProvider(context: BrowserContext) {
  type Gate = { started: Promise<void>; release: () => void; markStarted: () => void; released: Promise<void> };
  const queued: Gate[] = [];
  await context.route("**/chat/completions", async (route) => {
    const gate = queued.shift();
    if (!gate) {
      await route.abort();
      return;
    }
    gate.markStarted();
    await gate.released;
    const modelJson = JSON.stringify({
      questionType: "single_choice",
      answer: "B",
      confidence: 0.99,
      briefExplanation: "mocked",
      detailedExplanation: "mocked explanation",
      recognizedText: "12. Which value is equal to 2 + 2? Choose the correct option. A. 3 B. 4 C. 5 D. 6",
      optionSelections: { B: true },
      warning: null,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: modelJson } }] }),
    });
  });

  return {
    holdNext(): Gate {
      let release!: () => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const gate: Gate = { started, release, markStarted: () => markStarted(), released };
      queued.push(gate);
      return gate;
    },
  };
}

async function getPageTabId(driver: Page, origin: string, title: string): Promise<number> {
  const tabId = await driver.evaluate(async ({ baseOrigin, expectedTitle }) => {
    const tabs = await chrome.tabs.query({ url: `${baseOrigin}/*` });
    return tabs.find((tab) => tab?.title === expectedTitle)?.id ?? null;
  }, { baseOrigin: origin, expectedTitle: title });
  if (tabId === null) throw new Error(`Tab not found: ${title}`);
  return tabId;
}

async function seedAuthenticatedSidePanel(driver: Page, backend: TestAnalyticsBackend, account: {
  userId: string;
  email: string;
  authToken: string;
}) {
  // Server-authoritative UI sessions require REAL credentials: the sidepanel
  // validates the seeded session against the real analytics backend before
  // unlocking the workspace, so a synthetic token can never unlock it.
  await driver.evaluate(async ({ analyticsBaseUrl, userId, userEmail, authToken }) => chrome.storage.local.set({
    parseHistory: [],
    analyticsLog: [],
    appSettings: {
      userId,
      userEmail,
      authToken,
      preferredRoute: "text",
      language: "en",
      enableAnalytics: true,
      analyticsConsentVersion: 1,
      analyticsBaseUrl,
    },
  }), { analyticsBaseUrl: backend.baseUrl, userId: account.userId, userEmail: account.email, authToken: account.authToken });
  await seedAIConnection(driver, { providerId: "deepseek", apiModel: "deepseek-v4-flash", credential: { action: "REPLACE", value: PHASE8A_E2E_KEY } });
}

async function sendDetectToTab(driver: Page, tabId: number) {
  await driver.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content/content-main.js"] });
    await chrome.tabs.sendMessage(id, { type: "START_AUTO_DETECT" });
  }, tabId);
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
      const driver = await startProductionAutoSolve(context, extensionId, server.origin, true);

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
      const history = await driver.evaluate(async () => (await chrome.storage.local.get("parseHistory")).parseHistory as Array<{ id?: string }>);
      expect(history.filter((entry) => entry.id?.startsWith("auto-solve-")).map((entry) => entry.id)).toEqual([]);
      await expect.poll(async () => driver.evaluate(async () => {
        const entries = (await chrome.storage.local.get("analyticsLog")).analyticsLog as Array<{ event?: string }>;
        return entries.map((entry) => entry.event);
      }), { timeout: 10_000 }).toContain("provider_result_discarded_stale");
      const analyticsEvents = await driver.evaluate(async () => {
        const entries = (await chrome.storage.local.get("analyticsLog")).analyticsLog as Array<{ event?: string }>;
        return entries.map((entry) => entry.event);
      });
      expect(analyticsEvents).not.toContain("parse_success");
      expect(analyticsEvents).not.toContain("manual_parse_attempt_succeeded");
    } finally {
      await closeExtensionContext(context);
      await server.close();
    }
  });

  test("P_REL_PERM_07_HTTP_SITE_GENERALITY_PRESERVED and Phase 8A RC-D: sidepanel Fill stays bound to the origin tab after switching tabs", async () => {
    test.setTimeout(60_000);
    const server = await startSpaServer();
    const context = await launchExtensionContext();
    const authBackend = await startTestAnalyticsBackend();
    const phase8aAccount = await authBackend.registerAccount("phase8a");
    try {
      const extensionId = await resolveExtensionId(context);
      const originPage = await context.newPage();
      await originPage.goto(`${server.origin}/q?source=origin`);
      await originPage.evaluate(() => { document.title = "Phase 8A Origin"; });
      const otherPage = await context.newPage();
      await otherPage.goto(`${server.origin}/q?source=other`);
      await otherPage.evaluate(() => { document.title = "Phase 8A Other"; });

      const driver = await context.newPage();
      await driver.goto(`chrome-extension://${extensionId}/popup/popup.html`);
      await seedAuthenticatedSidePanel(driver, authBackend, phase8aAccount);
      const originTabId = await getPageTabId(driver, server.origin, "Phase 8A Origin");
      const otherTabId = await getPageTabId(driver, server.origin, "Phase 8A Other");
      await driver.evaluate(async (id) => chrome.tabs.update(id, { active: true }), originTabId);

      const sidePanel = await context.newPage();
      await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
      await expect(sidePanel.getByText("Workspace", { exact: true })).toBeVisible();
      await sendDetectToTab(driver, originTabId);
      await expect(sidePanel.getByText(/Which value is equal to 2 \+ 2/)).toBeVisible();
      await sidePanel.getByRole("checkbox", { name: "Select question 1" }).check();
      const solveButton = sidePanel.getByRole("button", { name: "Solve selected" });
      await expect(solveButton).toBeVisible();

      const provider = await installControlledProvider(context);
      const held = provider.holdNext();
      await solveButton.click();
      await held.started;
      await driver.evaluate(async (id) => chrome.tabs.update(id, { active: true }), otherTabId);
      const activeTabId = await driver.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null);
      expect(activeTabId).toBe(otherTabId);
      held.release();

      await expect(sidePanel.getByRole("region", { name: "Answer", exact: true }).getByText("B", { exact: true })).toBeVisible();
      const historyAfterParse = await driver.evaluate(async () => (await chrome.storage.local.get("parseHistory")).parseHistory as Array<{ host?: string }>);
      expect(historyAfterParse).toHaveLength(1);
      expect(historyAfterParse[0].host).toBe("127.0.0.1");
      await expect.poll(async () => driver.evaluate(async () => {
        const entries = (await chrome.storage.local.get("analyticsLog")).analyticsLog as Array<{ event?: string }>;
        return entries.filter((entry) => entry.event === "parse_success").length;
      }), { timeout: 10_000 }).toBe(1);

      await sidePanel.getByRole("button", { name: "Fill answer" }).click();
      await expect.poll(() => originPage.evaluate(() => (window as SpaPageWindow).__clicks)).toEqual([{ generation: 0, label: "B" }]);
      expect(await otherPage.evaluate(() => (window as SpaPageWindow).__clicks)).toEqual([]);
    } finally {
      await closeExtensionContext(context);
      await server.close();
      await authBackend.close();
    }
  });

  test("Phase 8A RC-E: a sidepanel result from a changed origin revision commits neither candidate nor history", async () => {
    test.setTimeout(60_000);
    const server = await startSpaServer();
    const context = await launchExtensionContext();
    const authBackend = await startTestAnalyticsBackend();
    const phase8aAccount = await authBackend.registerAccount("phase8a-stale");
    try {
      const extensionId = await resolveExtensionId(context);
      const originPage = await context.newPage();
      await originPage.goto(`${server.origin}/q?source=origin`);
      await originPage.evaluate(() => { document.title = "Phase 8A Stale Origin"; });
      const otherPage = await context.newPage();
      await otherPage.goto(`${server.origin}/q?source=other`);
      await otherPage.evaluate(() => { document.title = "Phase 8A Stale Other"; });

      const driver = await context.newPage();
      await driver.goto(`chrome-extension://${extensionId}/popup/popup.html`);
      await seedAuthenticatedSidePanel(driver, authBackend, phase8aAccount);
      const originTabId = await getPageTabId(driver, server.origin, "Phase 8A Stale Origin");
      const otherTabId = await getPageTabId(driver, server.origin, "Phase 8A Stale Other");
      await driver.evaluate(async (id) => chrome.tabs.update(id, { active: true }), originTabId);
      const sidePanel = await context.newPage();
      await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
      await expect(sidePanel.getByText("Workspace", { exact: true })).toBeVisible();
      await sendDetectToTab(driver, originTabId);
      await expect(sidePanel.getByText(/Which value is equal to 2 \+ 2/)).toBeVisible();
      await sidePanel.getByRole("checkbox", { name: "Select question 1" }).check();

      const provider = await installControlledProvider(context);
      const held = provider.holdNext();
      await sidePanel.getByRole("button", { name: "Solve selected" }).click();
      await held.started;
      await driver.evaluate(async (id) => chrome.tabs.update(id, { active: true }), otherTabId);
      await originPage.evaluate(() => {
        document.getElementById("stem")!.textContent = "12. Which value is equal to 5 + 5? Choose the correct option.";
        document.getElementById("opt-a")!.textContent = "A. 8";
        document.getElementById("opt-b")!.textContent = "B. 10";
        document.getElementById("opt-c")!.textContent = "C. 12";
        document.getElementById("opt-d")!.textContent = "D. 14";
      });
      await expect(sidePanel.getByText(/Which value is equal to 5 \+ 5/)).toBeVisible();
      held.release();

      await expect(sidePanel.locator("dl dt").filter({ hasText: /^Solved$/ }).locator("..").locator("dd")).toHaveText("0");
      expect(await sidePanel.getByRole("region", { name: "Answer", exact: true }).count()).toBe(0);
      const history = await driver.evaluate(async () => (await chrome.storage.local.get("parseHistory")).parseHistory as unknown[]);
      expect(history).toEqual([]);
      await expect.poll(async () => driver.evaluate(async () => {
        const entries = (await chrome.storage.local.get("analyticsLog")).analyticsLog as Array<{ event?: string }>;
        return entries.map((entry) => entry.event);
      }), { timeout: 10_000 }).toContain("provider_result_discarded_stale");
      const analyticsEvents = await driver.evaluate(async () => {
        const entries = (await chrome.storage.local.get("analyticsLog")).analyticsLog as Array<{ event?: string }>;
        return entries.map((entry) => entry.event);
      });
      expect(analyticsEvents).not.toContain("parse_success");
      expect(analyticsEvents).not.toContain("manual_parse_attempt_succeeded");
      expect(await originPage.evaluate(() => (window as SpaPageWindow).__clicks)).toEqual([]);
      expect(await otherPage.evaluate(() => (window as SpaPageWindow).__clicks)).toEqual([]);
    } finally {
      await closeExtensionContext(context);
      await server.close();
      await authBackend.close();
    }
  });

  test("Scenario B: a semantic-equivalent owner replacement rebinds, then fresh detection remains available", async () => {
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
      // Phase 8B rebinds only the unique replacement owner with the exact
      // sealed identity inside the unchanged authoritative root.
      expect(clicks).toEqual([{ generation: 1, label: "B" }]);

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
      await closeExtensionContext(context);
      await server.close();
    }
  });
});


test("UI04A real runtime: reopening during provider await restores running; a different bound tab stays independent", async () => {
  test.setTimeout(60_000);
  const server = await startSpaServer();
  const context = await launchExtensionContext();
  const backend = await startTestAnalyticsBackend();
  try {
    const account = await backend.registerAccount("ui04a");
    const extensionId = await resolveExtensionId(context);
    const pageA = await context.newPage();
    await pageA.goto(`${server.origin}/q?workspace=A`);
    const driver = await startProductionAutoSolve(context, extensionId, server.origin);
    await expect.poll(() => server.held.length).toBe(1);
    await seedAuthenticatedSidePanel(driver, backend, account);
    const tabA = await driver.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id, pageA.url());
    const read = (tabId: number, url: string): Promise<{ ok: boolean; snapshot: CandidateWorkspaceSnapshot }> => driver.evaluate(async ({ tabId, url }) =>
      chrome.tabs.sendMessage(tabId, { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: url }), { tabId, url }) as Promise<{ ok: boolean; snapshot: CandidateWorkspaceSnapshot }>;
    const before = await read(tabA, pageA.url());
    expect(before.ok).toBe(true);
    expect(before.snapshot.autoSolve.running).toBe(true);
    const owners = await driver.evaluate(async () => {
      const stored = await chrome.storage.local.get(null);
      return Object.fromEntries(Object.entries(stored).filter(([key]) => key.startsWith("protectedWorkOwner:")));
    });
    const openPanel = async () => {
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
      return panel;
    };
    const first = await openPanel();
    await expect(first.getByRole("button", { name: /Stop Solve/ })).toBeVisible();
    await first.close();
    const reopened = await openPanel();
    await expect(reopened.getByRole("button", { name: /Stop Solve/ })).toBeVisible();
    // No progress/completion event has occurred: opening reads cannot restart
    // work, mutate selection or owners, or synthesize a later content seq.
    expect((await read(tabA, pageA.url())).snapshot).toEqual(before.snapshot);
    expect(server.held).toHaveLength(1);
    expect(await driver.evaluate(async () => {
      const stored = await chrome.storage.local.get(null);
      return Object.fromEntries(Object.entries(stored).filter(([key]) => key.startsWith("protectedWorkOwner:")));
    })).toEqual(owners);
    await reopened.close();
    const pageB = await context.newPage();
    await pageB.goto(`${server.origin}/q?workspace=B`);
    await pageB.evaluate(() => document.getElementById("q12")!.remove());
    const tabB = await driver.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id, pageB.url());
    await sendDetectToTab(driver, tabB);
    const empty = await read(tabB, pageB.url());
    expect(empty.snapshot.detection.phase).toBe("completed");
    expect(empty.snapshot.candidates).toEqual([]);
    expect(empty.snapshot.autoSolve.running).toBe(false);
    const boundB = await openPanel();
    await expect(boundB.getByRole("button", { name: "Solve & Fill", exact: true })).toBeVisible();
    await expect(boundB.getByRole("button", { name: /Stop Solve/ })).toHaveCount(0);
    await expect(boundB.getByText(/Which value is equal to 2/)).toHaveCount(0);
    expect((await read(tabA, pageA.url())).snapshot.autoSolve.running).toBe(true);
  } finally {
    await closeExtensionContext(context);
    await server.close();
    await backend.close();
  }
});
