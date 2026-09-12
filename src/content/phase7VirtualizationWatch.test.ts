import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { detectCandidatesInRoot, detectCandidatesAcrossRoots } from "./detector/domDetector";
import { sharedRootRegistry, AccessibleRootRegistry } from "./roots/rootRegistry";
import { rootAttachmentOf, TOP_ROOT_KEY } from "./roots/rootContext";
import {
  abortQuestionRevisionAttempt,
  abortQuestionRevisionAttemptForRoot,
  beginQuestionRevisionAttempt,
  clearQuestionRevisionAttempt,
  revisionRegistry,
} from "./revision/questionRevisionRuntime";
import { startQuestionRevisionWatch } from "./revision/questionRevisionWatch";
import { captureSolveStartControlState, fillParsedAnswerInPage, hasAutoSolveQuestionAttempt } from "./answerFiller";
import { runAutoSolveAll } from "./autoSolveOrchestration";

function stubRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }),
  });
}

function questionHtml(nativeId: string, media: string): string {
  return `<div class="question-item" data-question-id="${nativeId}"><p class="stem">${nativeId}. Which value equals 2 + 2? <span>x^2</span></p><img src="http://img.test/${media}.png" alt="figure"><ul><li><button class="option">A. 3</button></li><li><button class="option" id="opt-b">B. 4</button></li><li><button class="option" id="opt-c">C. 5</button></li><li><button class="option">D. 6</button></li></ul></div>`;
}

function parseResult(answer = "B"): ParseResult {
  return { blockId: "any", questionType: "single_choice", answer, confidence: 0.99, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
}

function armAriaReflection(scope: ParentNode) {
  scope.querySelectorAll(".option").forEach((button) => {
    button.addEventListener("click", () => {
      scope.querySelectorAll(".option").forEach((other) => other.setAttribute("aria-checked", String(other === button)));
    });
  });
}

function mountQuestion(rootNode: HTMLElement, html: string): Element {
  rootNode.innerHTML = html;
  const container = rootNode.querySelector(".question-item")!;
  stubRect(container, { left: 8, top: 8, width: 640, height: 220 });
  armAriaReflection(container);
  return container;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("Phase 7 virtualization and recycled components", () => {
  const originalElementsFromPoint = document.elementsFromPoint;
  beforeEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    document.elementsFromPoint = (() => []) as typeof document.elementsFromPoint;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    document.elementsFromPoint = originalElementsFromPoint;
  });

  it("VIRT-1 classifies a recycled owner as REPLACED and never writes Q13 with the Q12 result", async () => {
    const registry = new AccessibleRootRegistry();
    registry.reconcile(document);
    const topRoot = registry.get(TOP_ROOT_KEY)!;
    const owner = mountQuestion(document.body, questionHtml("12", "diagram-a"));
    const [q12] = detectCandidatesInRoot(topRoot.root, topRoot);
    const controller = new AbortController();
    beginQuestionRevisionAttempt(q12!, controller);
    revisionRegistry().observe(q12!, owner, { rootKey: TOP_ROOT_KEY, rootGeneration: 0 });

    // The virtual list recycles the same owner element to Q13.
    mountQuestion(document.body, questionHtml("13", "diagram-a"));
    const [q13] = detectCandidatesInRoot(topRoot.root, topRoot);
    expect(q13!.identity!.stableId).not.toBe(q12!.identity!.stableId);
    const observed = revisionRegistry().observe(q13!, owner, { rootKey: TOP_ROOT_KEY, rootGeneration: 0 });
    expect(observed.event).toBe("REPLACED");
    abortQuestionRevisionAttempt();

    // The late Q12 result must not fill the recycled (Q13) owner.
    captureSolveStartControlState(q13!);
    const outcome = await fillParsedAnswerInPage(q13!, parseResult("B"), { mode: "auto" });
    expect(controller.signal.aborted).toBe(true);
    expect(outcome.message).toBe("STALE_QUESTION_REVISION");
    expect(owner.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it("VIRT-2 treats a semantic-equivalent rerender as REBOUND without recapturing the baseline", async () => {
    const registry = new AccessibleRootRegistry();
    registry.reconcile(document);
    const topRoot = registry.get(TOP_ROOT_KEY)!;
    mountQuestion(document.body, questionHtml("12", "diagram-a"));
    const [q12] = detectCandidatesInRoot(topRoot.root, topRoot);
    captureSolveStartControlState(q12!);
    const controller = new AbortController();
    beginQuestionRevisionAttempt(q12!, controller);

    // The site rerenders the same semantic question with brand-new DOM nodes,
    // then the user selects C in the new live DOM (sites preserve input state
    // across rerenders).
    const rerenderedOwner = mountQuestion(document.body, questionHtml("12", "diagram-a"));
    const userSelection = rerenderedOwner.querySelector("#opt-c")!;
    userSelection.setAttribute("aria-checked", "true");
    const [q12b] = detectCandidatesInRoot(topRoot.root, topRoot);
    expect(q12b!.identity!.stableId).toBe(q12!.identity!.stableId);
    expect(q12b!.identity!.contentFingerprint).toBe(q12!.identity!.contentFingerprint);

    // The pending attempt stays alive; the rebuilt live mapping sees the
    // user's C while the immutable solve-start baseline did not have it, so
    // Phase 5 refuses to overwrite (the baseline was NOT recaptured).
    const outcome = await fillParsedAnswerInPage(q12b!, parseResult("B"), { mode: "auto" });
    expect(controller.signal.aborted).toBe(false);
    expect(outcome.message).toBe("USER_STATE_CHANGED");
    expect(userSelection.getAttribute("aria-checked")).toBe("true");
    clearQuestionRevisionAttempt(controller);
  });

  it("VIRT-3 invalidates a detached active question and allows a fresh safe rebind", async () => {
    const registry = new AccessibleRootRegistry();
    registry.reconcile(document);
    const topRoot = registry.get(TOP_ROOT_KEY)!;
    const owner = mountQuestion(document.body, questionHtml("12", "diagram-a"));
    const [q12] = detectCandidatesInRoot(topRoot.root, topRoot);
    captureSolveStartControlState(q12!);
    const controller = new AbortController();
    beginQuestionRevisionAttempt(q12!, controller);

    owner.remove();
    registry.reconcile(document);
    const detached = await fillParsedAnswerInPage(q12!, parseResult("B"), { mode: "auto" });
    expect(detached.ok).toBe(false);

    // Reattach an equivalent question: a new attempt can safely bind to it.
    document.body.append(owner);
    const [q12b] = detectCandidatesInRoot(topRoot.root, topRoot);
    const controller2 = new AbortController();
    beginQuestionRevisionAttempt(q12b!, controller2);
    expect(controller2.signal.aborted).toBe(false);
    clearQuestionRevisionAttempt(controller2);
  });

  it("VIRT-4 detects a media revision change on the same owner and rejects the stale result", async () => {
    const registry = new AccessibleRootRegistry();
    registry.reconcile(document);
    const topRoot = registry.get(TOP_ROOT_KEY)!;
    const owner = mountQuestion(document.body, questionHtml("12", "diagram-a"));
    const [q12a] = detectCandidatesInRoot(topRoot.root, topRoot);
    const controller = new AbortController();
    beginQuestionRevisionAttempt(q12a!, controller);

    owner.querySelector("img")!.setAttribute("src", "http://img.test/diagram-b.png");
    const [q12b] = detectCandidatesInRoot(topRoot.root, topRoot);
    expect(q12b!.identity!.nativeQuestionId).toBe(q12a!.identity!.nativeQuestionId);
    expect(q12b!.identity!.contentFingerprint).not.toBe(q12a!.identity!.contentFingerprint);

    captureSolveStartControlState(q12b!);
    const outcome = await fillParsedAnswerInPage(q12b!, parseResult("B"), { mode: "auto" });
    // The watcher would abort on the fingerprint change (covered by the SPA
    // matrix); here the final gate itself must reject the stale instance.
    expect(outcome.message).toBe("STALE_QUESTION_REVISION");
  });

  it("VIRT-5 keeps runtime registries bounded across 50 recycle generations", () => {
    const registry = new AccessibleRootRegistry();
    registry.reconcile(document);
    const topRoot = registry.get(TOP_ROOT_KEY)!;
    for (let generation = 12; generation < 62; generation += 1) {
      mountQuestion(document.body, questionHtml(String(generation), "diagram-a"));
      const [block] = detectCandidatesInRoot(topRoot.root, topRoot);
      const controller = new AbortController();
      beginQuestionRevisionAttempt(block!, controller);
      clearQuestionRevisionAttempt(controller);
      controller.abort();
    }
    expect(document.querySelectorAll(".question-item")).toHaveLength(1);
    const current = detectCandidatesAcrossRoots().filter((block) => Number(block.identity?.nativeQuestionId) >= 12);
    expect(current).toHaveLength(1);
    expect(Number(current[0]!.identity!.nativeQuestionId)).toBe(61);
  });
});

describe("Phase 7 root watcher lifecycle", () => {
  const originalElementsFromPoint = document.elementsFromPoint;
  beforeEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    document.elementsFromPoint = (() => []) as typeof document.elementsFromPoint;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    document.elementsFromPoint = originalElementsFromPoint;
  });

  it("ROOT-LIFE-1 registers an inserted iframe root and cleans up on removal", async () => {
    const stop = startQuestionRevisionWatch({
      detectCandidates: () => [],
      onCandidates: () => {},
      detectRootCandidates: detectCandidatesInRoot,
    });
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = questionHtml("12", "diagram-a");
    // Two settle rounds: the insert mutation registers the root on flush #1,
    // the frame observer attaches on flush #1, and a follow-up mutation
    // guarantees a second reconciliation has completed before we assert.
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(sharedRootRegistry().list().some((root) => root.kind === "same-origin-frame")).toBe(true), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    iframe.remove();
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(sharedRootRegistry().list().some((root) => root.kind === "same-origin-frame")).toBe(false), { timeout: 10_000 });
    stop();
  });

  it("ROOT-LIFE-2 discovers a dynamically inserted open-shadow host and cleans up", async () => {
    const stop = startQuestionRevisionWatch({
      detectCandidates: () => [],
      onCandidates: () => {},
      detectRootCandidates: detectCandidatesInRoot,
    });
    const host = document.createElement("my-dynamic-host");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = questionHtml("12", "diagram-a");
    stubRect(host, { left: 0, top: 0, width: 640, height: 300 });
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(sharedRootRegistry().list().some((root) => root.shadowHost === host)).toBe(true), { timeout: 10_000 });

    host.remove();
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(sharedRootRegistry().list().some((root) => root.shadowHost === host)).toBe(false), { timeout: 10_000 });
    stop();
  });

  it("ROOT-LIFE-3 keeps exactly one lifecycle owner when started twice", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = startQuestionRevisionWatch({ detectCandidates: () => [], onCandidates: first });
    stopFirst();
    const stopSecond = startQuestionRevisionWatch({ detectCandidates: () => [], onCandidates: second });
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(second).toHaveBeenCalled(), { timeout: 10_000 });
    expect(first).not.toHaveBeenCalled();
    stopSecond();
  });

  it("ROOT-LIFE-4 stops every root observer, frame listener and the queue", async () => {
    const stop = startQuestionRevisionWatch({
      detectCandidates: () => [],
      onCandidates: () => {},
      detectRootCandidates: detectCandidatesInRoot,
    });
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = questionHtml("12", "diagram-a");
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(sharedRootRegistry().list().some((root) => root.kind === "same-origin-frame")).toBe(true), { timeout: 10_000 });
    stop();
    expect(sharedRootRegistry().list()).toHaveLength(0);

    // After stop, neither the top document nor the frame produces callbacks
    // and the registry stays pruned.
    iframe.contentDocument!.body.append(document.createElement("div"));
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sharedRootRegistry().list()).toHaveLength(0);
  });

  it("ROOT-PERF-1 coalesces a 100-record burst inside a frame into one reconciliation", async () => {
    const onCandidates = vi.fn();
    const stop = startQuestionRevisionWatch({
      detectCandidates: () => [],
      onCandidates,
      detectRootCandidates: detectCandidatesInRoot,
    });
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = questionHtml("12", "diagram-a");
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(sharedRootRegistry().list().some((root) => root.kind === "same-origin-frame")).toBe(true), { timeout: 10_000 });
    // Let one flush cycle attach the frame's MutationObserver before bursting.
    await new Promise((resolve) => setTimeout(resolve, 150));

    for (let index = 0; index < 100; index += 1) {
      iframe.contentDocument!.body.append(document.createElement("span"));
    }
    await vi.waitFor(
      () => expect(onCandidates.mock.calls.some(([, rootKey]) => rootKey !== undefined && rootKey !== TOP_ROOT_KEY)).toBe(true),
      { timeout: 10_000 },
    );
    const frameCalls = onCandidates.mock.calls.filter(([, rootKey]) => rootKey !== undefined && rootKey !== TOP_ROOT_KEY).length;
    expect(frameCalls).toBe(1);
    stop();
  });

  it("ROOT-PERF-2 does not rescan unrelated roots when one shadow root mutates", async () => {
    const detectRootCandidates = vi.fn((_root: Document | ShadowRoot, _context: { rootKey: string }) => []);
    const stop = startQuestionRevisionWatch({
      detectCandidates: () => [],
      onCandidates: () => {},
      detectRootCandidates,
    });
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = questionHtml("12", "diagram-a");
    const host = document.createElement("my-perf-host");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = questionHtml("13", "diagram-a");
    stubRect(host, { left: 0, top: 0, width: 640, height: 300 });
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(sharedRootRegistry().list().filter((root) => root.kind !== "top-document")).toHaveLength(2), { timeout: 10_000 });
    const frameRoot = sharedRootRegistry().list().find((root) => root.kind === "same-origin-frame")!;

    detectRootCandidates.mockClear();
    shadow.append(document.createElement("div"));
    await vi.waitFor(() => expect(detectRootCandidates).toHaveBeenCalled(), { timeout: 10_000 });
    const scannedKeys = detectRootCandidates.mock.calls.map((call) => call[0] as unknown);
    expect(scannedKeys).toHaveLength(1);
    expect(scannedKeys[0]).toBe(shadow);
    expect(scannedKeys[0]).not.toBe(frameRoot.root);
    stop();
  });

  it("ROOT-RACE-1 never writes a removed root's answer into an identical question in another root", async () => {
    const registry = sharedRootRegistry();
    const iframeA = document.createElement("iframe");
    const iframeB = document.createElement("iframe");
    document.body.append(iframeA, iframeB);
    const docA = iframeA.contentDocument!;
    const docB = iframeB.contentDocument!;
    for (const iframe of [iframeA, iframeB]) {
      stubRect(iframe, { left: 0, top: 0, width: 800, height: 600 });
      Object.defineProperty(iframe, "clientWidth", { configurable: true, value: 800 });
      Object.defineProperty(iframe, "clientHeight", { configurable: true, value: 600 });
      Object.defineProperty(iframe, "offsetWidth", { configurable: true, value: 800 });
      Object.defineProperty(iframe, "offsetHeight", { configurable: true, value: 600 });
    }
    mountQuestion(docA.body, questionHtml("12", "diagram-a"));
    mountQuestion(docB.body, questionHtml("12", "diagram-a"));
    registry.reconcile(document);
    const rootA = registry.list().find((root) => root.kind === "same-origin-frame" && root.root === docA)!;
    const rootB = registry.list().find((root) => root.kind === "same-origin-frame" && root.root === docB)!;
    const [q12a] = detectCandidatesInRoot(rootA.root, rootA);
    const [q12b] = detectCandidatesInRoot(rootB.root, rootB);
    expect(q12a!.identity!.stableId).toBe(q12b!.identity!.stableId);
    expect(rootAttachmentOf(q12a!).rootKey).not.toBe(rootAttachmentOf(q12b!).rootKey);

    // Pending attempt on root A; then A is removed entirely. The watcher's
    // lifecycle hook (abortQuestionRevisionAttemptForRoot) invalidates it.
    const controller = new AbortController();
    beginQuestionRevisionAttempt(q12a!, controller);
    iframeA.remove();
    registry.reconcile(document);
    expect(abortQuestionRevisionAttemptForRoot(rootA.rootKey)).toBe(true);

    // The late Q12(A) result is attempted against the identical Q12(B).
    captureSolveStartControlState(q12b!);
    const outcome = await fillParsedAnswerInPage(q12b!, parseResult("B"), { mode: "auto" });
    console.log("RACE outcome", JSON.stringify(outcome));
    expect(controller.signal.aborted).toBe(true);
    expect(outcome.message).toBe("STALE_QUESTION_REVISION");
    expect(docB.querySelector('[aria-checked="true"]')).toBeNull();
    iframeB.remove();
  });

  it("SHADOW-SLOT-1 owns slotted light content with the shadow component, exactly once", () => {
    const registry = new AccessibleRootRegistry();
    registry.reconcile(document);
    const topRoot = registry.get(TOP_ROOT_KEY)!;
    const host = document.createElement("my-slot-host");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<div class="question-item" data-question-id="12"><p class="stem">12. Composed question A. 1 B. 2 C. 3 D. 4</p><slot></slot></div>';
    stubRect(host, { left: 0, top: 0, width: 640, height: 320 });
    stubRect(shadow.querySelector(".question-item")!, { left: 8, top: 8, width: 620, height: 300 });
    // Light DOM slotted into the host completes the question (the options).
    const slotted = document.createElement("ul");
    slotted.innerHTML = '<li><button class="option">A. 1</button></li><li><button class="option">B. 2</button></li><li><button class="option">C. 3</button></li><li><button class="option">D. 4</button></li>';
    host.append(slotted);
    stubRect(slotted, { left: 8, top: 200, width: 600, height: 100 });

    registry.reconcile(document, new Set([TOP_ROOT_KEY]));
    const shadowContexts = registry.list().filter((root) => root.kind === "open-shadow-root");
    expect(shadowContexts).toHaveLength(1);
    const blocks = detectCandidatesInRoot(shadowContexts[0]!.root, shadowContexts[0]!);
    expect(blocks.filter((block) => block.identity?.nativeQuestionId === "12")).toHaveLength(1);
    // The slotted light content must not ALSO surface as a top candidate.
    expect(detectCandidatesInRoot(topRoot.root, topRoot).filter((block) => block.id.startsWith("auto-"))).toHaveLength(0);
  });
});

describe("Phase 7 production integration", () => {
  const originalElementsFromPoint = document.elementsFromPoint;
  beforeEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    document.elementsFromPoint = (() => []) as typeof document.elementsFromPoint;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    document.elementsFromPoint = originalElementsFromPoint;
  });

  it("runAutoSolveAll over a same-origin iframe question: root replacement invalidates the pending provider and the late result mutates nothing", async () => {
    sharedRootRegistry().reconcile(document);
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    stubRect(iframe, { left: 0, top: 0, width: 800, height: 600 });
    Object.defineProperty(iframe, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(iframe, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(iframe, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(iframe, "offsetHeight", { configurable: true, value: 600 });
    const doc = iframe.contentDocument!;
    mountQuestion(doc.body, questionHtml("12", "diagram-a"));
    const stop = startQuestionRevisionWatch({
      detectCandidates: () => [],
      onCandidates: () => {},
      detectRootCandidates: detectCandidatesInRoot,
    });
    let clicks = 0;
    let running = false;
    let stopped = false;
    const provider = new AbortController();
    const pending = deferred<ParseResult>();
    try {
      const frameRoot = sharedRootRegistry().list().find((root) => root.kind === "same-origin-frame")!;
      const detected = detectCandidatesInRoot(frameRoot.root, frameRoot);
      const block = detected[0]!;
      doc.getElementById("opt-b")!.addEventListener("click", () => { clicks += 1; });

      const controller = { isRunning: () => running, setRunning: (v: boolean) => { running = v; }, isStopRequested: () => stopped, requestStop: (v: boolean) => { stopped = v; } };
      const orchestrationDeps = {
        activeCandidates: [], activeDetectMode: null, clickNextQuestionButton: () => false,
        detectCandidatesFullPage: async () => [], detectCandidatesInViewport: () => [], detectTotalQuestionCount: () => 1,
        extractAutoSolveQuestionOrder: () => 12, extractQuestionImageUrlFromBBox: () => null, extractRichQuestionPreviewFromElement: () => "",
        extractTextFromBBox: () => "", fillParsedAnswerInPage: (value: QuestionBlock, result: ParseResult, options?: { mode?: "auto" | "manual" }) => fillParsedAnswerInPage(value, result, options),
        findBestDetectedCandidateForBBox: () => null, findMatchingFullPageCandidate: () => null, findNextQuestionButton: () => document.createElement("button"),
        findReusableHistoryEntry: () => null, getAutoSolveFingerprint: () => "q", getAutoSolveTextFingerprint: () => "q", getScrollLeft: () => 0,
        hasVisibleAutoSolveMedia: () => false, inferAutoSolveQuestionType: () => "single_choice" as const,
        inspectAutoSolveAnswerState: () => ({ mode: "none" as const, answeredCount: 0, totalCount: 0, complete: false }), isChoiceLikeQuestionType: () => true,
        isExtensionUiElement: () => false, loadHistory: async () => [],
        parseBlockForAutoSolve: (value: QuestionBlock) => {
          beginQuestionRevisionAttempt(value, provider);
          captureSolveStartControlState(value);
          return pending.promise;
        },
        parseBlockForAutoSolveQuickReview: async () => parseResult("B"), parseBlockForAutoSolveReview: async () => parseResult("B"),
        pauseMs: async () => {}, pickBestAutoSolvePreviewText: () => "", pickLiveAutoSolveBlock: () => block!,
        projectViewportBboxToAbsolute: (value: QuestionBlock["bbox"]) => value, recordAutoSolveHistory: async () => {}, normalizeQuestionText: (v: string) => v,
        refineFullPageCandidatesViaManualPipeline: async () => [], refineViewportCandidate: async (v: QuestionBlock) => v, reportLocationHostname: () => "example.com",
        resolveQuestionAdvance: async () => false,
        resolveQuestionBlockFromBBox: (value: QuestionBlock["bbox"]) => ({ refinedBBox: value, finalBBox: value, previewText: "", matchedCandidate: null }),
        resolveScrollRoot: () => document.documentElement, sendAutoSolveDone: vi.fn(), sendAutoSolveProgress: vi.fn(), setScrollPosition: () => {},
        shouldPersistAutoSolveParseResult: () => true, shouldPreferViewportPreview: () => false, shouldRetryUnstableChoiceParse: () => false,
        shouldReviewLowConfidenceHistory: () => false, shouldStopAutoSolveAtTail: () => true, sortAutoSolveCandidates: (v: QuestionBlock[]) => v,
        verifyParsedAnswerInPage: () => ({ ok: true, message: "verified" }),
      };
      const workflow = runAutoSolveAll(controller, orchestrationDeps as never);
      await vi.waitFor(() => expect(hasAutoSolveQuestionAttempt(block!)).toBe(true), { timeout: 5000 });

      // The iframe document is replaced while the provider is pending.
      const replacement = document.implementation.createHTMLDocument("reloaded");
      Object.defineProperty(replacement, "defaultView", { configurable: true, value: iframe.contentWindow });
      Object.defineProperty(iframe, "contentDocument", { configurable: true, value: replacement });
      document.body.append(document.createElement("div"));
      await vi.waitFor(() => expect(provider.signal.aborted).toBe(true), { timeout: 5000 });

      // The provider ignores the abort and resolves late.
      pending.resolve(parseResult("B"));
      await workflow;
      expect(clicks).toBe(0);
    } finally {
      clearQuestionRevisionAttempt();
      stop();
    }
  });
});
