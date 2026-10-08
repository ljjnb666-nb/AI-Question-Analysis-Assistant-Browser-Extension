import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext } from "./helpers/extensionHarness";
import { visitLiveTargetUntilReady } from "@/shared/utils/liveSiteReadiness";
import { createLiveSiteDiagnostics } from "./helpers/liveSiteDiagnostics";

// Third-party page text must never enter uploaded failure traces, screenshots, or video.
test.use({ trace: "off", screenshot: "off", video: "off" });

const PINTIA_PUBLIC_PROBLEM_URL =
  "https://pintia.cn/problem-sets/434/exam/problems/type/6?page=0&problemSetProblemId=6182";
const PINTIA_EXPECTED_TITLE = "习题5.10 线性探测法的查找函数";

type LiveCandidate = {
  block: {
    id: string;
    questionTypeGuess: string;
    previewText: string;
    identity?: {
      stableId?: string;
      contentFingerprint?: string;
    };
  };
};

type WorkspaceSnapshot = {
  detection: { phase: "never_started" | "detecting" | "completed"; mode: "viewport" | "fullpage" | null };
  candidates: LiveCandidate[];
  originUrl: string;
  runtimeInstanceId: string;
  runtimeGeneration: number;
  routeEpoch: number;
};

type WorkspaceResponse = { ok?: boolean; snapshot?: WorkspaceSnapshot };

type Phase13PageProbe = {
  href: string;
  title: string;
  bodyText: string;
  submitCount: number;
  interactionEvents: Array<{ type: string; tag: string; name: string; id: string }>;
  formCount: number;
  controlState: Array<{
    tag: string;
    type: string;
    name: string;
    id: string;
    value: string;
    checked: boolean;
    selectedIndex: number;
  }>;
};

declare const chrome: {
  tabs: {
    query: (query: { url?: string; active?: boolean; currentWindow?: boolean }) => Promise<Array<{ id?: number; url?: string }>>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  };
  scripting: {
    executeScript: (options: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
  };
  runtime: {
    getManifest: () => { version: string };
  };
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function getExtensionWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

async function resolvePintiaTabId(worker: Worker): Promise<number> {
  return worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://pintia.cn/*" });
    const tab = tabs.find((entry) => typeof entry.id === "number");
    if (!tab?.id) throw new Error("Phase 13A could not resolve the live Pintia tab");
    return tab.id;
  });
}

async function installProductionContentRuntime(worker: Worker, tabId: number): Promise<void> {
  await worker.evaluate(async (id) => {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      files: ["content/content-main.js"],
    });
  }, tabId);
}

async function startViewportDetection(worker: Worker, tabId: number): Promise<void> {
  const response = await worker.evaluate(async (id) => {
    return await chrome.tabs.sendMessage(id, { type: "START_AUTO_DETECT" });
  }, tabId);
  expect(response).toMatchObject({ ok: true });
}

async function getWorkspaceSnapshot(worker: Worker, tabId: number, expectedUrl: string): Promise<WorkspaceResponse> {
  return worker.evaluate(async ({ id, url }) => {
    return await chrome.tabs.sendMessage(id, {
      type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT",
      expectedUrl: url,
    }) as WorkspaceResponse;
  }, { id: tabId, url: expectedUrl });
}

async function readPageProbe(page: Page): Promise<Phase13PageProbe> {
  return page.evaluate(() => {
    const state = window as Window & typeof globalThis & {
      __phase13SubmitCount?: number;
      __phase13InteractionEvents?: Array<{ type: string; tag: string; name: string; id: string }>;
    };
    return {
      href: location.href,
      title: document.title,
      bodyText: document.body.innerText,
      submitCount: state.__phase13SubmitCount ?? 0,
      interactionEvents: [...(state.__phase13InteractionEvents ?? [])],
      formCount: document.forms.length,
      controlState: Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select",
      )).map((control) => ({
        tag: control.tagName,
        type: control instanceof HTMLInputElement ? control.type : "",
        name: control.getAttribute("name") ?? "",
        id: control.id,
        value: control.value,
        checked: control instanceof HTMLInputElement ? control.checked : false,
        selectedIndex: control instanceof HTMLSelectElement ? control.selectedIndex : -1,
      })),
    };
  });
}

test("@phase13 LIVE_PINTIA_PUBLIC_READONLY_DETECTION proves production detection on a real public site", async () => {
  test.slow();
  test.setTimeout(150_000);

  const context = await launchExtensionContext();
  const evidenceDir = path.resolve("test-results", "phase13-evidence");

  try {
    await mkdir(evidenceDir, { recursive: true });
    const worker = await getExtensionWorker(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 960 });
    const resources = createLiveSiteDiagnostics();
    page.on("response", (response) => {
      // Store first-party classification, status and resource type; never URLs.
      const hostname = (() => {
        try { return new URL(response.url()).hostname; }
        catch { return ""; }
      })();
      resources.recordHttpFailure(response.request().resourceType(), response.status(), hostname === "pintia.cn");
    });
    page.on("requestfailed", (request) => {
      resources.recordRequestFailure(request.resourceType(), request.failure()?.errorText);
    });
    page.on("pageerror", () => resources.recordPageError());
    page.on("console", (message) => {
      if (message.type() === "error") resources.recordConsoleError();
    });

    // Snapshot every bounded visit. Never persist third-party content.
    const attemptSnapshots: Array<Record<string, string | number | boolean>> = [];
    const recordAttempt = async () => {
      const state = await page.evaluate(() => ({
        finalHostname: location.hostname,
        finalPathname: location.pathname,
        documentTitle: document.title,
        readyState: document.readyState,
        bodyTextLength: document.body?.innerText?.length ?? 0,
        scriptCount: document.scripts.length,
        hasBody: Boolean(document.body),
      })).catch(() => null);
      if (!state) {
        attemptSnapshots.push({ snapshotUnavailable: true });
        return;
      }
      const { documentTitle, ...sanitized } = state;
      attemptSnapshots.push({ ...sanitized, documentTitleSha256: sha256(documentTitle) });
    };

    // A successful HTTP 200 can still be an empty, challenged, or
    // unhydrated SPA shell. Retry the *content-ready* page visit, not just
    // failed document navigation. No synthetic fallback is ever accepted.
    const visit = await visitLiveTargetUntilReady(
      () => page.goto(PINTIA_PUBLIC_PROBLEM_URL, {
        waitUntil: "commit",
        timeout: 25_000,
      }),
      async () => {
        await expect.poll(
          async () => {
            const body = page.locator("body");
            if (await body.count() === 0) return false;
            return (await body.innerText()).includes(PINTIA_EXPECTED_TITLE);
          },
          { timeout: 17_000, intervals: [500, 1_000, 2_000, 4_000] },
        ).toBe(true);
      },
      { maxAttempts: 3, betweenAttempts: async () => {
        await recordAttempt();
        await page.waitForTimeout(1_000);
      } },
    );
    if (!visit.ready || !visit.response) {
      await recordAttempt();
      // The live upstream is not an owned fixture. Preserve a compact diagnostic,
      // but never turn an unreachable/challenged/changed page into a green result.
      const diagnostic = await page.evaluate(() => ({
        finalHostname: location.hostname,
        finalPathname: location.pathname,
        documentTitleSha256Input: document.title,
        bodyTextLength: document.body?.innerText?.length ?? 0,
        hasBody: Boolean(document.body),
      })).catch(() => null);
      await writeFile(
        path.join(evidenceDir, "live-target-unavailable.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          outcome: "LIVE_TARGET_CONTENT_UNAVAILABLE",
          siteId: "pintia-public-problem",
          httpStatus: visit.response?.status() ?? null,
          visitCount: visit.attemptsUsed,
          visitStatusCodes: visit.statusCodes,
          visitSnapshots: attemptSnapshots,
          resourceTelemetry: resources.snapshot(),
          finalHostname: diagnostic?.finalHostname ?? null,
          finalPathname: diagnostic?.finalPathname ?? null,
          documentTitleSha256: sha256(diagnostic?.documentTitleSha256Input ?? ""),
          bodyTextLength: diagnostic?.bodyTextLength ?? null,
          hasBody: diagnostic?.hasBody ?? false,
          detectionStarted: false,
          answerFillAttempted: false,
          automaticSubmissionObserved: false,
        }, null, 2)}\n`,
        "utf8",
      );
      throw new Error("LIVE_TARGET_CONTENT_UNAVAILABLE: public Pintia title not visible after bounded content-ready revisits; detection was not started");
    }
    const response = visit.response;
    expect(response.status(), "live Pintia main document must be a successful public response").toBeGreaterThanOrEqual(200);
    expect(response.status(), "live Pintia main document must not be a redirect or error").toBeLessThan(400);

    const finalUrl = new URL(page.url());
    expect(finalUrl.hostname).toBe("pintia.cn");
    expect(finalUrl.pathname).toContain("/problem-sets/434/exam/problems/type/6");

    await page.evaluate(() => {
      const state = window as Window & typeof globalThis & {
        __phase13SubmitCount?: number;
        __phase13InteractionEvents?: Array<{ type: string; tag: string; name: string; id: string }>;
      };
      state.__phase13SubmitCount = 0;
      state.__phase13InteractionEvents = [];
      const record = (event: Event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("qs-highlight-layer, qs-floating-window, qs-capture-overlay")) return;
        state.__phase13InteractionEvents!.push({
          type: event.type,
          tag: target?.tagName ?? "",
          name: target?.getAttribute("name") ?? "",
          id: target?.id ?? "",
        });
      };
      document.addEventListener("submit", (event) => {
        state.__phase13SubmitCount = (state.__phase13SubmitCount ?? 0) + 1;
        record(event);
      }, true);
      for (const type of ["click", "input", "change"]) document.addEventListener(type, record, true);
    });

    await page.waitForTimeout(1_000);
    const before = await readPageProbe(page);
    const tabId = await resolvePintiaTabId(worker);
    await installProductionContentRuntime(worker, tabId);
    await startViewportDetection(worker, tabId);

    await expect.poll(
      async () => {
        const snapshot = await getWorkspaceSnapshot(worker, tabId, page.url());
        return snapshot.ok === true && snapshot.snapshot?.detection.phase === "completed";
      },
      { timeout: 30_000, intervals: [200, 500, 1_000, 2_000] },
    ).toBe(true);

    const workspaceResponse = await getWorkspaceSnapshot(worker, tabId, page.url());
    expect(workspaceResponse.ok).toBe(true);
    const snapshot = workspaceResponse.snapshot;
    expect(snapshot).toBeTruthy();
    expect(snapshot!.originUrl).toBe(page.url());
    expect(snapshot!.candidates.length).toBeGreaterThanOrEqual(1);

    const titleCandidate = snapshot!.candidates.find(({ block }) =>
      block.previewText.includes(PINTIA_EXPECTED_TITLE)
      || block.previewText.includes("线性探测法的查找函数"),
    );
    expect(titleCandidate, "production detector must identify the live Pintia problem statement").toBeTruthy();
    expect(titleCandidate!.block.previewText.length).toBeGreaterThan(80);
    expect(["short_answer", "unknown"]).toContain(titleCandidate!.block.questionTypeGuess);

    const after = await readPageProbe(page);
    expect(after.href).toBe(before.href);
    expect(after.submitCount).toBe(0);
    expect(after.interactionEvents).toEqual([]);
    expect(after.controlState).toEqual(before.controlState);
    expect(after.bodyText).toContain(PINTIA_EXPECTED_TITLE);

    const extensionVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
    const evidence = {
      schemaVersion: 1,
      authority: "live-public-readonly",
      siteId: "pintia-public-problem",
      requestedUrl: PINTIA_PUBLIC_PROBLEM_URL,
      finalUrl: after.href,
      hostname: finalUrl.hostname,
      httpStatus: response.status(),
      pageTitle: after.title,
      extensionVersion,
      browserUserAgent: await page.evaluate(() => navigator.userAgent),
      workspace: {
        runtimeInstanceId: snapshot!.runtimeInstanceId,
        runtimeGeneration: snapshot!.runtimeGeneration,
        routeEpoch: snapshot!.routeEpoch,
        detection: snapshot!.detection,
        candidateCount: snapshot!.candidates.length,
        candidates: snapshot!.candidates.map(({ block }) => ({
          questionTypeGuess: block.questionTypeGuess,
          previewLength: block.previewText.length,
          previewSha256: sha256(block.previewText),
          stableIdPresent: Boolean(block.identity?.stableId),
          contentFingerprintPresent: Boolean(block.identity?.contentFingerprint),
        })),
      },
      pageIntegrity: {
        formCountBefore: before.formCount,
        formCountAfter: after.formCount,
        controlStateSha256Before: sha256(JSON.stringify(before.controlState)),
        controlStateSha256After: sha256(JSON.stringify(after.controlState)),
        problemTitleStillPresent: after.bodyText.includes(PINTIA_EXPECTED_TITLE),
        interactionEvents: after.interactionEvents,
        automaticSubmissionObserved: false,
        answerFillAttempted: false,
      },
    };

    await writeFile(
      path.join(evidenceDir, "pintia-public-readonly.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await closeExtensionContext(context);
  }
});
