import { describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { fillParsedAnswerInPage } from "../answerFiller";
import { observeLiveQuestion } from "../liveQuestionObservation";
import { attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "../roots/rootContext";

type ChoiceKey = "A" | "B" | "C" | "D";
type ChoiceMode = "rerender" | "changed-question" | "duplicate-b" | "block-b" | "user-changes-a-on-b";

function makeChoiceQuestion(mode: ChoiceMode) {
  document.body.innerHTML = '<section class="question-item" id="q-rerender"><p class="stem">12. Select A and B. A. alpha B. beta C. gamma D. delta</p><div id="controls"></div></section>';
  const owner = document.getElementById("q-rerender")!;
  const stem = owner.querySelector(".stem")!;
  const controls = owner.querySelector("#controls")!;
  const selected = new Set<ChoiceKey>();
  const clicks: Array<{ key: ChoiceKey; generation: number }> = [];
  let generation = -1;

  const render = (duplicateB = false) => {
    generation += 1;
    const keys: ChoiceKey[] = ["A", "B", "C", "D"];
    controls.replaceChildren(...keys.map((key) => makeCheckbox(key)));
    if (duplicateB) controls.append(makeCheckbox("B"));
  };

  const makeCheckbox = (key: ChoiceKey) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = key;
    input.checked = selected.has(key);
    input.dataset.generation = String(generation);
    const optionText = document.createElement("span");
    optionText.textContent = `${key}. ${key.toLowerCase()} option`;
    label.append(input, optionText);
    input.addEventListener("click", () => {
      clicks.push({ key, generation: Number(input.dataset.generation) });
    });
    input.addEventListener("change", () => {
      if (mode === "block-b" && key === "B") {
        input.checked = false;
        return;
      }
      if (mode === "user-changes-a-on-b" && key === "B") {
        selected.clear();
        selected.add("B");
        render();
        return;
      }
      if (input.checked) selected.add(key);
      else selected.delete(key);
      if (mode === "changed-question" && key === "A") stem.textContent = "12. A different question has replaced the current one.";
      render(mode === "duplicate-b" && key === "A");
    });
    return label;
  };

  render();
  document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
  const draft: QuestionBlock = {
    id: "q-rerender",
    bbox: { x: 0, y: 0, width: 800, height: 400 },
    previewText: "12. Select A and B. A. alpha B. beta C. gamma D. delta",
    questionTypeGuess: "multi_choice",
    hasImage: false,
    confidence: 1,
    source: "auto_dom",
  };
  const block = attachRuntimeRoot(
    observeLiveQuestion(draft, owner),
    { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" },
    owner,
  );
  const result: ParseResult = {
    blockId: block.id,
    questionType: "multi_choice",
    answer: "A,B",
    confidence: 1,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: "",
    routeUsed: "text",
  };
  return { block, owner, selected, clicks, result };
}

function makeBlankQuestion() {
  document.body.innerHTML = '<section class="question-item" id="q-blanks"><p class="stem">12. Complete blanks (1) and (2).</p><div id="controls"></div></section>';
  const owner = document.getElementById("q-blanks")!;
  const controls = owner.querySelector("#controls")!;
  const values = ["", ""];
  const mutations: Array<{ blank: number; generation: number; value: string }> = [];
  let generation = -1;
  const render = () => {
    generation += 1;
    controls.replaceChildren(...values.map((value, index) => {
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("aria-label", `blank${index + 1}`);
      input.value = value;
      input.dataset.generation = String(generation);
      input.addEventListener("input", () => {
        mutations.push({ blank: index + 1, generation: Number(input.dataset.generation), value: input.value });
        values[index] = input.value;
        render();
      });
      return input;
    }));
  };
  render();
  document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
  const draft: QuestionBlock = {
    id: "q-blanks",
    bbox: { x: 0, y: 0, width: 800, height: 400 },
    previewText: "12. Complete blanks (1) and (2).",
    questionTypeGuess: "fill_blank",
    hasImage: false,
    confidence: 1,
    source: "auto_dom",
  };
  const block = attachRuntimeRoot(
    observeLiveQuestion(draft, owner),
    { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" },
    owner,
  );
  const result: ParseResult = {
    blockId: block.id,
    questionType: "fill_blank",
    answer: "(1) alpha; (2) beta",
    confidence: 1,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: "",
    routeUsed: "text",
  };
  return { block, owner, values, mutations, result };
}

describe("Phase 8B rerender-safe transaction commit", () => {
  it("TX-RERENDER-1 / TX-DETACHED-1 reacquires a replacement choice node before the next selection", async () => {
    const fixture = makeChoiceQuestion("rerender");

    const fill = await fillParsedAnswerInPage(fixture.block, fixture.result);

    expect(fill).toMatchObject({ ok: true, filledCount: 2 });
    expect([...fixture.selected].sort()).toEqual(["A", "B"]);
    expect(fixture.clicks).toEqual([{ key: "A", generation: 0 }, { key: "B", generation: 1 }]);
  });

  it("TX-RERENDER-2 reacquires each blank input after the first input event replaces the subtree", async () => {
    const fixture = makeBlankQuestion();

    const fill = await fillParsedAnswerInPage(fixture.block, fixture.result);

    expect(fill).toMatchObject({ ok: true, filledCount: 2 });
    expect(fixture.values).toEqual(["alpha", "beta"]);
    expect(fixture.mutations.map(({ blank, generation }) => [blank, generation])).toEqual([[1, 0], [2, 1]]);
  });

  it("TX-RERENDER-3 / TX-ROLLBACK-2 stops if the question identity changes and does not roll back into it", async () => {
    const fixture = makeChoiceQuestion("changed-question");

    const fill = await fillParsedAnswerInPage(fixture.block, fixture.result);

    expect(fill.code).toBe("PARTIAL_MUTATION_UNPROVABLE");
    expect(fixture.clicks).toEqual([{ key: "A", generation: 0 }]);
    expect([...fixture.selected]).toEqual(["A"]);
  });

  it("TX-RERENDER-4 stops when a fresh mapping is ambiguous", async () => {
    const fixture = makeChoiceQuestion("duplicate-b");

    const fill = await fillParsedAnswerInPage(fixture.block, fixture.result);

    expect(fill.code).toBe("PARTIAL_MUTATION_UNPROVABLE");
    expect(fixture.clicks).toEqual([{ key: "A", generation: 0 }]);
  });

  it("TX-ROLLBACK-1 restores the first selection through fresh controls after a later mutation fails", async () => {
    const fixture = makeChoiceQuestion("block-b");

    const fill = await fillParsedAnswerInPage(fixture.block, fixture.result);

    expect(fill.code).toBe("FILL_VERIFICATION_FAILED");
    expect(fill.filledCount).toBe(0);
    expect([...fixture.selected]).toEqual([]);
    expect(fixture.clicks).toEqual([{ key: "A", generation: 0 }, { key: "B", generation: 1 }, { key: "A", generation: 1 }]);
  });

  it("TX-ROLLBACK-3 preserves a user change made during the next control event", async () => {
    const fixture = makeChoiceQuestion("user-changes-a-on-b");

    const fill = await fillParsedAnswerInPage(fixture.block, fixture.result);

    expect(fill.code).toBe("USER_STATE_CHANGED");
    expect(fill.filledCount).toBe(0);
    expect([...fixture.selected]).toEqual(["B"]);
    expect(fixture.clicks).toEqual([{ key: "A", generation: 0 }, { key: "B", generation: 1 }]);
  });
});
