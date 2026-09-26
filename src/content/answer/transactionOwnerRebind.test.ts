import { afterEach, describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { fillParsedAnswerInPage } from "../answerFiller";
import { observeLiveQuestion } from "../liveQuestionObservation";
import { attachRuntimeRoot, readRuntimeQuestionHandle, TOP_ROOT_GENERATION, TOP_ROOT_KEY, type RootContext } from "../roots/rootContext";
import { resolveFillRootContext, type AccessibleRootRegistry } from "../roots/rootRegistry";
import { controlRegistry } from "./controlRegistry";
import { buildValidatedAnswerPlan } from "./answerPlanValidator";
import { buildControlMapping } from "./controlMapping";
import { buildActionPlan, executeTransaction } from "./transactionalExecutor";

type OwnerMode = "unique" | "ambiguous" | "root-change";
const trappedEvents = ["pointerover", "pointerenter", "pointerdown", "mouseover", "mousedown", "mouseup", "pointerup", "click"];

function multiChoiceResult(): ParseResult {
  return { blockId: "owner-rebind-question", questionType: "multi_choice", answer: "A,B", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
}

function makeOwnerBlock(owner: Element, root = { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" as const }): QuestionBlock {
  const draft: QuestionBlock = {
    id: "owner-rebind-question",
    bbox: { x: 0, y: 0, width: 720, height: 360 },
    previewText: "41. Select A and B. A. Alpha B. Beta C. Gamma",
    questionTypeGuess: "multi_choice",
    hasImage: false,
    confidence: 1,
    source: "auto_dom",
  };
  return attachRuntimeRoot(observeLiveQuestion(draft, owner), root, owner);
}

function installOwnerReplacement(mode: OwnerMode) {
  document.body.innerHTML = "";
  const selected = new Set<string>();
  const events: Array<{ type: string; key: string; ownerGeneration: number; connected: boolean }> = [];
  const staleOldBEvents: string[] = [];
  let ownerGeneration = 0;
  let replaced = false;
  let currentOwner: Element | null = null;
  const originalOwner = buildOwner(0);
  document.body.append(originalOwner);
  currentOwner = originalOwner;
  const block = makeOwnerBlock(originalOwner);

  function buildOwner(generation: number): HTMLElement {
    const owner = document.createElement("section");
    owner.className = "question-item";
    owner.innerHTML = '<p class="stem">41. Select A and B.</p><div id="options"></div>';
    const options = owner.querySelector("#options")!;
    for (const key of ["A", "B", "C"]) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = key;
      input.checked = selected.has(key);
      input.dataset.ownerGeneration = String(generation);
      for (const type of trappedEvents) {
        input.addEventListener(type, () => {
          events.push({ type, key, ownerGeneration: generation, connected: input.isConnected });
          if (generation === 0 && key === "B" && !input.isConnected) staleOldBEvents.push(type);
        });
      }
      input.addEventListener("change", () => {
        if (input.checked) selected.add(key);
        else selected.delete(key);
        if (key !== "A" || replaced) return;
        replaced = true;
        ownerGeneration += 1;
        const firstReplacement = buildOwner(ownerGeneration);
        owner.replaceWith(firstReplacement);
        currentOwner = firstReplacement;
        if (mode === "ambiguous") {
          const secondReplacement = buildOwner(ownerGeneration + 1);
          document.body.append(secondReplacement);
        }
        if (mode === "root-change") rootContext.rootGeneration += 1;
      });
      label.append(input, document.createTextNode(` ${key}. ${key === "A" ? "Alpha" : key === "B" ? "Beta" : "Gamma"}`));
      options.append(label);
    }
    return owner;
  }

  const rootContext: RootContext = {
    rootKey: "root-owner-rebind-test",
    kind: "same-origin-frame",
    root: document,
    ownerDocument: document,
    ownerWindow: window,
    rootGeneration: 1,
    connected: true,
  };

  return { block, events, staleOldBEvents, selected, originalOwner, rootContext, get currentOwner() { return currentOwner; } };
}

function customRootRegistry(context: RootContext): AccessibleRootRegistry {
  return {
    get: (key: string) => key === context.rootKey ? context : undefined,
  } as unknown as AccessibleRootRegistry;
}

afterEach(() => {
  controlRegistry.clear();
  document.body.innerHTML = "";
});

describe("Phase 8B semantic runtime-owner rebind", () => {
  it("OWNER-RERENDER-1 rebinds one exact owner and mutates B only on the replacement", async () => {
    const fixture = installOwnerReplacement("unique");

    const fill = await fillParsedAnswerInPage(fixture.block, multiChoiceResult());

    expect(fill).toMatchObject({ ok: true, filledCount: 2 });
    expect([...fixture.selected].sort()).toEqual(["A", "B"]);
    expect(fixture.currentOwner).not.toBe(fixture.originalOwner);
    expect(fixture.currentOwner?.isConnected).toBe(true);
    expect(fixture.events.filter(({ type }) => type === "click").map(({ key, ownerGeneration }) => [key, ownerGeneration])).toEqual([["A", 0], ["B", 1]]);
    expect(fixture.staleOldBEvents).toEqual([]);
  });

  it("OWNER-RERENDER-AMBIGUOUS-1 refuses two exact equivalent owners without mutating B", async () => {
    const fixture = installOwnerReplacement("ambiguous");

    const fill = await fillParsedAnswerInPage(fixture.block, multiChoiceResult());

    expect(fill.code).toBe("PARTIAL_MUTATION_UNPROVABLE");
    expect(fixture.events.filter(({ key }) => key === "B")).toEqual([]);
    expect(document.querySelectorAll(".question-item")).toHaveLength(2);
    expect([...fixture.selected]).toEqual(["A"]);
  });

  it("OWNER-RERENDER-ROOT-CHANGE-1 refuses a matching owner after root generation advances", async () => {
    const fixture = installOwnerReplacement("root-change");
    fixture.block = attachRuntimeRoot(observeLiveQuestion({ ...fixture.block }, fixture.originalOwner), {
      rootKey: fixture.rootContext.rootKey,
      rootGeneration: fixture.rootContext.rootGeneration,
      kind: fixture.rootContext.kind,
    }, fixture.originalOwner);
    const registry = customRootRegistry(fixture.rootContext);
    const initialRoot = resolveFillRootContext(registry, fixture.block);
    expect(initialRoot.ok).toBe(true);
    if (!initialRoot.ok || !initialRoot.owner) throw new Error("Test root did not resolve");
    const mapping = buildControlMapping(fixture.block, initialRoot.owner);
    if (!mapping.ok) throw new Error(mapping.message);
    const validated = buildValidatedAnswerPlan(fixture.block, multiChoiceResult(), mapping);
    if (!validated.ok) throw new Error(validated.message);
    const resolveAuthority = () => {
      const root = resolveFillRootContext(registry, fixture.block);
      if (!root.ok) return { ok: false as const, code: root.reason, message: root.reason };
      const fresh = buildControlMapping(fixture.block, root.owner!);
      if (!fresh.ok) return { ok: false as const, code: fresh.code, message: fresh.message };
      const identity = observeLiveQuestion(fixture.block, fresh.owner).identity;
      return {
        ok: true as const,
        mapping: fresh,
        stableId: identity.stableId,
        contentFingerprint: identity.contentFingerprint,
        rootKey: root.context.rootKey,
        rootGeneration: root.context.rootGeneration,
      };
    };

    const outcome = await executeTransaction(
      validated.plan,
      buildActionPlan(validated.plan, mapping),
      mapping,
      undefined,
      resolveAuthority,
    );

    expect(outcome.outcome).toBe("PARTIAL_MUTATION_UNPROVABLE");
    expect(fixture.events.filter(({ key }) => key === "B")).toEqual([]);
    expect(fixture.rootContext.rootGeneration).toBe(2);
    expect(readRuntimeQuestionHandle(fixture.block)).toBeNull();
    expect(fixture.selected).toEqual(new Set(["A"]));
  });
});
