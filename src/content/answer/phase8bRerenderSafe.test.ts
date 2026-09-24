import { describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { fillParsedAnswerInPage } from "../answerFiller";
import { observeLiveQuestion } from "../liveQuestionObservation";
import { attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "../roots/rootContext";

const bbox = { x: 0, y: 0, width: 900, height: 500 };
const stem = "12. Choose the matching values for this rerender transaction.";

function choiceOwner(selected: string[] = [], questionText = stem): HTMLElement {
  const owner = document.createElement("section");
  owner.className = "question-item";
  owner.dataset.questionId = "phase8b-rerender";
  owner.innerHTML = `<p class="stem">${questionText}</p><div class="options">${["A", "B", "C"].map((key) =>
    `<button class="option" role="checkbox" aria-checked="${selected.includes(key)}">${key}. ${key === "A" ? "Alpha" : key === "B" ? "Beta" : "Gamma"}</button>`,
  ).join("")}</div>`;
  return owner;
}

function transactionBlock(owner: Element, questionType: QuestionBlock["questionTypeGuess"] = "multi_choice"): QuestionBlock {
  const block = observeLiveQuestion({
    id: "phase8b-rerender",
    bbox,
    previewText: owner.textContent ?? "",
    questionTypeGuess: questionType,
    hasImage: false,
    confidence: 1,
    source: "auto_dom",
  }, owner);
  return attachRuntimeRoot(block, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" }, owner);
}

function choiceResult(answer: string): ParseResult {
  return { blockId: "phase8b-rerender", questionType: "multi_choice", answer, confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
}

function armChoiceOwner(owner: HTMLElement, onClick: (key: string, owner: HTMLElement, button: HTMLElement) => void): void {
  owner.querySelectorAll<HTMLElement>("button.option").forEach((button) => {
    const key = button.textContent?.trim().charAt(0) ?? "";
    button.addEventListener("click", () => onClick(key, owner, button));
  });
}

function selectedKeys(owner: Element): string[] {
  return [...owner.querySelectorAll<HTMLElement>("button.option[aria-checked='true']")]
    .map((button) => button.textContent?.trim().charAt(0) ?? "")
    .sort();
}

function textOwner(values: string[]): HTMLElement {
  const owner = document.createElement("section");
  owner.className = "question-item";
  owner.dataset.questionId = "phase8b-rerender";
  owner.innerHTML = `<p class="stem">12. Complete (1) and (2) in this sentence.</p><label>Blank 1 <input data-blank-index="1" value="${values[0] ?? ""}"></label><label>Blank 2 <input data-blank-index="2" value="${values[1] ?? ""}"></label>`;
  return owner;
}

function textResult(): ParseResult {
  return { blockId: "phase8b-rerender", questionType: "fill_blank", answer: "(1) first; (2) second", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
}

describe("Phase 8B rerender-safe transactions", () => {
  it("TX-RERENDER1 resolves the next choice on an equivalent replacement owner", async () => {
    document.body.replaceChildren();
    let liveOwner = choiceOwner();
    document.body.append(liveOwner);
    const block = transactionBlock(liveOwner);
    let replaced = false;
    let oldBClicks = 0;
    let newBClicks = 0;
    const originalB = liveOwner.querySelector<HTMLElement>("button[role=checkbox]:nth-of-type(2)")!;
    originalB.addEventListener("click", () => { oldBClicks += 1; });
    armChoiceOwner(liveOwner, (key, owner) => {
      const next = [...new Set([...selectedKeys(owner), key])];
      owner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(next.includes(button.textContent?.trim().charAt(0) ?? ""))));
      if (key === "B" && owner !== liveOwner) newBClicks += 1;
      if (key === "A" && !replaced) {
        replaced = true;
        const replacement = choiceOwner(next);
        liveOwner.replaceWith(replacement);
        liveOwner = replacement;
        armChoiceOwner(liveOwner, (nextKey, nextOwner) => {
          const nextSelected = [...new Set([...selectedKeys(nextOwner), nextKey])];
          nextOwner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(nextSelected.includes(button.textContent?.trim().charAt(0) ?? ""))));
          if (nextKey === "B") newBClicks += 1;
        });
      }
    });

    const result = await fillParsedAnswerInPage(block, choiceResult("A,B"), { mode: "manual" });

    expect(result.ok).toBe(true);
    expect(selectedKeys(liveOwner)).toEqual(["A", "B"]);
    expect(oldBClicks).toBe(0);
    expect(newBClicks).toBe(1);
  });

  it("TX-RERENDER2 resolves each text event against the latest blank controls", async () => {
    document.body.replaceChildren();
    let liveOwner = textOwner(["", ""]);
    document.body.append(liveOwner);
    const block = transactionBlock(liveOwner, "fill_blank");
    const events: Array<{ generation: number; index: number; type: string }> = [];
    let generation = 0;
    const arm = (owner: HTMLElement, currentGeneration: number) => {
      owner.querySelectorAll<HTMLInputElement>("input[data-blank-index]").forEach((input) => {
        const index = Number(input.dataset.blankIndex);
        for (const type of ["input", "change", "keyup", "blur"]) {
          input.addEventListener(type, () => events.push({ generation: currentGeneration, index, type }));
        }
        input.addEventListener("input", () => {
          const values = [...owner.querySelectorAll<HTMLInputElement>("input[data-blank-index]")].map((item) => item.value);
          const replacement = textOwner(values);
          owner.replaceWith(replacement);
          liveOwner = replacement;
          generation += 1;
          arm(replacement, generation);
        });
      });
    };
    arm(liveOwner, generation);
    const firstInput = liveOwner.querySelector<HTMLInputElement>("input[data-blank-index='1']")!;

    const result = await fillParsedAnswerInPage(block, textResult(), { mode: "manual" });

    expect(result.ok).toBe(true);
    expect([...liveOwner.querySelectorAll<HTMLInputElement>("input[data-blank-index]")].map((input) => input.value)).toEqual(["first", "second"]);
    expect(events.filter((event) => event.generation === 0).map((event) => event.type)).toEqual(["input"]);
    expect(events.some((event) => event.generation > 0 && event.type === "change")).toBe(true);
    expect(firstInput.isConnected).toBe(false);
  });

  it("TX-RERENDER3 stops when the current owner changes semantic question", async () => {
    document.body.replaceChildren();
    const owner = choiceOwner();
    document.body.append(owner);
    const block = transactionBlock(owner);
    let secondClicks = 0;
    armChoiceOwner(owner, (key, currentOwner) => {
      if (key === "A") currentOwner.querySelector(".stem")!.textContent = "13. A different question replaced the current question.";
      if (key === "B") secondClicks += 1;
      currentOwner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(button.textContent?.trim().charAt(0) === key)));
    });

    const result = await fillParsedAnswerInPage(block, choiceResult("A,B"), { mode: "manual" });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("PARTIAL_MUTATION_UNPROVABLE");
    expect(result.stopAutomation).toBe(true);
    expect(secondClicks).toBe(0);
  });

  it("TX-RERENDER4 stops on duplicate semantic controls introduced by rerender", async () => {
    document.body.replaceChildren();
    const owner = choiceOwner();
    document.body.append(owner);
    const block = transactionBlock(owner);
    let secondClicks = 0;
    armChoiceOwner(owner, (key, currentOwner) => {
      currentOwner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(button.textContent?.trim().charAt(0) === key)));
      if (key === "A") {
        const duplicate = document.createElement("button");
        duplicate.className = "option";
        duplicate.setAttribute("role", "checkbox");
        duplicate.setAttribute("aria-checked", "false");
        duplicate.textContent = "B. duplicate Beta";
        currentOwner.querySelector(".options")!.append(duplicate);
      }
      if (key === "B") secondClicks += 1;
    });

    const result = await fillParsedAnswerInPage(block, choiceResult("A,B"), { mode: "manual" });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("PARTIAL_MUTATION_UNPROVABLE");
    expect(secondClicks).toBe(0);
  });

  it("TX-ROLLBACK1 restores through the replacement owner's fresh A mapping", async () => {
    document.body.replaceChildren();
    let liveOwner = choiceOwner();
    document.body.append(liveOwner);
    const block = transactionBlock(liveOwner);
    let replaced = false;
    let oldAClicks = 0;
    let newAClicks = 0;
    const originalA = liveOwner.querySelector<HTMLElement>("button.option")!;
    originalA.addEventListener("click", () => { oldAClicks += 1; });
    armChoiceOwner(liveOwner, (key, owner) => {
      if (key === "A") {
        const currentlySelected = selectedKeys(owner);
        const next = currentlySelected.includes("A") ? currentlySelected.filter((item) => item !== "A") : [...currentlySelected, "A"];
        owner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(next.includes(button.textContent?.trim().charAt(0) ?? ""))));
        if (!replaced) {
          replaced = true;
          const replacement = choiceOwner(next);
          owner.replaceWith(replacement);
          liveOwner = replacement;
          armChoiceOwner(liveOwner, (nextKey, nextOwner) => {
            if (nextKey === "B") return; // Simulate a control that refuses the second step.
            if (nextKey === "A") {
              newAClicks += 1;
              const selected = selectedKeys(nextOwner);
              const restored = selected.includes("A") ? selected.filter((item) => item !== "A") : [...selected, "A"];
              nextOwner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(restored.includes(button.textContent?.trim().charAt(0) ?? ""))));
            }
          });
        }
      }
    });

    const result = await fillParsedAnswerInPage(block, choiceResult("A,B"), { mode: "manual" });

    expect(result.ok).toBe(false);
    expect(result.rolledBack ?? result.code === "UNSUPPORTED_CONTROL").toBe(true);
    expect(selectedKeys(liveOwner)).toEqual([]);
    expect(oldAClicks).toBe(1);
    expect(newAClicks).toBe(1);
  });

  it("TX-ROLLBACK2 does not restore into a different semantic question", async () => {
    document.body.replaceChildren();
    const owner = choiceOwner();
    document.body.append(owner);
    const block = transactionBlock(owner);
    let actionAClicks = 0;
    let rollbackIntoOtherQuestion = 0;
    armChoiceOwner(owner, (key, currentOwner) => {
      if (key === "A") {
        if (actionAClicks > 0 && currentOwner.textContent?.includes("13.")) rollbackIntoOtherQuestion += 1;
        actionAClicks += 1;
        currentOwner.querySelector(".stem")!.textContent = "13. A different question replaced the current question.";
      }
      currentOwner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(button.textContent?.trim().charAt(0) === key)));
    });

    const result = await fillParsedAnswerInPage(block, choiceResult("A,B"), { mode: "manual" });

    expect(result.code).toBe("PARTIAL_MUTATION_UNPROVABLE");
    expect(actionAClicks).toBe(1);
    expect(rollbackIntoOtherQuestion).toBe(0);
  });

  it("TX-ROLLBACK3 preserves a user state change detected before rollback", async () => {
    document.body.replaceChildren();
    const owner = choiceOwner();
    document.body.append(owner);
    const block = transactionBlock(owner);
    armChoiceOwner(owner, (key, currentOwner) => {
      currentOwner.querySelectorAll<HTMLElement>("button.option").forEach((button) => {
        const option = button.textContent?.trim().charAt(0);
        button.setAttribute("aria-checked", String(key === "B" ? option === "B" : option === key));
      });
    });

    const result = await fillParsedAnswerInPage(block, choiceResult("A,B"), { mode: "manual" });

    expect(result.code).toBe("USER_STATE_CHANGED");
    expect(selectedKeys(owner)).toEqual(["B"]);
  });

  it("TX-DETACHED1 never dispatches a later action on a detached choice control", async () => {
    document.body.replaceChildren();
    let liveOwner = choiceOwner();
    document.body.append(liveOwner);
    const block = transactionBlock(liveOwner);
    let oldBClicks = 0;
    let newBClicks = 0;
    const oldB = liveOwner.querySelectorAll<HTMLElement>("button.option")[1]!;
    oldB.addEventListener("click", () => { oldBClicks += 1; throw new Error("detached B was reused"); });
    armChoiceOwner(liveOwner, (key, owner) => {
      const selected = [...new Set([...selectedKeys(owner), key])];
      owner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(selected.includes(button.textContent?.trim().charAt(0) ?? ""))));
      if (key === "A") {
        const replacement = choiceOwner(selected);
        owner.replaceWith(replacement);
        liveOwner = replacement;
        armChoiceOwner(replacement, (nextKey, nextOwner) => {
          if (nextKey === "B") newBClicks += 1;
          const next = [...new Set([...selectedKeys(nextOwner), nextKey])];
          nextOwner.querySelectorAll<HTMLElement>("button.option").forEach((button) => button.setAttribute("aria-checked", String(next.includes(button.textContent?.trim().charAt(0) ?? ""))));
        });
      }
    });

    const result = await fillParsedAnswerInPage(block, choiceResult("A,B"), { mode: "manual" });

    expect(result.ok).toBe(true);
    expect(oldBClicks).toBe(0);
    expect(newBClicks).toBe(1);
  });
});
