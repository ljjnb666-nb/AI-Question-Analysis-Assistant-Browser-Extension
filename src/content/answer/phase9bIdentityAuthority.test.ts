import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { captureSolveStartControlState, fillParsedAnswerInPage, finishAutoSolveQuestionAttempt, verifyParsedAnswerInPage } from "../answerFiller";
import { buildControlMapping } from "./controlMapping";
import { bindDomQuestionBlockToOwner } from "../domQuestionBinding";
import { normalizeText } from "../detector/domText";
import { observeLiveQuestion } from "../liveQuestionObservation";
import { ownerOf, topRootContext } from "../roots/rootContext";
import { controlRegistry } from "./controlRegistry";
import { sharedRootRegistry } from "../roots/rootRegistry";

function setRect(element: Element, top: number): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 40, top, right: 640, bottom: top + 300, width: 600, height: 300, x: 40, y: top, toJSON: () => ({}) }),
  });
}

function addChoiceBehavior(owner: Element): HTMLElement[] {
  const controls = Array.from(owner.querySelectorAll<HTMLElement>("[role=radio]"));
  controls.forEach((control, index) => {
    setRect(control, 100 + index * 36);
    control.addEventListener("click", () => {
      controls.forEach((candidate) => candidate.setAttribute("aria-checked", String(candidate === control)));
    });
  });
  return controls;
}

function makeRuntimeBlock(owner: Element, id: string): QuestionBlock {
  const identitySourceText = normalizeText(String((owner as HTMLElement).innerText || owner.textContent || ""));
  const draft: QuestionBlock = {
    id,
    bbox: { x: 40, y: 80, width: 600, height: 300 },
    previewText: identitySourceText,
    identitySourceText,
    questionTypeGuess: "single_choice",
    hasImage: false,
    confidence: 1,
    source: "auto_dom",
  };
  return bindDomQuestionBlockToOwner(draft, owner, {
    identityText: identitySourceText,
    rootContext: topRootContext(document),
  });
}

function parseResult(block: QuestionBlock, answer = "B"): ParseResult {
  return {
    blockId: block.id,
    questionType: "single_choice",
    answer,
    confidence: 1,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: block.previewText,
    routeUsed: "text",
  };
}

function mountGenericNestedCard(id = "generic-card"): { outer: HTMLElement; controls: HTMLElement[] } {
  document.body.innerHTML = `<article id="${id}"><section class="question-item">Which neutral color follows amber?<ul>
    <li><button role="radio" aria-checked="false">A. Blue</button></li>
    <li><button role="radio" aria-checked="false">B. Green</button></li>
    <li><button role="radio" aria-checked="false">C. Gray</button></li>
    <li><button role="radio" aria-checked="false">D. Violet</button></li>
  </ul></section></article>`;
  const outer = document.getElementById(id)!;
  setRect(outer, 80);
  const inner = outer.querySelector(".question-item")!;
  setRect(inner, 90);
  return { outer, controls: addChoiceBehavior(inner) };
}

beforeEach(() => {
  document.body.innerHTML = "";
  sharedRootRegistry().reset();
  controlRegistry.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  sharedRootRegistry().reset();
  controlRegistry.clear();
});

describe("Phase 9B question identity authority", () => {
  it("P9B-OWNER-01 keeps identity on the generic outer owner while filling its semantic descendant", async () => {
    const { outer, controls } = mountGenericNestedCard();
    const block = makeRuntimeBlock(outer, "generic-nested-owner");
    const result = parseResult(block);
    const mapping = buildControlMapping(block, outer);

    expect(ownerOf(block)).toBe(outer);
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) throw new Error(mapping.message);
    expect(mapping.owner).toBe(outer.querySelector(".question-item"));
    expect([...mapping.options.keys()]).toEqual(["A", "B", "C", "D"]);

    captureSolveStartControlState(block);
    const filled = await fillParsedAnswerInPage(block, result, { mode: "auto" });

    expect(filled).toMatchObject({ ok: true, filledCount: 1 });
    expect(controls.filter((control) => control.getAttribute("aria-checked") === "true").map((control) => control.textContent?.trim())).toEqual(["B. Green"]);
    expect(observeLiveQuestion(block, outer).identity.stableId).toBe(block.identity?.stableId);
    expect(observeLiveQuestion(block, outer).identity.contentFingerprint).toBe(block.identity?.contentFingerprint);
    expect(verifyParsedAnswerInPage(block, result).ok).toBe(true);
    finishAutoSolveQuestionAttempt(block);
  });

  it("P9B-NESTED-NEG-01 refuses controls owned by an independent nested question", async () => {
    document.body.innerHTML = `<section id="outer-question" class="question-item" data-question-id="outer-q">
      Outer question A has no answer controls.
      <section class="question-item" data-question-id="inner-q"><p class="stem">Independent question B</p><ul>
        <li><button role="radio" aria-checked="false">A. Blue</button></li>
        <li><button role="radio" aria-checked="false">B. Green</button></li>
        <li><button role="radio" aria-checked="false">C. Gray</button></li>
        <li><button role="radio" aria-checked="false">D. Violet</button></li>
      </ul></section>
    </section>`;
    const outer = document.getElementById("outer-question")!;
    setRect(outer, 80);
    const inner = outer.querySelector<HTMLElement>("[data-question-id='inner-q']")!;
    setRect(inner, 100);
    const controls = addChoiceBehavior(inner);
    let clicks = 0;
    controls.forEach((control) => control.addEventListener("click", () => clicks++));
    const block = makeRuntimeBlock(outer, "nested-outer-question");

    const filled = await fillParsedAnswerInPage(block, parseResult(block), { mode: "manual" });

    expect(filled).toMatchObject({ ok: false, filledCount: 0, code: "STALE_ACTION_PLAN" });
    expect(controls.every((control) => control.getAttribute("aria-checked") !== "true")).toBe(true);
    expect(clicks).toBe(0);
  });

  it("P9B-FINGERPRINT-NEG-01 rejects changed content on the authoritative outer owner", async () => {
    const { outer, controls } = mountGenericNestedCard("changed-generic-card");
    const block = makeRuntimeBlock(outer, "changed-generic-question");
    const originalFingerprint = block.identity?.contentFingerprint;
    const inner = outer.querySelector(".question-item")!;
    inner.firstChild!.textContent = "A replacement question with changed live content. ";
    expect(observeLiveQuestion(block, outer).identity.contentFingerprint).not.toBe(originalFingerprint);
    let clicks = 0;
    controls.forEach((control) => control.addEventListener("click", () => clicks++));

    const filled = await fillParsedAnswerInPage(block, parseResult(block), { mode: "manual" });

    expect(filled).toMatchObject({ ok: false, filledCount: 0, code: "STALE_ACTION_PLAN" });
    expect(controls.every((control) => control.getAttribute("aria-checked") !== "true")).toBe(true);
    expect(clicks).toBe(0);
  });
});
