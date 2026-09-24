import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { handleContentMessage } from "./contentMessageRouter";
import { detectZhihuishuCurrentQuestionBlock } from "./autoSolveBlockSelection";
import { buildOrderedPlanFromDomQuestionCards, mergeOrderedPlanWithDetectedCandidates } from "./fullPagePlan";
import { bindDomQuestionBlockToOwner } from "./domQuestionBinding";
import { captureSolveStartControlState, fillParsedAnswerInPage, finishAutoSolveQuestionAttempt, hasAutoSolveQuestionAttempt } from "./answerFiller";
import { detectCandidatesInRoot } from "./detector/domDetector";
import { extractStructuredQuestionText } from "./detector/domStructuredText";
import { sanitizeQuestionBlockForRuntimeMessage } from "@/shared/utils/mediaSerialization";
import { ownerOf, rootAttachmentOf, TOP_ROOT_KEY, topRootContext, invalidateRuntimeQuestionHandlesForRoot } from "./roots/rootContext";
import { refreshRuntimeQuestionBlock, resolveFillRootContext, sharedRootRegistry } from "./roots/rootRegistry";
import { createOrderedPlanState, ensureOrderedPlan, resolveOrderedPlanViewportBlock } from "./autoSolveOrderedPlan";

const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
const originalElementsFromPoint = document.elementsFromPoint;

function setRect(el: Element, left: number, top: number, width: number, height: number): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left, top, width, height, right: left + width, bottom: top + height,
      x: left, y: top, toJSON: () => ({ left, top, width, height }),
    }),
  });
}

function mountQuestion(id: string, options: { className?: string; top?: number; number?: number; prompt?: string } = {}): HTMLElement {
  const owner = document.createElement("section");
  owner.className = options.className ?? "question-item";
  owner.id = id;
  owner.dataset.questionId = id;
  const number = options.number ?? 12;
  const prompt = options.prompt ?? "Which value equals 2 + 2? Choose one.";
  owner.innerHTML = `<p class="stem">${number}. ${prompt}</p>`
    + '<button class="option" aria-checked="false">A. 3</button>'
    + '<button class="option" aria-checked="false">B. 4</button>'
    + '<button class="option" aria-checked="false">C. 5</button>'
    + '<button class="option" aria-checked="false">D. 6</button>';
  document.body.append(owner);
  const top = options.top ?? 80;
  setRect(owner, 24, top, 640, 240);
  owner.querySelectorAll<HTMLButtonElement>("button.option").forEach((button, index) => {
    setRect(button, 40, top + 60 + index * 36, 360, 28);
    button.addEventListener("click", () => {
      owner.querySelectorAll("button.option").forEach((candidate) => {
        candidate.setAttribute("aria-checked", String(candidate === button));
      });
    });
  });
  return owner;
}

function questionOrder(text: string): number | null {
  const match = text.match(/^\s*(\d{1,4})\s*[.、)]/);
  return match ? Number(match[1]) : null;
}

function zhihuishuDeps(matchedCandidate: QuestionBlock | null = null) {
  return {
    isExtensionUiElement: () => false,
    isElementVisible: (el: HTMLElement) => el.isConnected,
    extractRichQuestionPreviewFromElement: (el: Element) => extractStructuredQuestionText(el) || el.textContent || "",
    resolveQuestionBlockFromBBox: (bbox: QuestionBlock["bbox"]) => ({
      refinedBBox: bbox,
      finalBBox: bbox,
      previewText: "",
      matchedCandidate,
    }),
    inferAutoSolveQuestionType: () => "single_choice" as const,
    extractQuestionImageUrlFromBBox: () => null,
    hasVisibleAutoSolveMedia: () => false,
    extractAutoSolveQuestionOrder: questionOrder,
  };
}

function orderedPlanDeps() {
  return {
    projectViewportBboxToAbsolute: (bbox: QuestionBlock["bbox"], scrollRoot: Window | HTMLElement) => ({
      ...bbox,
      y: bbox.y + (scrollRoot === window ? window.scrollY : (scrollRoot as HTMLElement).scrollTop),
    }),
    extractRichQuestionPreviewFromElement: (el: Element) => extractStructuredQuestionText(el) || el.textContent || "",
    extractQuestionImageUrlFromBBox: () => null,
    inferAutoSolveQuestionType: () => "single_choice" as const,
    hasVisibleAutoSolveMedia: () => false,
    isExtensionUiElement: () => false,
    normalizeQuestionText: (text: string) => text.trim(),
    extractAutoSolveQuestionOrder: questionOrder,
    sortAutoSolveCandidates: (blocks: QuestionBlock[]) => blocks,
  };
}

function parseResult(block: QuestionBlock, answer = "B"): ParseResult {
  return {
    blockId: block.id,
    questionType: "single_choice",
    answer,
    confidence: 0.99,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: "",
    routeUsed: "text",
  };
}

function assertBoundTo(block: QuestionBlock, owner: Element): void {
  expect(block.identity?.stableId).toBeTruthy();
  expect(block.identity?.contentFingerprint).toMatch(/^cf_v1_/);
  expect(block.runtimeQuestionHandle).toMatch(/^rqh_[0-9a-f]{32}$/);
  expect(ownerOf(block)).toBe(owner);
  expect(rootAttachmentOf(block)).toMatchObject({ rootKey: TOP_ROOT_KEY, rootGeneration: 0 });
  const resolved = resolveFillRootContext(sharedRootRegistry(), block);
  expect(resolved.ok).toBe(true);
  if (resolved.ok) expect(resolved.owner).toBe(owner);
}

function orderedPlanRuntimeDeps(domPlan: QuestionBlock[]) {
  const scrollRoot = document.scrollingElement as HTMLElement;
  const setScrollPosition = (root: Window | HTMLElement, top: number, left: number) => {
    if (root !== window) {
      (root as HTMLElement).scrollTop = top;
      (root as HTMLElement).scrollLeft = left;
    }
  };
  return {
    activeDetectMode: "fullpage" as const,
    detectCandidatesFullPage: async () => [] as QuestionBlock[],
    detectRootCandidates: () => [] as QuestionBlock[],
    detectTotalQuestionCount: () => 1,
    extractAutoSolveQuestionOrder: questionOrder,
    getActiveCandidates: () => domPlan,
    getScrollLeft: (root: Window | HTMLElement) => root === window ? window.scrollX : (root as HTMLElement).scrollLeft,
    projectViewportBboxToAbsolute: orderedPlanDeps().projectViewportBboxToAbsolute,
    refreshRuntimeQuestionBlock,
    mergeOrderedPlanWithDetectedCandidates: (plan: QuestionBlock[], detected: QuestionBlock[]) =>
      mergeOrderedPlanWithDetectedCandidates(plan, detected, {
        sortAutoSolveCandidates: (blocks) => blocks,
        findMatchingFullPageCandidate: () => null,
        findBestDetectedCandidateForBBox: () => null,
        extractAutoSolveQuestionOrder: questionOrder,
        pickBestAutoSolvePreviewText: (raw) => raw,
      }),
    pauseMs: async () => undefined,
    refineFullPageCandidatesViaManualPipeline: async () => [] as QuestionBlock[],
    refineViewportCandidate: () => { throw new Error("runtime-bound plan must refresh its exact owner"); },
    scrollRoot,
    sequentialScrollMode: true,
    setScrollPosition,
    sortAutoSolveCandidates: (blocks: QuestionBlock[]) => blocks,
    buildOrderedPlanFromDomQuestionCards: () => buildOrderedPlanFromDomQuestionCards(scrollRoot, orderedPlanDeps()),
  };
}

describe("mutation-capable auto_dom runtime binding", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://hiexam.zhihuishu.com/atHomeworkExam/stu/homeworkQ/exerciseList/1"),
    });
    document.elementsFromPoint = (() => []) as typeof document.elementsFromPoint;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    invalidateRuntimeQuestionHandlesForRoot(TOP_ROOT_KEY);
    sharedRootRegistry().reset();
    document.elementsFromPoint = originalElementsFromPoint;
    if (originalLocation) Object.defineProperty(window, "location", originalLocation);
  });

  it("AUTO-DOM-INVARIANT-1 binds every enumerated production auto_dom factory to its exact owner", () => {
    const detectedOwner = mountQuestion("detected-card", { className: "question-item", top: 60 });
    const image = document.createElement("img");
    image.src = "https://assets.example.test/question-figure.png";
    image.alt = "question figure";
    detectedOwner.prepend(image);
    const liveOwner = mountQuestion("live-card", { className: "questionBox", top: 340 });
    const planOwner = mountQuestion("plan-card", { className: "question-item", top: 620 });
    const context = topRootContext(document);

    const detectedBlocks = detectCandidatesInRoot(document, context);
    const detected = detectedBlocks.find((block) => ownerOf(block) === detectedOwner);
    const live = detectZhihuishuCurrentQuestionBlock(zhihuishuDeps());
    const plan = buildOrderedPlanFromDomQuestionCards(document.scrollingElement as HTMLElement, orderedPlanDeps())
      .find((block) => ownerOf(block) === planOwner);

    expect(detected).toBeTruthy();
    expect(live).toBeTruthy();
    expect(plan).toBeTruthy();
    expect(detectedBlocks.length).toBeGreaterThan(0);
    for (const candidate of detectedBlocks) {
      const exactOwner = ownerOf(candidate);
      expect(exactOwner).toBeTruthy();
      assertBoundTo(candidate, exactOwner!);
    }
    assertBoundTo(detected!, detectedOwner);
    assertBoundTo(live!, liveOwner);
    assertBoundTo(plan!, planOwner);
    expect(detected!.mediaAssets?.length).toBeGreaterThan(0);
    expect(detected!.identity?.signals.media).toBe(true);
  });

  it("LEGACY-AUTODOM-ZHIHUI-1 binds the live block and fills only its exact owner", async () => {
    const owner = mountQuestion("zhihuishu-live", { className: "questionBox" });
    const block = detectZhihuishuCurrentQuestionBlock(zhihuishuDeps());
    expect(block).toBeTruthy();
    assertBoundTo(block!, owner);

    captureSolveStartControlState(block!);
    expect(hasAutoSolveQuestionAttempt(block!)).toBe(true);
    const result = await fillParsedAnswerInPage(block!, parseResult(block!), { mode: "auto" });
    expect(result).toMatchObject({ ok: true, filledCount: 1 });
    expect(owner.querySelector('[aria-checked="true"]')?.textContent).toContain("B. 4");
    finishAutoSolveQuestionAttempt(block!);
  });

  it("LEGACY-AUTODOM-ZHIHUI-2 fails closed after the live owner is replaced", async () => {
    const owner = mountQuestion("zhihuishu-old", { className: "questionBox" });
    const block = detectZhihuishuCurrentQuestionBlock(zhihuishuDeps());
    expect(block).toBeTruthy();
    owner.remove();
    const replacement = mountQuestion("zhihuishu-new", { className: "questionBox" });

    const result = await fillParsedAnswerInPage(block!, parseResult(block!), { mode: "auto" });
    expect(result).toMatchObject({ ok: false, filledCount: 0, message: "STALE_RUNTIME_QUESTION_HANDLE" });
    expect(replacement.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it("LEGACY-AUTODOM-PLAN-1 scrolls, refreshes, and fills an unmatched DOM-plan owner", async () => {
    const target = mountQuestion("plan-target", { top: 100 });
    mountQuestion("plan-bystander", { top: 520, number: 13, prompt: "Which value equals 3 + 3? Choose one." });
    const domPlan = buildOrderedPlanFromDomQuestionCards(document.scrollingElement as HTMLElement, orderedPlanDeps());
    expect(domPlan).toHaveLength(2);
    const targetDraft = domPlan.find((block) => ownerOf(block) === target)!;
    assertBoundTo(targetDraft, target);
    expect(mergeOrderedPlanWithDetectedCandidates(domPlan, [], {
      sortAutoSolveCandidates: (blocks) => blocks,
      findMatchingFullPageCandidate: () => null,
      findBestDetectedCandidateForBBox: () => null,
      extractAutoSolveQuestionOrder: questionOrder,
      pickBestAutoSolvePreviewText: (raw) => raw,
    })).toEqual(domPlan);

    const state = createOrderedPlanState();
    const deps = orderedPlanRuntimeDeps(domPlan);
    const plan = await ensureOrderedPlan(state, deps);
    expect(plan[0]?.coordinateSpace).toBe("SCROLL_ROOT_ABSOLUTE");
    const current = await resolveOrderedPlanViewportBlock(state, deps);
    expect(current?.runtimeQuestionHandle).toBe(targetDraft.runtimeQuestionHandle);
    assertBoundTo(current!, target);

    captureSolveStartControlState(current!);
    const result = await fillParsedAnswerInPage(current!, parseResult(current!), { mode: "auto" });
    expect(result).toMatchObject({ ok: true, filledCount: 1 });
    expect(target.querySelector('[aria-checked="true"]')?.textContent).toContain("B. 4");
    finishAutoSolveQuestionAttempt(current!);
  });

  it("LEGACY-AUTODOM-PLAN-2 never fills a similar sibling for an unmatched DOM target", async () => {
    const sibling = mountQuestion("plan-sibling", { top: 80, prompt: "Which value equals 2 + 2? Choose one." });
    const target = mountQuestion("plan-second", { top: 360, prompt: "Which value equals 2 + 2? Choose one." });
    const domPlan = buildOrderedPlanFromDomQuestionCards(document.scrollingElement as HTMLElement, orderedPlanDeps());
    const unmatched = mergeOrderedPlanWithDetectedCandidates(domPlan, [], {
      sortAutoSolveCandidates: (blocks) => blocks,
      findMatchingFullPageCandidate: () => null,
      findBestDetectedCandidateForBBox: () => null,
      extractAutoSolveQuestionOrder: questionOrder,
      pickBestAutoSolvePreviewText: (raw) => raw,
    });
    const targetBlock = unmatched.find((block) => ownerOf(block) === target)!;
    expect(targetBlock.runtimeQuestionHandle).toBeTruthy();
    captureSolveStartControlState(targetBlock);
    const result = await fillParsedAnswerInPage(targetBlock, parseResult(targetBlock), { mode: "auto" });

    expect(result.ok).toBe(true);
    expect(sibling.querySelector('[aria-checked="true"]')).toBeNull();
    expect(target.querySelector('[aria-checked="true"]')?.textContent).toContain("B. 4");
    finishAutoSolveQuestionAttempt(targetBlock);
  });

  it("LEGACY-AUTODOM-PLAN-3 rejects semantic owner changes before any fill", async () => {
    const target = mountQuestion("plan-stale", { top: 120 });
    const block = buildOrderedPlanFromDomQuestionCards(document.scrollingElement as HTMLElement, orderedPlanDeps())[0]!;
    captureSolveStartControlState(block);
    target.querySelector(".stem")!.textContent = "12. A different question has replaced the planned question.";

    const result = await fillParsedAnswerInPage(block, parseResult(block), { mode: "auto" });
    expect(result).toMatchObject({ ok: false, filledCount: 0, message: "STALE_ACTION_PLAN" });
    expect(target.querySelector('[aria-checked="true"]')).toBeNull();
    finishAutoSolveQuestionAttempt(block);
  });

  it("AUTO-DOM-MESSAGE-DOWNGRADE-1 rejects a missing handle after a real detected-block round trip", async () => {
    const owner = mountQuestion("message-downgrade", { className: "question-item" });
    const detected = detectCandidatesInRoot(document, topRootContext(document))
      .find((block) => ownerOf(block) === owner)!;
    expect(detected.runtimeQuestionHandle).toMatch(/^rqh_[0-9a-f]{32}$/);
    const messageBlock = JSON.parse(JSON.stringify(sanitizeQuestionBlockForRuntimeMessage(detected))) as QuestionBlock;
    expect(messageBlock.runtimeQuestionHandle).toBe(detected.runtimeQuestionHandle);
    delete messageBlock.runtimeQuestionHandle;

    let response!: unknown;
    let resolveResponse!: () => void;
    const responseReceived = new Promise<void>((resolve) => { resolveResponse = resolve; });
    const accepted = handleContentMessage({
      type: "FILL_PARSED_ANSWER",
      block: messageBlock,
      result: parseResult(messageBlock),
    }, (value) => { response = value; resolveResponse(); }, {
      cancelFullPageScan: () => undefined,
      cancelManualCapture: () => undefined,
      captureBlockImage: async () => null,
      clearHighlights: () => undefined,
      closeFloatingResult: () => undefined,
      fillParsedAnswerInPage,
      flashCandidate: () => undefined,
      handleAutoDetect: () => undefined,
      handleFullPageDetect: () => undefined,
      startAutoSolveAll: () => undefined,
      startManualCapture: () => undefined,
      stopAutoSolveAll: () => undefined,
      updateCandidateSelection: () => undefined,
      validateQuestionResultAuthority: () => true,
      verifyParsedAnswerInPage: () => ({ ok: false }),
    });
    await responseReceived;

    expect(accepted).toBe(true);
    expect(response).toMatchObject({ ok: false, filledCount: 0, message: "STALE_RUNTIME_QUESTION_HANDLE" });
    expect(owner.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it("reuses the identity and handle only when a matched candidate has the same owner and semantics", () => {
    const owner = mountQuestion("matched-live", { className: "question-item" });
    const original = detectCandidatesInRoot(document, topRootContext(document))
      .find((block) => ownerOf(block) === owner)!;
    const draft: QuestionBlock = {
      ...original,
      bbox: { ...original.bbox, y: original.bbox.y + 8 },
      previewText: original.previewText,
      confidence: 0.99,
    };
    const rebound = bindDomQuestionBlockToOwner(draft, owner, {
      identityText: original.identitySourceText ?? original.previewText,
      matchedCandidate: original,
    });

    expect(rebound.identity).toBe(original.identity);
    expect(rebound.runtimeQuestionHandle).toBe(original.runtimeQuestionHandle);
    expect(ownerOf(rebound)).toBe(owner);
    expect(rebound.bbox.y).toBe(original.bbox.y + 8);
  });
});
