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

    // The public catalogue begins below a long topic-navigation sidebar.
    // Bring the first real stem into the viewport before testing a
    // *viewport* detector. Scrolling is read-only; no link or option click.
    const stemVisible = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("p,div,li,span"));
      const stem = nodes.find(node => {
        const text = (node.textContent ?? "").trim();
        return text.length >= 30 && text.length <= 450
          && text.includes("凡是符合自己的认识或自己所维护的道德观念");
      });
      if (!stem) return false;
      stem.scrollIntoView({ block: "center", inline: "nearest" });
      return true;
    });
    expect(stemVisible, "KOOLEARN_PUBLIC_QUESTION_ANCHOR_NOT_FOUND").toBe(true);
    await page.waitForTimeout(350);
    // Privacy-preserving structural census of the public question's
    // ancestor chain. No raw stem, option body, selector, or class name.
    const structure = await page.evaluate(() => {
      const stem = Array.from(document.querySelectorAll("p,div,li,span")).find(node => {
        const t = (node.textContent ?? "").trim();
        return t.length >= 30 && t.length <= 450
          && t.includes("凡是符合自己的认识或自己所维护的道德观念");
      });
      const viewArea = Math.max(1, innerWidth * innerHeight);
      const ancestors: Array<Record<string, number | boolean | string>> = [];
      let node: Element | null = stem ?? null;
      for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
        const current: Element = node;
        const rect = current.getBoundingClientRect();
        const text = (current as HTMLElement).innerText || current.textContent || "";
        const leafLabels = Array.from(current.querySelectorAll("span,div,p,li"))
          .filter(el => el.childElementCount === 0)
          .map(el => (el.textContent ?? "").trim());
        const singles = Object.fromEntries("ABCD".split("")
          .map(letter => [letter, leafLabels.filter(t => t === letter).length]));
        ancestors.push({
          depth, tag: current.tagName.toLowerCase(), children: current.childElementCount,
          links: current.querySelectorAll("a").length, textLength: text.length,
          x: Math.round(rect.left), y: Math.round(rect.top),
          width: Math.round(rect.width), height: Math.round(rect.height),
          areaPct: Math.round((rect.width * rect.height) / viewArea * 100),
          visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight,
          questionLikeClass: /question|problem|item|exam|card/i.test(String((current as HTMLElement).className ?? "")),
          lineBreaks: text.split(String.fromCharCode(10)).length - 1,
          dottedChoices: (text.match(/[A-D][.、:)：]/g) ?? []).length,
          leafA: singles.A ?? 0, leafB: singles.B ?? 0,
          leafC: singles.C ?? 0, leafD: singles.D ?? 0,
        });
      }
      return ancestors;
    });

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
        candidates: Array<{ block: { previewText: string; bbox?: {
          x: number; y: number; width: number; height: number
        }; runtimeOwnerKey?: string; identity?: { stableId?: string } } }>;
      };
    };

    // Link workspace results to their own DOM cards by geometry, rather
    // than falsely declaring different questions duplicates when a common
    // phrase occurs in several question stems. Only counts/boolean evidence
    // are persisted; original DOM and question text never enter the artifact.
    const cardOwnership = await page.evaluate((candidateBoxes: Array<{
      bbox?: { x: number; y: number; width: number; height: number };
      previewText: string;
    }>) => {
      const normalize = (text: string) => text.replace(/\\s+/g, " ").trim();
      const cards = Array.from(document.querySelectorAll("div,article,section,li"))
        .filter((el) => {
          const raw = el.textContent ?? "";
          if (raw.length < 35 || raw.length > 550 || el.querySelectorAll("a").length > 2) return false;
          const markers = Array.from(el.querySelectorAll("span,div,p,li,b,strong,em,i,label"))
            .filter(node => node.childElementCount === 0
              && /^[A-D]$/.test((node.textContent ?? "").trim())
              && !node.closest("a,button,nav,header,footer,aside"));
          if (markers.map(node => (node.textContent ?? "").trim()).join("") !== "ABCD") return false;
          const rect = el.getBoundingClientRect();
          return rect.width >= 60 && rect.height >= 40
            && rect.bottom > 0 && rect.top < innerHeight;
        });
      const leafCards = cards.filter(card =>
        !cards.some(inner => inner !== card && card.contains(inner)));
      return {
        cardCount: leafCards.length,
        owners: candidateBoxes.map(({ bbox, previewText }) => {
          if (!bbox) return { index: -1, overlap: 0, stemMatch: false };
          let index = -1, best = 0;
          for (let i = 0; i < leafCards.length; i++) {
            const rect = leafCards[i]!.getBoundingClientRect();
            const width = Math.max(0, Math.min(rect.right, bbox.x + bbox.width) - Math.max(rect.left, bbox.x));
            const height = Math.max(0, Math.min(rect.bottom, bbox.y + bbox.height) - Math.max(rect.top, bbox.y));
            const overlap = width * height / Math.max(1, bbox.width * bbox.height);
            if (overlap > best) { best = overlap; index = i; }
          }
          const card = leafCards[index];
          if (!card || best < 0.5) return { index: -1, overlap: Math.round(best * 100), stemMatch: false };
          const markers = Array.from(card.querySelectorAll("span,div,p,li,b,strong,em,i,label"))
            .filter(node => node.childElementCount === 0 && /^[A-D]$/.test((node.textContent ?? "").trim()));
          const range = document.createRange();
          range.selectNodeContents(card);
          range.setEndBefore(markers[0]!);
          const stem = normalize(range.toString());
          const stemMatch = stem.length >= 18 && normalize(previewText).includes(stem.slice(0, 18));
          return { index, overlap: Math.round(best * 100), stemMatch };
        }),
      };
    }, workspace.snapshot?.candidates.map(({ block }) => ({
      bbox: block.bbox, previewText: block.previewText,
    })) ?? []);

    const after = await page.evaluate(() =>
      (window as unknown as { __qsLiveWrites: {
        submissions: number; interactions: number;
      } }).__qsLiveWrites,
    );
    const diagnostic = workspace.snapshot?.detection.diagnostics?.domDiagnostics;
    const candidateCount = workspace.snapshot?.candidates.length ?? 0;
    // Non-zero alone is not sufficient: a menu false positive must not
    // certify Koolearn. Demand a real question stem with owned A/B/C/D.
    const anchoredCandidateBlocks = workspace.snapshot?.candidates.filter(({ block }) => {
      const preview = block.previewText;
      return preview.includes("品德心理结构")
        && /A[.、:)：].+B[.、:)：].+C[.、:)：].+D[.、:)：]/.test(preview);
    }) ?? [];
    const anchorCandidateShapes = anchoredCandidateBlocks.slice(0, 8).map(({ block }) => ({
      bbox: block.bbox ?? null,
      previewLength: block.previewText.length,
      ownerDigest: block.runtimeOwnerKey ? sourceHash(block.runtimeOwnerKey) : null,
      identityDigest: block.identity?.stableId ? sourceHash(block.identity.stableId) : null,
    }));
    const completeQuestionCandidates = workspace.snapshot?.candidates.filter(({ block }) => {
      const preview = block.previewText;
      return preview.includes("品德心理结构")
        && /A[.、:)：].+B[.、:)：].+C[.、:)：].+D[.、:)：]/.test(preview);
    }).length ?? 0;
    const evidence = {
      schemaVersion: 1, siteId: "koolearn-public-list", authority: "live-public-readonly",
      httpStatus: statusCode, contentReady: ready,
      originMatched: workspace.ok && workspace.snapshot?.originUrl === actualUrl,
      requestMatched: workspace.snapshot?.detection.requestId === REQUEST_ID,
      phase: workspace.snapshot?.detection.phase ?? null,
      mode: workspace.snapshot?.detection.mode ?? null,
      candidateCount, completeQuestionCandidates, numericProbe: diagnostic ?? null, structure,
      anchorCandidateShapes, cardOwnership,
      previewDigests: workspace.snapshot?.candidates.map(c => sourceHash(c.block.previewText)) ?? [],
      interactions: after.interactions, submissions: after.submissions,
    };
    await writeFile(path.join(evidenceDir, "koolearn-public-readonly.json"),
      JSON.stringify(evidence, null, 2) + "\n", "utf8");
    // Logs and evidence contain only numeric counts and one-way hashes, no question text.
    console.info("KOOLEARN_DIAG " + JSON.stringify({
      siteId: evidence.siteId, outcome: candidateCount > 0 ? "CANDIDATES_PRESENT" : "ZERO_CANDIDATES",
      candidateCount, completeQuestionCandidates, numericProbe: diagnostic ?? null, structure,
      anchorCandidateShapes, cardOwnership, interactions: after.interactions,
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
    expect(completeQuestionCandidates, "KOOLEARN_CHOICES_NOT_STRUCTURED: first public question must be legible")
      .toBeGreaterThan(0);
    expect(cardOwnership.owners.every(owner => owner.index >= 0 && owner.overlap >= 50),
      "KOOLEARN_CARD_OWNERSHIP_MISSING: every candidate must belong to one visible bounded card").toBe(true);
    expect(new Set(cardOwnership.owners.map(owner => owner.index)).size,
      "KOOLEARN_CARD_DUPLICATION: two candidates may not claim the same card").toBe(candidateCount);
    expect(cardOwnership.owners.every(owner => owner.stemMatch),
      "KOOLEARN_PREVIEW_OWNERSHIP_MISMATCH: preview must contain its own card stem").toBe(true);
  } finally {
    await closeExtensionContext(context);
  }
});
