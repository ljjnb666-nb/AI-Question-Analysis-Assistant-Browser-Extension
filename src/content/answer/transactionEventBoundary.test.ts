import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { fillParsedAnswerInPage } from "../answerFiller";
import { observeLiveQuestion } from "../liveQuestionObservation";
import { attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "../roots/rootContext";
import { controlRegistry } from "./controlRegistry";

const choiceEvents = ["pointerover", "pointerenter", "pointerdown", "mouseover", "mousedown", "mouseup", "pointerup", "click"];
const staleChoiceEvents = ["mouseover", "mousedown", "mouseup", "pointerup", "click"];
const textEvents = ["input", "change", "keyup", "blur"];
let originalUrl = "";

function createBlock(owner: Element, type: "single_choice" | "fill_blank", previewText: string): QuestionBlock {
  const draft: QuestionBlock = {
    id: "event-boundary-question",
    bbox: { x: 0, y: 0, width: 700, height: 320 },
    previewText,
    questionTypeGuess: type,
    hasImage: false,
    confidence: 1,
    source: "auto_dom",
  };
  const observed = observeLiveQuestion(draft, owner);
  return attachRuntimeRoot(observed, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" }, owner);
}

function choiceResult(): ParseResult {
  return { blockId: "event-boundary-question", questionType: "single_choice", answer: "B", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
}

function blankResult(): ParseResult {
  return { blockId: "event-boundary-question", questionType: "fill_blank", answer: "(1) alpha", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
}

function installChoiceQuestion(rerenderAtPointerdown: boolean, routeChangeAtPointerdown = false) {
  document.body.innerHTML = '<section class="question-item" id="event-choice"><p class="stem">31. Choose one answer. A. Alpha B. Beta</p><div id="choices"></div></section>';
  const owner = document.getElementById("event-choice")!;
  const container = owner.querySelector("#choices")!;
  const selected = new Set<string>();
  const events: Array<{ type: string; key: string; generation: number; connected: boolean }> = [];
  const originalLaterEvents: string[] = [];
  let generation = 0;
  let replaced = false;

  const render = () => {
    const next = ["A", "B"].map((key) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "answer";
      input.value = key;
      input.checked = selected.has(key);
      input.dataset.generation = String(generation);
      const text = document.createTextNode(` ${key}. ${key === "A" ? "Alpha" : "Beta"}`);
      for (const type of choiceEvents) {
        input.addEventListener(type, () => {
          events.push({ type, key, generation: Number(input.dataset.generation), connected: input.isConnected });
          if (!input.isConnected && key === "B" && staleChoiceEvents.includes(type)) originalLaterEvents.push(type);
        });
      }
      input.addEventListener("pointerdown", () => {
        if (routeChangeAtPointerdown && key === "B") window.history.pushState({}, "", "/assignment/2");
        if (!rerenderAtPointerdown || replaced || key !== "B") return;
        replaced = true;
        generation += 1;
        render();
      });
      input.addEventListener("change", () => {
        selected.clear();
        selected.add(key);
        if (!replaced) {
          generation += 1;
          render();
        }
      });
      label.append(input, text);
      return label;
    });
    container.replaceChildren(...next);
  };

  render();
  return { owner, block: createBlock(owner, "single_choice", "31. Choose one answer. A. Alpha B. Beta"), events, selected, originalLaterEvents };
}

function installTextQuestion(rerenderAt: "focus" | "input", routeChangeAtInput = false) {
  document.body.innerHTML = '<section class="question-item" id="event-text"><p class="stem">32. Complete blank (1).</p><div id="text-control"></div></section>';
  const owner = document.getElementById("event-text")!;
  const container = owner.querySelector("#text-control")!;
  let value = "";
  let generation = 0;
  let replaced = false;
  const firstInputEvents: string[] = [];
  const currentEvents: Array<{ type: string; generation: number; connected: boolean }> = [];
  let firstInput: HTMLInputElement | undefined;

  const render = () => {
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("aria-label", "blank1");
    input.value = value;
    input.dataset.generation = String(generation);
    if (!firstInput) firstInput = input;
    for (const type of ["focus", ...textEvents]) {
      input.addEventListener(type, () => {
        currentEvents.push({ type, generation: Number(input.dataset.generation), connected: input.isConnected });
        if (input === firstInput) firstInputEvents.push(type);
      });
    }
    input.addEventListener("focus", () => {
      if (rerenderAt !== "focus" || replaced) return;
      replaced = true;
      generation += 1;
      render();
    });
    input.addEventListener("input", () => {
      value = input.value;
      if (routeChangeAtInput) window.history.pushState({}, "", "/assignment/2");
      if (rerenderAt !== "input" || replaced) return;
      replaced = true;
      generation += 1;
      render();
    });
    container.replaceChildren(input);
  };

  render();
  return {
    block: createBlock(owner, "fill_blank", "32. Complete blank (1)."),
    get value() { return value; },
    get firstInput() { return firstInput!; },
    firstInputEvents,
    currentEvents,
  };
}

beforeEach(() => {
  originalUrl = location.href;
});

afterEach(() => {
  window.history.replaceState({}, "", originalUrl);
  controlRegistry.clear();
  document.body.innerHTML = "";
});

describe("Phase 8B event-boundary authority", () => {
  it("EVENT-CHOICE-ORDER-1 preserves the Phase 5 choice gesture sequence", async () => {
    const fixture = installChoiceQuestion(false);

    const fill = await fillParsedAnswerInPage(fixture.block, choiceResult());

    expect(fill.ok).toBe(true);
    expect(fixture.events.filter(({ key }) => key === "B").map(({ type }) => type)).toEqual(choiceEvents);
    expect([...fixture.selected]).toEqual(["B"]);
  });

  it("EVENT-CHOICE-POINTERDOWN-RERENDER-1 sends no later gesture events to the detached target", async () => {
    const fixture = installChoiceQuestion(true);

    const fill = await fillParsedAnswerInPage(fixture.block, choiceResult());

    expect(fill.ok).toBe(true);
    expect(fixture.originalLaterEvents).toEqual([]);
    expect(fixture.events.filter(({ key }) => key === "B").map(({ type, generation }) => [type, generation])).toEqual([
      ["pointerover", 0], ["pointerenter", 0], ["pointerdown", 0],
      ["mouseover", 1], ["mousedown", 1], ["mouseup", 1], ["pointerup", 1], ["click", 1],
    ]);
    expect([...fixture.selected]).toEqual(["B"]);
  });

  it("ROUTE-EVENT-1 stops at pointerdown when the route changes without changing the question", async () => {
    const fixture = installChoiceQuestion(false, true);

    const fill = await fillParsedAnswerInPage(fixture.block, choiceResult());

    expect(fill).toMatchObject({ ok: false, filledCount: 0, code: "PARTIAL_MUTATION_UNPROVABLE" });
    expect(fixture.events.filter(({ key }) => key === "B").map(({ type }) => type)).toEqual([
      "pointerover", "pointerenter", "pointerdown",
    ]);
    expect(fixture.selected).toEqual(new Set());
  });

  it("EVENT-TEXT-FOCUS-RERENDER-1 reacquires the input before the native setter or later events", async () => {
    const fixture = installTextQuestion("focus");

    const fill = await fillParsedAnswerInPage(fixture.block, blankResult());

    expect(fill.ok).toBe(true);
    expect(fixture.firstInput.value).toBe("");
    expect(fixture.firstInputEvents).toEqual(["focus"]);
    expect(fixture.value).toBe("alpha");
    expect(fixture.currentEvents.filter(({ generation }) => generation === 1).map(({ type }) => type)).toEqual(textEvents);
  });

  it("EVENT-TEXT-INPUT-RERENDER-1 sends no change, keyup, or blur to the detached input", async () => {
    const fixture = installTextQuestion("input");

    const fill = await fillParsedAnswerInPage(fixture.block, blankResult());

    expect(fill.ok).toBe(true);
    expect(fixture.firstInput.value).toBe("alpha");
    expect(fixture.firstInputEvents).toEqual(["focus", "input"]);
    expect(fixture.value).toBe("alpha");
    expect(fixture.currentEvents.filter(({ generation }) => generation === 1).map(({ type }) => type)).toEqual(["change", "keyup", "blur"]);
  });

  it("ROUTE-TEXT-1 stops the text event sequence when input navigation rerenders an equivalent control", async () => {
    const fixture = installTextQuestion("input", true);

    const fill = await fillParsedAnswerInPage(fixture.block, blankResult());

    expect(fill).toMatchObject({ ok: false, filledCount: 0, code: "PARTIAL_MUTATION_UNPROVABLE" });
    expect(fixture.firstInputEvents).toEqual(["focus", "input"]);
    expect(fixture.value).toBe("alpha");
    expect(fixture.currentEvents.filter(({ generation }) => generation === 1)).toEqual([]);
  });
});
