import { describe, expect, it } from "vitest";
import type { ActionPlan, AnswerPlan, QuestionBlock } from "@/shared/types";
import { buildControlMapping } from "./controlMapping";
import { buildActionPlan, executeTransaction } from "./transactionalExecutor";

const block: QuestionBlock = { id: "q12", bbox: { x: 0, y: 0, width: 800, height: 400 }, previewText: "12. A. a B. b C. c", questionTypeGuess: "single_choice", hasImage: false, confidence: 1, source: "auto_dom" };
function plan(key: string): AnswerPlan { return { schemaVersion: 1, kind: "single-choice", questionId: "q12", contentFingerprint: "q12", questionType: "single_choice", confidence: 1, source: "parse-result", answerSemanticHash: key, optionKeys: [key] }; }

describe("Phase 5 stale control validation", () => {
  it("REV-C1 rejects a connected option moved into Q13 without clicking", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <button>A. a</button><button id="c">C. c</button></section><section class="question-item" id="q13">13. <button>B. b</button></section>';
    const mapping = buildControlMapping(block, document.getElementById("q12")!); if (!mapping.ok) throw new Error(mapping.message);
    let clicks = 0; document.getElementById("c")!.addEventListener("click", () => clicks++);
    document.getElementById("q13")!.append(document.getElementById("c")!);
    expect((await executeTransaction(plan("C"), buildActionPlan(plan("C"), mapping), mapping)).outcome).toBe("STALE_ACTION_PLAN");
    expect(clicks).toBe(0);
  });

  it("REV-C2 rejects a disabled mapped option with zero mutation", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <button>A. a</button><button id="b">B. b</button></section>';
    const mapping = buildControlMapping(block, document.getElementById("q12")!); if (!mapping.ok) throw new Error(mapping.message);
    let clicks = 0; const button = document.getElementById("b") as HTMLButtonElement; button.addEventListener("click", () => clicks++); button.disabled = true;
    expect((await executeTransaction(plan("B"), buildActionPlan(plan("B"), mapping), mapping)).outcome).toBe("STALE_ACTION_PLAN");
    expect(clicks).toBe(0);
  });

  it("REV-C3 rejects a changed option semantic fingerprint", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <button>A. a</button><button id="b">B. b</button></section>';
    const mapping = buildControlMapping(block, document.getElementById("q12")!); if (!mapping.ok) throw new Error(mapping.message);
    const button = document.getElementById("b")!; button.textContent = "C. c";
    expect((await executeTransaction(plan("B"), buildActionPlan(plan("B"), mapping), mapping)).outcome).toBe("STALE_ACTION_PLAN");
  });

  it("TX-RADIO1 restores the originally selected native radio after verification failure", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <label><input id="a" type="radio" name="q">A. a</label><label><input id="b" type="radio" name="q" checked>B. b</label><label><input id="c" type="radio" name="q">C. c</label></section>';
    const mapping = buildControlMapping(block, document.getElementById("q12")!); if (!mapping.ok) throw new Error(mapping.message);
    const action: ActionPlan = { schemaVersion: 1, questionId: "q12", contentFingerprint: "q12", answerSemanticHash: "C", steps: [{ type: "select-option", controlId: mapping.options.get("A")!.controlId, optionKey: "A", desiredSelected: true }] };
    expect((await executeTransaction(plan("C"), action, mapping)).outcome).toBe("FILL_VERIFICATION_FAILED");
    expect((document.getElementById("b") as HTMLInputElement).checked).toBe(true); expect((document.getElementById("a") as HTMLInputElement).checked).toBe(false);
  });

  it("TX-RADIO2 reports rollback failure when the framework blocks restoring B", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <label><input id="a" type="radio" name="q">A. a</label><label><input id="b" type="radio" name="q" checked>B. b</label><label><input id="c" type="radio" name="q">C. c</label></section>';
    const mapping = buildControlMapping(block, document.getElementById("q12")!); if (!mapping.ok) throw new Error(mapping.message);
    (document.getElementById("b") as HTMLInputElement).addEventListener("click", (event) => event.preventDefault());
    const action: ActionPlan = { schemaVersion: 1, questionId: "q12", contentFingerprint: "q12", answerSemanticHash: "C", steps: [{ type: "select-option", controlId: mapping.options.get("A")!.controlId, optionKey: "A", desiredSelected: true }] };
    expect((await executeTransaction(plan("C"), action, mapping)).outcome).toBe("ROLLBACK_FAILED");
  });
});
