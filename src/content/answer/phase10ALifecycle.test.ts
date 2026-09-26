import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionPlan, AnswerPlan, QuestionBlock } from "@/shared/types";
import { buildActionPlan, executeTransaction } from "./transactionalExecutor";
import { buildControlMapping } from "./controlMapping";
import { controlRegistry, MAX_CONTROL_REGISTRY_ENTRIES } from "./controlRegistry";
import { QuestionRevisionRegistry, instanceKeyFor, MAX_QUESTION_REVISION_ENTRIES } from "../revision/questionRevisionRegistry";
import { revisionRegistry } from "../revision/questionRevisionRuntime";
import { startQuestionRevisionWatch } from "../revision/questionRevisionWatch";
import { sharedRootRegistry } from "../roots/rootRegistry";
import { rootAttachmentOf, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "../roots/rootContext";

const block = (id: string): QuestionBlock => ({
  id,
  bbox: { x: 0, y: 0, width: 800, height: 400 },
  previewText: "Question A. one B. two C. three D. four",
  questionTypeGuess: "single_choice",
  hasImage: false,
  confidence: 1,
  source: "auto_dom",
});

const revisionBlock = (id: string): QuestionBlock => ({
  ...block(id),
  identity: {
    stableId: id,
    contentFingerprint: `fingerprint-${id}`,
    identityVersion: 1,
    strategy: "native-id",
    nativeQuestionId: id,
    signals: { nativeId: true, content: true, options: true, media: false, structure: true },
  },
});

function ownerWithChoices(): HTMLElement {
  const owner = document.createElement("section");
  owner.className = "question-item";
  owner.innerHTML = "<button>A. one</button><button>B. two</button><button>C. three</button><button>D. four</button>";
  return owner;
}

function answerPlan(question: QuestionBlock, key = "B"): AnswerPlan {
  return {
    schemaVersion: 1,
    kind: "single-choice",
    questionId: question.identity?.stableId ?? question.id,
    contentFingerprint: question.identity?.contentFingerprint ?? question.id,
    questionType: "single_choice",
    confidence: 1,
    source: "parse-result",
    answerSemanticHash: key,
    optionKeys: [key],
  };
}

function authorityResolver(question: QuestionBlock, owner: Element) {
  return () => {
    const mapping = buildControlMapping(question, owner);
    if (!mapping.ok) return { ok: false as const, code: mapping.code, message: mapping.message };
    const root = rootAttachmentOf(question);
    return {
      ok: true as const,
      mapping,
      stableId: question.identity?.stableId ?? question.id,
      contentFingerprint: question.identity?.contentFingerprint ?? question.id,
      rootKey: root.rootKey,
      rootGeneration: root.rootGeneration,
    };
  };
}

function mapQuestion(question: QuestionBlock, owner: Element) {
  const mapping = buildControlMapping(question, owner);
  if (!mapping.ok) throw new Error(mapping.message);
  return mapping;
}

describe("Phase 10A runtime registry lifecycle", () => {
  afterEach(() => {
    document.body.replaceChildren();
    controlRegistry.clear();
    sharedRootRegistry().reset();
    vi.useRealTimers();
  });

  it("P10A-CONTROL-CHURN-1000 caps 1000 unique four-control mappings", () => {
    controlRegistry.clear();
    let peak = controlRegistry.size;
    for (let index = 0; index < 1000; index += 1) {
      const owner = ownerWithChoices();
      document.body.append(owner);
      const question = block(`historical-${index}`);
      const mapping = mapQuestion(question, owner);
      expect(mapping.options.size).toBe(4);
      peak = Math.max(peak, controlRegistry.size);
      controlRegistry.clearQuestion(question.id, TOP_ROOT_KEY, TOP_ROOT_GENERATION);
      owner.remove();
    }

    expect(peak).toBe(4);
    expect(controlRegistry.size).toBe(0);
    expect(peak).toBeLessThanOrEqual(MAX_CONTROL_REGISTRY_ENTRIES);
  });

  it("P10A-SAME-QUESTION-RERENDER-1000 rebinds only the latest live controls", () => {
    controlRegistry.clear();
    const question = block("stable-question");
    let latestOwner: HTMLElement | null = null;
    let latestMapping: ReturnType<typeof mapQuestion> | null = null;
    let peak = 0;

    for (let index = 0; index < 1000; index += 1) {
      const previous = latestMapping
        ? [...latestMapping.options.values()].map((ref) => ({ id: ref.controlId, element: controlRegistry.get(ref.controlId)! }))
        : [];
      const owner = ownerWithChoices();
      document.body.append(owner);
      const mapping = mapQuestion(question, owner);
      const elements = [...mapping.options.values()].map((ref) => controlRegistry.get(ref.controlId)!);
      expect(elements.every(Boolean)).toBe(true);
      expect(previous.every(({ id, element }) => controlRegistry.get(id) !== element)).toBe(true);
      if (latestOwner) latestOwner.remove();
      latestOwner = owner;
      latestMapping = mapping;
      peak = Math.max(peak, controlRegistry.size);
    }

    expect(peak).toBe(4);
    expect(controlRegistry.size).toBe(4);
    expect(controlRegistry.entryCountForQuestion("stable-question")).toBe(4);
    for (const [key, ref] of latestMapping!.options) {
      const current = controlRegistry.get(ref.controlId);
      expect(current).toBe(latestOwner!.querySelectorAll("button")["ABCD".indexOf(key)]);
      expect(current?.isConnected).toBe(true);
    }
    expect(latestMapping!.owner).toBe(latestOwner);
  });

  it("P10A-ROOT-REMOVE-500 releases every control owned by a removed frame root", async () => {
    controlRegistry.clear();
    sharedRootRegistry().reset();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const frameDocument = iframe.contentDocument!;
    const roots = sharedRootRegistry();
    roots.reconcile(document);
    const frameRoot = roots.list().find((root) => root.kind === "same-origin-frame")!;

    let peak = 0;
    for (let index = 0; index < 500; index += 1) {
      const owner = ownerWithChoices();
      frameDocument.body.append(owner);
      const question = block(`frame-question-${index}`);
      mapQuestion(question, owner);
      revisionRegistry().observe(revisionBlock(`frame-revision-${index}`), owner, {
        rootKey: frameRoot.rootKey,
        rootGeneration: frameRoot.rootGeneration,
      });
      peak = Math.max(peak, controlRegistry.size);
    }
    expect(controlRegistry.entryCountForRoot(frameRoot.rootKey)).toBeGreaterThan(0);

    vi.useFakeTimers();
    const stop = startQuestionRevisionWatch({ detectCandidates: () => [], onCandidates: () => {} });
    iframe.remove();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(peak).toBe(MAX_CONTROL_REGISTRY_ENTRIES);
    expect(roots.get(frameRoot.rootKey)).toBeUndefined();
    expect(controlRegistry.entryCountForRoot(frameRoot.rootKey)).toBe(0);
    expect(revisionRegistry().currentForRoot(frameRoot.rootKey, "frame-revision-0")).toBeUndefined();
    stop();
  });

  it("root generation replacement clears prior controls and revision state", async () => {
    controlRegistry.clear();
    sharedRootRegistry().reset();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const frameDocument = iframe.contentDocument!;
    const owner = ownerWithChoices();
    frameDocument.body.append(owner);
    const roots = sharedRootRegistry();
    roots.reconcile(document);
    const frameRoot = roots.list().find((root) => root.kind === "same-origin-frame")!;
    const oldGeneration = frameRoot.rootGeneration;
    const oldMapping = mapQuestion(block("replace-generation"), owner);
    const oldControlId = oldMapping.options.get("A")!.controlId;
    revisionRegistry().observe(revisionBlock("old-generation"), owner, {
      rootKey: frameRoot.rootKey,
      rootGeneration: oldGeneration,
    });

    vi.useFakeTimers();
    const stop = startQuestionRevisionWatch({ detectCandidates: () => [], onCandidates: () => {} });
    const replacement = document.implementation.createHTMLDocument("replacement");
    Object.defineProperty(replacement, "defaultView", { configurable: true, value: iframe.contentWindow });
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: replacement });
    document.body.append(document.createElement("div"));
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(roots.get(frameRoot.rootKey)?.rootGeneration).toBe(oldGeneration + 1);
    expect(controlRegistry.entryCountForRoot(frameRoot.rootKey)).toBe(0);
    expect(controlRegistry.get(oldControlId)).toBeNull();
    expect(revisionRegistry().currentForRoot(frameRoot.rootKey, "old-generation")).toBeUndefined();
    stop();
  });

  it("P10A-ACTIVE-TRANSACTION-CAPACITY keeps current controls pinned during churn", async () => {
    controlRegistry.clear();
    let peak = 0;
    const question = block("capacity-target");
    const owner = ownerWithChoices();
    document.body.append(owner);
    const mapping = mapQuestion(question, owner);
    peak = Math.max(peak, controlRegistry.size);

    for (let index = 0; index < (MAX_CONTROL_REGISTRY_ENTRIES - 4) / 4; index += 1) {
      const pressureOwner = ownerWithChoices();
      document.body.append(pressureOwner);
      mapQuestion(block(`preload-${index}`), pressureOwner);
      peak = Math.max(peak, controlRegistry.size);
    }
    expect(controlRegistry.size).toBe(MAX_CONTROL_REGISTRY_ENTRIES);

    const plan = answerPlan(question);
    const action = buildActionPlan(plan, mapping);
    let currentControlsSurvivedPressure = false;
    const buttonB = owner.querySelectorAll("button")[1]!;
    buttonB.addEventListener("pointerover", () => {
      for (let index = 0; index < 128; index += 1) {
        const pressureOwner = ownerWithChoices();
        document.body.append(pressureOwner);
        mapQuestion(block(`during-${index}`), pressureOwner);
      }
      currentControlsSurvivedPressure = [...mapping.options.values()].every((ref) => controlRegistry.get(ref.controlId)?.isConnected);
    }, { once: true });
    owner.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      owner.querySelectorAll("button").forEach((other) => other.setAttribute("aria-checked", String(other === button)));
    }));

    const result = await executeTransaction(plan, action, mapping, undefined, authorityResolver(question, owner));
    expect(currentControlsSurvivedPressure).toBe(true);
    expect(result.outcome).toBe("FILLED_VERIFIED");
    expect(owner.querySelectorAll("button")[1]?.getAttribute("aria-checked")).toBe("true");
    expect(peak).toBe(MAX_CONTROL_REGISTRY_ENTRIES);
    expect(controlRegistry.size).toBe(MAX_CONTROL_REGISTRY_ENTRIES);
  });

  it("P10A-STALE-AFTER-CLEANUP rejects an old action plan without rehydrating its mapping", async () => {
    controlRegistry.clear();
    const question = block("cleaned-question");
    const owner = ownerWithChoices();
    document.body.append(owner);
    const oldMapping = mapQuestion(question, owner);
    const plan = answerPlan(question);
    const action: ActionPlan = buildActionPlan(plan, oldMapping);
    let clicks = 0;
    owner.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { clicks += 1; }));

    controlRegistry.clearQuestion("cleaned-question", TOP_ROOT_KEY, TOP_ROOT_GENERATION);
    const result = await executeTransaction(plan, action, oldMapping, undefined, authorityResolver(question, owner));

    expect(result.outcome).toBe("STALE_ACTION_PLAN");
    expect(clicks).toBe(0);
  });

  it("P10A-REVISION-CHURN-1000 bounds historical versions and protects the active instance", () => {
    const registry = new QuestionRevisionRegistry();
    const activeKey = instanceKeyFor(TOP_ROOT_KEY, "revision-0");
    registry.protectInstance(activeKey);
    let peak = registry.size;

    for (let index = 0; index < 1000; index += 1) {
      registry.observe(revisionBlock(`revision-${index}`));
      peak = Math.max(peak, registry.size);
    }

    expect(peak).toBe(MAX_QUESTION_REVISION_ENTRIES);
    expect(registry.size).toBe(MAX_QUESTION_REVISION_ENTRIES);
    expect(registry.currentForInstance(activeKey)?.stableId).toBe("revision-0");
  });
});
