import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ParseResult, QuestionBlock, QuestionType } from "@/shared/types";
import { detectCandidatesInRoot, detectCandidatesAcrossRoots } from "./detector/domDetector";
import type { AccessibleRootRegistry } from "./roots/rootRegistry";
import { sharedRootRegistry } from "./roots/rootRegistry";
import { attachRuntimeRoot, rootAttachmentOf, TOP_ROOT_KEY, type RootContext } from "./roots/rootContext";
import { beginQuestionRevisionAttempt, clearQuestionRevisionAttempt } from "./revision/questionRevisionRuntime";
import { startQuestionRevisionWatch } from "./revision/questionRevisionWatch";
import { captureSolveStartControlState, fillParsedAnswerInPage } from "./answerFiller";
import { finishAutoSolveQuestionAttempt, hasAutoSolveQuestionAttempt, verifyParsedAnswerInPage } from "./answerFiller";
import { attachQuestionIdentity } from "./questionIdentity";
import { discoverControls } from "./answer/controlDiscovery";
import { buildControlMapping } from "./answer/controlMapping";
import { extractStructuredQuestionText } from "./detector/domStructuredText";
import { requestRealClick } from "./answerDomUtils";
import { sanitizeQuestionBlockForRuntimeMessage, sanitizeQuestionBlockForSerialization } from "@/shared/utils/mediaSerialization";
import { sendAutoSolveProgress } from "./contentRuntime";

function stubRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }),
  });
}

const QUESTION_HTML = '<div class="question-item" data-question-id="12"><p class="stem">12. Which value equals 2 + 2? Choose one.</p><img src="http://img.test/diagram-a.png" alt="figure"><ul><li><button class="option">A. 3</button></li><li><button class="option" id="opt-b">B. 4</button></li><li><button class="option">C. 5</button></li><li><button class="option">D. 6</button></li></ul></div>';

function parseResult(answer = "B"): ParseResult {
  return { blockId: "any", questionType: "single_choice", answer, confidence: 0.99, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
}

/** Reflects choice state like a real ARIA pattern so transactional fills can verify. */
function armAriaReflection(scope: ParentNode) {
  scope.querySelectorAll(".option").forEach((button) => {
    button.addEventListener("click", () => {
      scope.querySelectorAll(".option").forEach((other) => other.setAttribute("aria-checked", String(other === button)));
    });
  });
}

function makeFrame(parentDoc?: Document): { iframe: HTMLIFrameElement; doc: Document } {
  void parentDoc;
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  // The frame element occupies the top viewport at the origin; with no
  // border/scale the top coordinates equal the local coordinates.
  stubRect(iframe, { left: 0, top: 0, width: 800, height: 600 });
  Object.defineProperty(iframe, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(iframe, "clientHeight", { configurable: true, value: 600 });
  Object.defineProperty(iframe, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(iframe, "offsetHeight", { configurable: true, value: 600 });
  return { iframe, doc };
}

function mountQuestion(rootNode: HTMLElement, html = QUESTION_HTML): Element {
  rootNode.innerHTML = html;
  const container = rootNode.querySelector(".question-item")!;
  stubRect(container, { left: 8, top: 8, width: 640, height: 220 });
  armAriaReflection(container);
  return container;
}

function makeShadowHost(id: string, top: number, html = QUESTION_HTML): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement(`my-host-${id}`);
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = html;
  stubRect(host, { left: 0, top, width: 640, height: 260 });
  const container = shadow.querySelector(".question-item")!;
  stubRect(container, { left: 8, top: top + 8, width: 620, height: 220 });
  armAriaReflection(container);
  return { host, shadow };
}

let nativeTestIndex = 0;
function attachTestRuntimeBlock(owner: Element, root: RootContext, questionTypeGuess: QuestionType, previewText: string): QuestionBlock {
  const block = attachQuestionIdentity({
    id: `native-${++nativeTestIndex}`,
    bbox: { x: 8, y: 8, width: 640, height: 220 },
    previewText,
    identityObservationSource: "structured",
    hasImage: false,
    questionTypeGuess,
    confidence: 1,
    source: "auto_dom",
  }, owner, { identityText: previewText });
  return attachRuntimeRoot(block, { rootKey: root.rootKey, rootGeneration: root.rootGeneration, kind: root.kind }, owner);
}

function registryWithTop(): AccessibleRootRegistry {
  const registry = sharedRootRegistry();
  registry.reconcile(document, new Set([TOP_ROOT_KEY]));
  return registry;
}

describe("Phase 7 accessible roots", () => {
  const originalElementsFromPoint = document.elementsFromPoint;
  beforeEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    // happy-dom does not implement elementsFromPoint; scope resolution only
    // relies on it as a fallback, which these tests stub deterministically.
    document.elementsFromPoint = (() => []) as typeof document.elementsFromPoint;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
    document.elementsFromPoint = originalElementsFromPoint;
  });

  it("FRAME-1 detects an iframe-only question once, under the frame root key", () => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    mountQuestion(doc.body);
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;

    const blocks = detectCandidatesInRoot(frameRoot.root, frameRoot);
    expect(blocks).toHaveLength(1);
    expect(rootAttachmentOf(blocks[0]!).rootKey).toBe(frameRoot.rootKey);
    expect(rootAttachmentOf(blocks[0]!).rootKey).not.toBe(TOP_ROOT_KEY);

    // The frame question never appears in the top root's candidate list.
    const topBlocks = detectCandidatesInRoot(document, registry.get(TOP_ROOT_KEY)!);
    expect(topBlocks).toHaveLength(0);
    expect(detectCandidatesAcrossRoots().filter((block) => block.identity?.nativeQuestionId === "12")).toHaveLength(1);
  });

  it("FRAME-2 detects a nested same-origin frame question exactly once", () => {
    const registry = sharedRootRegistry();
    const { doc: outerDoc } = makeFrame();
    const { doc: innerDoc } = makeFrame(outerDoc);
    mountQuestion(innerDoc.body);
    registry.reconcile(document);
    expect(registry.list().filter((root) => root.kind === "same-origin-frame")).toHaveLength(2);

    const innerRoot = registry.list().find((root) => root.kind === "same-origin-frame" && root.root === innerDoc)!;
    const blocks = detectCandidatesInRoot(innerRoot.root, innerRoot);
    expect(blocks).toHaveLength(1);
    expect(rootAttachmentOf(blocks[0]!).rootKey).toBe(innerRoot.rootKey);
    expect(detectCandidatesAcrossRoots().filter((block) => block.identity?.nativeQuestionId === "12")).toHaveLength(1);
  });

  it("FRAME-3 keeps canonical semantic evidence (options, image, formula) for an iframe question", () => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    mountQuestion(doc.body, '<div class="question-item" data-question-id="12"><p class="stem">12. Simplify <span>x^2</span> and choose.</p><img src="http://img.test/diagram-a.png" alt="figure"><ul><li><button class="option">A. 3</button></li><li><button class="option">B. 4</button></li><li><button class="option">C. 5</button></li><li><button class="option">D. 6</button></li></ul></div>');
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const [block] = detectCandidatesInRoot(frameRoot.root, frameRoot);
    const identity = block!.identity!;
    expect(identity.contentFingerprint).toMatch(/^cf_v1_/);
    expect(identity.signals.options).toBe(true);
    expect(identity.signals.media).toBe(true);

    const img = frameRoot.root.querySelector("img")!;
    img.setAttribute("src", "http://img.test/diagram-b.png");
    const redetected = detectCandidatesInRoot(frameRoot.root, frameRoot);
    expect(redetected[0]!.identity!.contentFingerprint).not.toBe(identity.contentFingerprint);
  });

  it("FRAME-4 maps and fills only the iframe controls with DOM readback", async () => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    mountQuestion(doc.body);
    // Same-labelled control in the top document must stay untouched.
    document.body.insertAdjacentHTML("beforeend", '<div class="question-item" id="top-holder"><button class="option" id="top-b">B. 4</button></div>');
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const [block] = detectCandidatesInRoot(frameRoot.root, frameRoot);
    captureSolveStartControlState(block!);
    const outcome = await fillParsedAnswerInPage(block!, parseResult("B"), { mode: "auto" });
    expect(outcome.ok).toBe(true);
    expect(doc.getElementById("opt-b")!.getAttribute("aria-checked")).toBe("true");
    expect(document.getElementById("top-b")!.getAttribute("aria-checked")).toBeNull();
  });

  it("MSG-ROOT-1 restores the exact iframe owner after a JSON message round trip", async () => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    mountQuestion(doc.body);
    document.body.insertAdjacentHTML("beforeend", '<button class="option" id="top-b">B. 4</button>');
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const [detected] = detectCandidatesInRoot(frameRoot.root, frameRoot);
    const messageBlock = JSON.parse(JSON.stringify(detected)) as QuestionBlock;

    expect(messageBlock.runtimeQuestionHandle).toMatch(/^rqh_[0-9a-f]{32}$/);
    expect(rootAttachmentOf(messageBlock).rootKey).toBe(TOP_ROOT_KEY);
    const messageSafe = sanitizeQuestionBlockForRuntimeMessage(detected!);
    expect(messageSafe.runtimeQuestionHandle).toBe(detected!.runtimeQuestionHandle);
    expect(messageSafe.runtimeOwnerKey).toBeUndefined();
    expect(Object.getOwnPropertySymbols(messageSafe)).toHaveLength(0);
    const persistent = sanitizeQuestionBlockForSerialization(detected!);
    expect(persistent.runtimeQuestionHandle).toBeUndefined();
    expect(persistent.runtimeOwnerKey).toBeUndefined();
    const result = await fillParsedAnswerInPage(messageBlock, parseResult("B"), { mode: "manual" });

    expect(result.ok).toBe(true);
    expect(doc.getElementById("opt-b")!.getAttribute("aria-checked")).toBe("true");
    expect(document.getElementById("top-b")!.getAttribute("aria-checked")).toBeNull();
  });

  it("REAL_CLICK sends frame-owned control coordinates in the top-tab viewport", async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    try {
      const { iframe, doc } = makeFrame();
      stubRect(iframe, { left: 100, top: 50, width: 800, height: 600 });
      const button = doc.createElement("button");
      doc.body.append(button);
      stubRect(button, { left: 10, top: 20, width: 20, height: 10 });
      sharedRootRegistry().reconcile(document);

      expect(await requestRealClick(button)).toBe(true);
      expect(sendMessage).toHaveBeenCalledWith({ type: "REAL_CLICK", x: 120, y: 75 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("SECURITY-PROGRESS-1 strips runtime root locators from progress messages", () => {
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    try {
      const { doc } = makeFrame();
      mountQuestion(doc.body);
      sharedRootRegistry().reconcile(document);
      const frameRoot = sharedRootRegistry().list().find((root) => root.kind === "same-origin-frame")!;
      const [block] = detectCandidatesInRoot(frameRoot.root, frameRoot);
      sendAutoSolveProgress({
        running: true,
        solved: 0,
        filled: 0,
        total: 1,
        current: 1,
        statusText: "testing",
        currentBlock: block!,
      });

      const serialized = JSON.stringify(sendMessage.mock.calls[0]?.[0]);
      expect(serialized).not.toContain("rqh_");
      expect(serialized).not.toContain(frameRoot.rootKey);
      expect(serialized).not.toContain("runtimeOwnerKey");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("MSG-ROOT-2 restores the exact shadow owner after a JSON message round trip", async () => {
    const registry = registryWithTop();
    const { host, shadow } = makeShadowHost("message-roundtrip", 0);
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));
    const shadowContext = registry.list().find((root) => root.shadowHost === host)!;
    const [detected] = detectCandidatesInRoot(shadowContext.root, shadowContext);
    const messageBlock = JSON.parse(JSON.stringify(detected)) as QuestionBlock;

    const result = await fillParsedAnswerInPage(messageBlock, parseResult("B"), { mode: "manual" });

    expect(result.ok).toBe(true);
    expect(shadow.getElementById("opt-b")!.getAttribute("aria-checked")).toBe("true");
  });

  it("MSG-ROOT-3 rejects a runtime handle after its frame root is replaced", async () => {
    const registry = sharedRootRegistry();
    const { iframe, doc } = makeFrame();
    mountQuestion(doc.body);
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const [detected] = detectCandidatesInRoot(frameRoot.root, frameRoot);
    const messageBlock = JSON.parse(JSON.stringify(detected)) as QuestionBlock;

    const replacement = document.implementation.createHTMLDocument("replacement");
    Object.defineProperty(replacement, "defaultView", { configurable: true, value: iframe.contentWindow });
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: replacement });
    registry.reconcile(document);
    const result = await fillParsedAnswerInPage(messageBlock, parseResult("B"), { mode: "manual" });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("STALE_ROOT_CONTEXT");
    expect(replacement.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it("MSG-ROOT-6 rejects a shadow handle when its owning frame document is replaced", async () => {
    const registry = sharedRootRegistry();
    const { iframe, doc } = makeFrame();
    const host = doc.createElement("nested-shadow-host");
    doc.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const owner = doc.createElement("section");
    owner.className = "question-item";
    owner.setAttribute("data-question-id", "18");
    owner.innerHTML = '<p class="stem">18. Which value equals 2 + 2? Choose one.</p>'
      + '<button class="option">A. 3</button><button class="option">B. 4</button>'
      + '<button class="option">C. 5</button><button class="option">D. 6</button>';
    shadow.append(owner);
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const shadowRoot = registry.list().find((root) => root.root === shadow)!;
    const detected = attachTestRuntimeBlock(owner, shadowRoot, "single_choice", extractStructuredQuestionText(owner));
    const messageBlock = JSON.parse(JSON.stringify(detected)) as QuestionBlock;

    const replacement = document.implementation.createHTMLDocument("replacement");
    Object.defineProperty(replacement, "defaultView", { configurable: true, value: iframe.contentWindow });
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: replacement });
    const events = registry.reconcile(document);
    expect(events.replacedRootKeys).toContain(frameRoot.rootKey);
    expect(events.removedRootKeys).toContain(shadowRoot.rootKey);

    const result = await fillParsedAnswerInPage(messageBlock, parseResult("B"), { mode: "manual" });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("STALE_ROOT_CONTEXT");
    expect(owner.querySelector('[aria-checked="true"]')).toBeNull();
    expect(replacement.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it("MSG-ROOT-4 rejects missing or malformed handles without falling back to top", async () => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    mountQuestion(doc.body);
    const topHolder = document.createElement("div");
    document.body.append(topHolder);
    mountQuestion(topHolder, QUESTION_HTML.replace('id="opt-b"', 'id="top-b"'));
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const [detected] = detectCandidatesInRoot(frameRoot.root, frameRoot);
    const serialized = JSON.parse(JSON.stringify(detected)) as QuestionBlock;
    const malformed = { ...serialized, runtimeQuestionHandle: "not-a-runtime-handle" };
    const missing = { ...serialized, runtimeQuestionHandle: undefined };

    for (const block of [malformed, missing]) {
      const result = await fillParsedAnswerInPage(block, parseResult("B"), { mode: "manual" });
      expect(result.ok).toBe(false);
      expect(result.message).toBe("STALE_RUNTIME_QUESTION_HANDLE");
    }
    expect(doc.querySelector('[aria-checked="true"]')).toBeNull();
    expect(document.getElementById("top-b")!.getAttribute("aria-checked")).toBeNull();
  });

  it("MSG-ROOT-5 resolves the frame instance when the top page has the same question", async () => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    mountQuestion(doc.body);
    const topHolder = document.createElement("div");
    document.body.append(topHolder);
    mountQuestion(topHolder);
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const [frameBlock] = detectCandidatesInRoot(frameRoot.root, frameRoot);
    const [topBlock] = detectCandidatesInRoot(document, registry.get(TOP_ROOT_KEY)!);
    expect(frameBlock!.identity!.stableId).toBe(topBlock!.identity!.stableId);
    expect(frameBlock!.id).not.toBe(topBlock!.id);
    const messageBlock = JSON.parse(JSON.stringify(frameBlock)) as QuestionBlock;

    const result = await fillParsedAnswerInPage(messageBlock, parseResult("B"), { mode: "manual" });

    expect(result.ok).toBe(true);
    expect(doc.getElementById("opt-b")!.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it("FRAME-5 keeps identical questions in top and frame as separate runtime instances", async () => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    mountQuestion(doc.body);
    document.body.insertAdjacentHTML("beforeend", `<div id="top-question">${QUESTION_HTML.replace('data-question-id="12"', 'data-question-id="top-12"')}</div>`);
    stubRect(document.querySelector("#top-question .question-item")!, { left: 8, top: 8, width: 640, height: 220 });
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const [frameBlock] = detectCandidatesInRoot(frameRoot.root, frameRoot);
    const [topBlock] = detectCandidatesInRoot(document, registry.get(TOP_ROOT_KEY)!);
    expect(frameBlock!.identity!.stableId).not.toBe(topBlock!.identity!.stableId);

    // A pending attempt on the frame instance must not authorize a fill of the
    // identically-worded top instance.
    captureSolveStartControlState(topBlock!);
    const controller = new AbortController();
    beginQuestionRevisionAttempt(frameBlock!, controller);
    try {
      const outcome = await fillParsedAnswerInPage(topBlock!, parseResult("B"), { mode: "auto" });
      expect(controller.signal.aborted).toBe(false);
      expect(outcome.message).toBe("STALE_QUESTION_REVISION");
      expect(document.querySelector('#top-question [aria-checked="true"]')).toBeNull();
    } finally {
      clearQuestionRevisionAttempt(controller);
    }
  });

  it.each([
    {
      id: "FRAME-NATIVE-1",
      html: '<p class="stem">12. Which value equals 2 + 2? Single choice.</p>'
        + '<label><input type="radio" name="answer" value="A"> A. 3</label>'
        + '<label><input type="radio" name="answer" value="B"> B. 4</label>'
        + '<label><input type="radio" name="answer" value="C"> C. 5</label>'
        + '<label><input type="radio" name="answer" value="D"> D. 6</label>',
      questionType: "single_choice" as const,
      expectedControl: "radio",
      answer: "B",
      verify: (owner: Element) => expect((owner.querySelector('input[value="B"]') as HTMLInputElement).checked).toBe(true),
    },
    {
      id: "FRAME-NATIVE-2",
      html: '<p class="stem">13. Select all correct values. Multiple choice.</p>'
        + '<label><input type="checkbox" name="answer" value="A"> A. 2</label>'
        + '<label><input type="checkbox" name="answer" value="B"> B. 4</label>'
        + '<label><input type="checkbox" name="answer" value="C"> C. 6</label>'
        + '<label><input type="checkbox" name="answer" value="D"> D. 8</label>',
      questionType: "multi_choice" as const,
      expectedControl: "checkbox",
      answer: "A,B",
      verify: (owner: Element) => {
        expect((owner.querySelector('input[value="A"]') as HTMLInputElement).checked).toBe(true);
        expect((owner.querySelector('input[value="B"]') as HTMLInputElement).checked).toBe(true);
      },
    },
    {
      id: "FRAME-NATIVE-3",
      html: '<p class="stem">14. Fill in blank (1): ____</p><input type="text" data-blank-index="1" aria-label="blank 1">',
      questionType: "fill_blank" as const,
      expectedControl: "text",
      answer: "alpha",
      verify: (owner: Element) => expect((owner.querySelector("input") as HTMLInputElement).value).toBe("alpha"),
    },
    {
      id: "FRAME-NATIVE-4",
      html: '<p class="stem">15. Fill in blank (1): ____</p><textarea data-blank-index="1" aria-label="blank 1"></textarea>',
      questionType: "fill_blank" as const,
      expectedControl: "textarea",
      answer: "beta",
      verify: (owner: Element) => expect((owner.querySelector("textarea") as HTMLTextAreaElement).value).toBe("beta"),
    },
  ])("$id discovers, maps, snapshots, fills, reads back, and verifies frame-native controls", async (scenario) => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    const owner = doc.createElement("section");
    owner.className = "question-item";
    owner.setAttribute("data-question-id", scenario.id);
    owner.innerHTML = scenario.html;
    doc.body.append(owner);
    stubRect(owner, { left: 8, top: 8, width: 640, height: 220 });
    const topTwin = document.createElement("section");
    topTwin.className = "question-item";
    topTwin.innerHTML = scenario.html.replace(/name="answer"/g, 'name="top-answer"');
    document.body.append(topTwin);
    registry.reconcile(document);
    const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
    const previewText = extractStructuredQuestionText(owner);
    const block = attachTestRuntimeBlock(owner, frameRoot, scenario.questionType, previewText);

    const controls = discoverControls(owner);
    expect(controls.some((control) => control.controlType === scenario.expectedControl)).toBe(true);
    const mapping = buildControlMapping(block, owner);
    expect(mapping.ok).toBe(true);
    if (mapping.ok) {
      expect(mapping.confidence).toBeGreaterThanOrEqual(0.9);
      if (scenario.expectedControl === "radio" || scenario.expectedControl === "checkbox") expect(mapping.options.size).toBe(4);
      else expect(mapping.blanks).toHaveLength(1);
    }

    captureSolveStartControlState(block);
    expect(hasAutoSolveQuestionAttempt(block)).toBe(true);
    const result = await fillParsedAnswerInPage(block, {
      ...parseResult(scenario.answer),
      questionType: scenario.questionType,
      ...(scenario.questionType === "multi_choice" ? { optionSelections: { A: true, B: true, C: false, D: false } } : {}),
    }, { mode: "auto" });

    expect(result.ok).toBe(true);
    scenario.verify(owner);
    const verification = verifyParsedAnswerInPage(block, {
      ...parseResult(scenario.answer),
      questionType: scenario.questionType,
      ...(scenario.questionType === "multi_choice" ? { optionSelections: { A: true, B: true, C: false, D: false } } : {}),
    });
    expect(verification.ok).toBe(true);
    expect(topTwin.querySelectorAll(":checked")).toHaveLength(0);
    expect((topTwin.querySelector("input") as HTMLInputElement | null)?.value ?? "").not.toBe(scenario.answer);
    finishAutoSolveQuestionAttempt(block);
  });

  it("FRAME-SHADOW-NATIVE-1 maps and fills a native radio in an iframe open shadow root", async () => {
    const registry = sharedRootRegistry();
    const { doc } = makeFrame();
    const host = doc.createElement("native-choice-host");
    doc.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const owner = doc.createElement("section");
    owner.className = "question-item";
    owner.setAttribute("data-question-id", "16");
    owner.innerHTML = '<p class="stem">16. Which value equals 2 + 2? Choose the correct value.</p>'
      + '<label><input type="radio" name="shadow-answer" value="A"> A. 3</label>'
      + '<label><input type="radio" name="shadow-answer" value="B"> B. 4</label>'
      + '<label><input type="radio" name="shadow-answer" value="C"> C. 5</label>'
      + '<label><input type="radio" name="shadow-answer" value="D"> D. 6</label>';
    shadow.append(owner);
    const topTwin = document.createElement("input");
    topTwin.type = "radio";
    topTwin.name = "shadow-answer";
    topTwin.value = "B";
    document.body.append(topTwin);
    stubRect(owner, { left: 8, top: 8, width: 640, height: 220 });
    registry.reconcile(document);
    const shadowContext = registry.list().find((root) => root.root === shadow)!;
    const block = attachTestRuntimeBlock(owner, shadowContext, "single_choice", extractStructuredQuestionText(owner));

    const controls = discoverControls(owner);
    expect(controls.some((control) => control.controlType === "radio")).toBe(true);
    const mapping = buildControlMapping(block, owner);
    expect(mapping.ok).toBe(true);
    captureSolveStartControlState(block);
    const result = await fillParsedAnswerInPage(block, parseResult("B"), { mode: "auto" });
    expect(result.ok).toBe(true);
    expect((owner.querySelector('input[value="B"]') as HTMLInputElement).checked).toBe(true);
    expect(verifyParsedAnswerInPage(block, parseResult("B")).ok).toBe(true);
    expect(topTwin.checked).toBe(false);
    finishAutoSolveQuestionAttempt(block);
  });

  it("FRAME-6 invalidates a pending attempt when the frame document is replaced", async () => {
    sharedRootRegistry().reconcile(document);
    const { iframe, doc } = makeFrame();
    mountQuestion(doc.body);
    const stop = startQuestionRevisionWatch({
      detectCandidates: () => [],
      onCandidates: () => {},
      detectRootCandidates: detectCandidatesInRoot,
    });
    const controller = new AbortController();
    try {
      const frameRoot = sharedRootRegistry().list().find((root) => root.kind === "same-origin-frame")!;
      const [block] = detectCandidatesInRoot(frameRoot.root, frameRoot);
      beginQuestionRevisionAttempt(block!, controller);

      // Same iframe element, replaced document (same URL, same text even),
      // then any top mutation triggers the watcher's bounded reconciliation.
      const replacement = document.implementation.createHTMLDocument("reloaded");
      Object.defineProperty(replacement, "defaultView", { configurable: true, value: iframe.contentWindow });
      Object.defineProperty(iframe, "contentDocument", { configurable: true, value: replacement });
      document.body.append(document.createElement("div"));
      await vi.waitFor(() => expect(controller.signal.aborted).toBe(true), { timeout: 3000 });
      expect(sharedRootRegistry().get(frameRoot.rootKey)!.rootGeneration).toBe(2);
    } finally {
      clearQuestionRevisionAttempt(controller);
      stop();
    }
  });

  it("FRAME-7 prunes a removed frame and invalidates its pending attempt", async () => {
    sharedRootRegistry().reconcile(document);
    const { iframe, doc } = makeFrame();
    mountQuestion(doc.body);
    const stop = startQuestionRevisionWatch({
      detectCandidates: () => [],
      onCandidates: () => {},
      detectRootCandidates: detectCandidatesInRoot,
    });
    const controller = new AbortController();
    try {
      const frameRoot = sharedRootRegistry().list().find((root) => root.kind === "same-origin-frame")!;
      const [block] = detectCandidatesInRoot(frameRoot.root, frameRoot);
      beginQuestionRevisionAttempt(block!, controller);

      iframe.remove();
      document.body.append(document.createElement("div"));
      await vi.waitFor(() => expect(controller.signal.aborted).toBe(true), { timeout: 3000 });
      expect(sharedRootRegistry().get(frameRoot.rootKey)).toBeUndefined();
    } finally {
      clearQuestionRevisionAttempt(controller);
      stop();
      iframe.remove();
    }
  });

  it("SHADOW-1 detects a question entirely inside an open shadow root", () => {
    const registry = registryWithTop();
    const { shadow } = makeShadowHost("a", 0);
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));
    const shadowRoot = registry.list().find((root) => root.shadowHost === (shadow.host as Element))!;
    const blocks = detectCandidatesInRoot(shadowRoot.root, shadowRoot);
    expect(blocks).toHaveLength(1);
    expect(rootAttachmentOf(blocks[0]!).rootKey).toBe(shadowRoot.rootKey);
    expect(detectCandidatesAcrossRoots().filter((block) => block.identity?.nativeQuestionId === "12")).toHaveLength(1);
  });

  it("SHADOW-2 detects nested open shadow questions exactly once per root", () => {
    const registry = registryWithTop();
    const { shadow } = makeShadowHost("outer", 0, '<div class="question-item" data-question-id="12"><p class="stem">12. Outer question A. 1 B. 2 C. 3 D. 4</p><nested-widget></nested-widget></div>');
    const nestedHost = shadow.querySelector("nested-widget")!;
    stubRect(nestedHost, { left: 8, top: 200, width: 600, height: 60 });
    const nestedShadow = nestedHost.attachShadow({ mode: "open" });
    nestedShadow.innerHTML = '<div class="question-item" data-question-id="99"><p class="stem">99. Inner question A. 5 B. 6 C. 7 D. 8</p></div>';
    const innerContainer = nestedShadow.querySelector(".question-item")!;
    stubRect(innerContainer, { left: 8, top: 8, width: 560, height: 50 });
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));

    const shadowRoots = registry.list().filter((root) => root.kind === "open-shadow-root");
    expect(shadowRoots).toHaveLength(2);
    const outer = shadowRoots.find((root) => root.root === shadow)!;
    const inner = shadowRoots.find((root) => root.root === nestedShadow)!;
    const outerBlocks = detectCandidatesInRoot(outer.root, outer);
    const innerBlocks = detectCandidatesInRoot(inner.root, inner);
    expect(outerBlocks.filter((block) => block.identity!.nativeQuestionId === "12")).toHaveLength(1);
    expect(innerBlocks.filter((block) => block.identity!.nativeQuestionId === "99")).toHaveLength(1);
  });

  it("SHADOW-3 maps and fills shadow controls without touching the sibling component", async () => {
    const registry = registryWithTop();
    const { host: hostA, shadow: shadowA } = makeShadowHost("a", 0);
    const { shadow: shadowB } = makeShadowHost("b", 400, QUESTION_HTML.replace('id="opt-b"', 'id="other-b"'));
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));

    const rootA = registry.list().find((root) => root.shadowHost === hostA)!;
    const [block] = detectCandidatesInRoot(rootA.root, rootA);
    captureSolveStartControlState(block!);
    const outcome = await fillParsedAnswerInPage(block!, parseResult("B"), { mode: "auto" });
    expect(outcome.ok).toBe(true);
    console.log("SHADOW-3 states", JSON.stringify({
      msg: outcome.message,
      ok: outcome.ok,
      a: shadowA.getElementById("opt-b")?.getAttribute("aria-checked"),
      b: shadowB.getElementById("other-b")?.getAttribute("aria-checked"),
    }));
    expect(shadowA.getElementById("opt-b")!.getAttribute("aria-checked")).toBe("true");
    expect(shadowB.getElementById("other-b")!.getAttribute("aria-checked")).toBeNull();
  });

  it("SHADOW-SCOPE-1 keeps Question 12 inside shadow when top Question 12 differs", async () => {
    const registry = registryWithTop();
    const topHolder = document.createElement("div");
    document.body.append(topHolder);
    mountQuestion(topHolder, QUESTION_HTML.replace("2 + 2", "9 + 9").replace("B. 4", "B. 18").replace('id="opt-b"', 'id="top-b"'));
    const { host, shadow } = makeShadowHost("scope-different", 300);
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));
    const root = registry.list().find((entry) => entry.shadowHost === host)!;
    const [block] = detectCandidatesInRoot(root.root, root);

    const result = await fillParsedAnswerInPage(block!, parseResult("B"), { mode: "manual" });

    expect(result.ok).toBe(true);
    expect(shadow.getElementById("opt-b")!.getAttribute("aria-checked")).toBe("true");
    expect(document.getElementById("top-b")!.getAttribute("aria-checked")).toBeNull();
  });

  it("SHADOW-SCOPE-2 uses the exact shadow instance when top has identical semantics", async () => {
    const registry = registryWithTop();
    const topHolder = document.createElement("div");
    document.body.append(topHolder);
    mountQuestion(topHolder);
    const { host, shadow } = makeShadowHost("scope-identical", 300);
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));
    const root = registry.list().find((entry) => entry.shadowHost === host)!;
    const [shadowBlock] = detectCandidatesInRoot(root.root, root);
    const [topBlock] = detectCandidatesInRoot(document, registry.get(TOP_ROOT_KEY)!);
    expect(shadowBlock!.identity!.stableId).toBe(topBlock!.identity!.stableId);

    const result = await fillParsedAnswerInPage(shadowBlock!, parseResult("B"), { mode: "manual" });

    expect(result.ok).toBe(true);
    expect(shadow.getElementById("opt-b")!.getAttribute("aria-checked")).toBe("true");
    expect(topHolder.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it("SHADOW-SCOPE-3 abstains after the shadow owner disappears", async () => {
    const registry = registryWithTop();
    const { host, shadow } = makeShadowHost("scope-removed", 0);
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));
    const root = registry.list().find((entry) => entry.shadowHost === host)!;
    const [block] = detectCandidatesInRoot(root.root, root);
    host.remove();
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));

    const result = await fillParsedAnswerInPage(block!, parseResult("B"), { mode: "manual" });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("STALE_RUNTIME_QUESTION_HANDLE");
    expect(shadow.getElementById("opt-b")!.getAttribute("aria-checked")).toBeNull();
  });

  it("SHADOW-4 preserves media and formula evidence inside open shadow roots", () => {
    const registry = registryWithTop();
    const { shadow } = makeShadowHost("media", 0, '<div class="question-item"><p class="stem">7. Solve <span>x^3 - 8 = 0</span>.</p><img src="http://img.test/graph-a.png" alt="graph"><button class="option">A. 2</button><button class="option">B. 3</button><button class="option">C. 4</button><button class="option">D. 5</button></div>');
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));
    const shadowRoot = registry.list().find((root) => root.shadowHost === (shadow.host as Element))!;
    const [block] = detectCandidatesInRoot(shadowRoot.root, shadowRoot);
    expect(block!.identity!.signals.media).toBe(true);
    expect(block!.mediaAssets?.length ?? 0).toBeGreaterThan(0);
    const before = block!.identity!.contentFingerprint;
    shadow.querySelector("img")!.setAttribute("src", "http://img.test/graph-b.png");
    const redetected = detectCandidatesInRoot(shadowRoot.root, shadowRoot);
    expect(redetected[0]!.identity!.contentFingerprint).not.toBe(before);
  });

  it("SHADOW-6 never fabricates candidates from closed shadow roots", () => {
    const registry = registryWithTop();
    const host = document.createElement("my-closed-host");
    document.body.append(host);
    const closed = host.attachShadow({ mode: "closed" });
    closed.innerHTML = QUESTION_HTML;
    stubRect(host, { left: 0, top: 0, width: 640, height: 300 });
    registry.reconcile(document, new Set([TOP_ROOT_KEY]));
    expect(registry.list().filter((root) => root.kind === "open-shadow-root")).toHaveLength(0);
    expect(detectCandidatesAcrossRoots().filter((block) => block.identity?.nativeQuestionId === "12")).toHaveLength(0);
  });
});
