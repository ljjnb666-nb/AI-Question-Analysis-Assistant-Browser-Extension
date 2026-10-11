import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext } from "./helpers/extensionHarness";

// Never persist third-party question text, option values, screenshots, or video.
test.use({ trace: "off", screenshot: "off", video: "off" });

const PUBLIC_URL = "https://www.koolearn.com/shiti/tk-4-28-0-0-1.html";
const REQUEST_ID = "18aabcde-0ee2-4e98-8e12-48fdce879012";
const sourceHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

declare const chrome: {
  tabs: {
    query: (query: Record<string, never>) => Promise<Array<{ id?: number; url?: string }>>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  };
  scripting: { executeScript: (options: { target: { tabId: number }; files: string[] }) => Promise<unknown> };
};

type PublicDiagnostic = {
  probedElements: number;
  acceptedCandidates: number;
  rejected: { geometry: number; text: number; controls: number; navigation: number;
    signal: number; confidence: number; completeness: number };
};

test("@phase13 RC03A-R3 KOOLEARN_LIVE_READONLY_PROBE detects a real public question without page writes", async () => {
  test.slow();
  test.setTimeout(170_000);
  const context = await launchExtensionContext();
  const evidenceDir = path.resolve("test-results", "phase13-evidence");
  try {
    await mkdir(evidenceDir, { recursive: true });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 960 });
    let statusCode: number | null = null;
    let ready = false;
    for (let attempt = 0; attempt < 2 && !ready; attempt++) {
      try {
        const response = await page.goto(PUBLIC_URL, { waitUntil: "domcontentloaded", timeout: 25_000 });
        statusCode = response?.status() ?? null;
        if (statusCode === null || statusCode < 200 || statusCode >= 400) continue;
        await expect.poll(
          async () => page.evaluate(() => {
            const body = document.body?.innerText ?? "";
            // The page may have a visible header without any hydrated question cards.
            return body.includes("题型：单选题") && body.includes("查看答案及解析");
          }),
          { timeout: 15_000, intervals: [400, 1_000, 2_000] },
        ).toBe(true);
        ready = true;
      } catch {
        // Do not print upstream HTML, navigation exceptions or URLs.
      }
    }
    if (!ready) {
      console.error("KOOLEARN_DIAG " + JSON.stringify({ siteId: "koolearn-public-list",
        outcome: "LIVE_CONTENT_NOT_READY", httpStatus: statusCode, attempts: 2 }));
      throw new Error("KOOLEARN_LIVE_CONTENT_NOT_READY");
    }

    const actualUrl = page.url();
    const parsed = new URL(actualUrl);
    expect(["koolearn.com", "www.koolearn.com"]).toContain(parsed.hostname);
    expect(parsed.pathname).toBe("/shiti/tk-4-28-0-0-1.html");

    await page.evaluate(() => {
      (window as unknown as { __qsLiveWrites: { submissions: number; interactions: number } })
        .__qsLiveWrites = { submissions: 0, interactions: 0 };
      document.addEventListener("submit", () => { ++(window as unknown as {
        __qsLiveWrites: { submissions: number; interactions: number };
      }).__qsLiveWrites.submissions; }, true);
      for (const kind of ["click", "input", "change"]) {
        document.addEventListener(kind, (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("qs-highlight-layer,qs-floating-window,qs-capture-overlay")) return;
          ++(window as unknown as { __qsLiveWrites: {
            submissions: number; interactions: number;
          } }).__qsLiveWrites.interactions;
        }, true);
      }
    });

    const tabId = await worker.evaluate(async (expectedPath) => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => {
        try {
          const url = new URL(t.url ?? "");
          return (url.hostname === "koolearn.com" || url.hostname === "www.koolearn.com")
            && url.pathname === expectedPath;
        } catch { return false; }
      });
      if (typeof target?.id !== "number") throw new Error("KOOLEARN_TAB_NOT_FOUND");
      return target.id;
    }, parsed.pathname);

    await worker.evaluate(async id => chrome.scripting.executeScript({
      target: { tabId: id }, files: ["content/content-main.js"],
    }), tabId);

    const reply = await worker.evaluate(async ({ id, expectedUrl, requestId }) =>
      chrome.tabs.sendMessage(id, {
        type: "START_AUTO_DETECT", requestId, expectedUrl,
      }), { id: tabId, expectedUrl: actualUrl, requestId: REQUEST_ID });
    expect(reply).toMatchObject({ ok: true, requestId: REQUEST_ID });

    const workspace = await worker.evaluate(async ({ id, expectedUrl }) =>
      chrome.tabs.sendMessage(id, {
        type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl,
      }), { id: tabId, expectedUrl: actualUrl }) as {
      ok: boolean; snapshot?: {
        originUrl: string;
        detection: { phase: string; mode: string; requestId?: string;
          diagnostics?: { domDiagnostics?: PublicDiagnostic } };
        candidates: Array<{ block: { previewText: string } }>;
      };
    };

    const after = await page.evaluate(() =>
      (window as unknown as { __qsLiveWrites: {
        submissions: number; interactions: number;
      } }).__qsLiveWrites,
    );
    const diagnostic = workspace.snapshot?.detection.diagnostics?.domDiagnostics;
    const candidateCount = workspace.snapshot?.candidates.length ?? 0;
    const evidence = {
      schemaVersion: 1, siteId: "koolearn-public-list", authority: "live-public-readonly",
      httpStatus: statusCode, contentReady: ready,
      originMatched: workspace.ok && workspace.snapshot?.originUrl === actualUrl,
      requestMatched: workspace.snapshot?.detection.requestId === REQUEST_ID,
      phase: workspace.snapshot?.detection.phase ?? null,
      mode: workspace.snapshot?.detection.mode ?? null,
      candidateCount, numericProbe: diagnostic ?? null,
      previewDigests: workspace.snapshot?.candidates.map(c => sourceHash(c.block.previewText)) ?? [],
      interactions: after.interactions, submissions: after.submissions,
    };
    await writeFile(path.join(evidenceDir, "koolearn-public-readonly.json"),
      JSON.stringify(evidence, null, 2) + "\n", "utf8");
    // Logs and evidence contain only numeric counts and one-way hashes, no question text.
    console.info("KOOLEARN_DIAG " + JSON.stringify({
      siteId: evidence.siteId, outcome: candidateCount > 0 ? "CANDIDATES_PRESENT" : "ZERO_CANDIDATES",
      candidateCount, numericProbe: diagnostic ?? null, interactions: after.interactions,
      submissions: after.submissions,
    }));

    expect(workspace.ok).toBe(true);
    expect(workspace.snapshot?.originUrl).toBe(actualUrl);
    expect(workspace.snapshot?.detection).toMatchObject({
      phase: "completed", mode: "viewport", requestId: REQUEST_ID,
    });
    expect(after.submissions).toBe(0);
    expect(after.interactions).toBe(0);
    // A real non-zero candidate is the criterion. A mere successful ACK or
    // diagnostic with zero candidates is NOT a site-compatibility PASS.
    expect(candidateCount, "KOOLEARN_ZERO_CANDIDATES: inspect the numeric-only evidence artifact")
      .toBeGreaterThan(0);
  } finally {
    await closeExtensionContext(context);
  }
});
