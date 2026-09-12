import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ParseResult } from "@/shared/types";
import { detectCandidatesInRoot, detectCandidatesAcrossRoots } from "./detector/domDetector";
import type { AccessibleRootRegistry } from "./roots/rootRegistry";
import { sharedRootRegistry } from "./roots/rootRegistry";
import { rootAttachmentOf, TOP_ROOT_KEY } from "./roots/rootContext";
import { beginQuestionRevisionAttempt, clearQuestionRevisionAttempt } from "./revision/questionRevisionRuntime";
import { startQuestionRevisionWatch } from "./revision/questionRevisionWatch";
import { captureSolveStartControlState, fillParsedAnswerInPage } from "./answerFiller";

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
