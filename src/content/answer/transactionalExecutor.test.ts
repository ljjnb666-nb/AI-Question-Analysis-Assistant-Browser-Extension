import { describe, expect, it } from "vitest";
import type { ActionPlan, AnswerPlan, QuestionBlock } from "@/shared/types";
import { buildControlMapping } from "./controlMapping";
import { buildActionPlan, executeTransaction } from "./transactionalExecutor";
import { attachQuestionIdentity } from "../questionIdentity";
import { attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "../roots/rootContext";

function blockFor(owner: Element): QuestionBlock {
  const draft: QuestionBlock = { id: "q12", bbox: { x: 0, y: 0, width: 800, height: 400 }, previewText: "12. A. a B. b C. c", questionTypeGuess: "single_choice", hasImage: false, confidence: 1, source: "auto_dom" };
  const identified = attachQuestionIdentity(draft, owner, { identityText: draft.previewText });
  return attachRuntimeRoot(identified, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" }, owner);
}
function identity(block: QuestionBlock) { return { questionId: block.identity?.stableId ?? block.id, contentFingerprint: block.identity?.contentFingerprint ?? block.id }; }
function plan(key: string, block: QuestionBlock): AnswerPlan { return { schemaVersion: 1, kind: "single-choice", ...identity(block), questionType: "single_choice", confidence: 1, source: "parse-result", answerSemanticHash: key, optionKeys: [key] }; }

describe("Phase 5 stale control validation", () => {
  it("REV-C1 rejects a connected option moved into Q13 without clicking", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <button>A. a</button><button id="c">C. c</button></section><section class="question-item" id="q13">13. <button>B. b</button></section>';
    const owner = document.getElementById("q12")!; const block = blockFor(owner);
    const mapping = buildControlMapping(block, owner); if (!mapping.ok) throw new Error(mapping.message);
    let clicks = 0; document.getElementById("c")!.addEventListener("click", () => clicks++);
    document.getElementById("q13")!.append(document.getElementById("c")!);
    expect((await executeTransaction(plan("C", block), buildActionPlan(plan("C", block), mapping), mapping)).outcome).toBe("STALE_ACTION_PLAN");
    expect(clicks).toBe(0);
  });

  it("REV-C2 rejects a disabled mapped option with zero mutation", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <button>A. a</button><button id="b">B. b</button></section>';
    const owner = document.getElementById("q12")!; const block = blockFor(owner);
    const mapping = buildControlMapping(block, owner); if (!mapping.ok) throw new Error(mapping.message);
    let clicks = 0; const button = document.getElementById("b") as HTMLButtonElement; button.addEventListener("click", () => clicks++); button.disabled = true;
    expect((await executeTransaction(plan("B", block), buildActionPlan(plan("B", block), mapping), mapping)).outcome).toBe("STALE_ACTION_PLAN");
    expect(clicks).toBe(0);
  });

  it("REV-C3 rejects a changed option semantic fingerprint", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <button>A. a</button><button id="b">B. b</button></section>';
    const owner = document.getElementById("q12")!; const block = blockFor(owner);
    const mapping = buildControlMapping(block, owner); if (!mapping.ok) throw new Error(mapping.message);
    const button = document.getElementById("b")!; button.textContent = "C. c";
    expect((await executeTransaction(plan("B", block), buildActionPlan(plan("B", block), mapping), mapping)).outcome).toBe("STALE_ACTION_PLAN");
  });

  it("TX-RADIO1 restores the originally selected native radio after verification failure", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <label><input id="a" type="radio" name="q">A. a</label><label><input id="b" type="radio" name="q" checked>B. b</label><label><input id="c" type="radio" name="q">C. c</label></section>';
    const owner = document.getElementById("q12")!; const block = blockFor(owner);
    const mapping = buildControlMapping(block, owner); if (!mapping.ok) throw new Error(mapping.message);
    const action: ActionPlan = { schemaVersion: 1, ...identity(block), answerSemanticHash: "C", steps: [{ type: "select-option", controlId: mapping.options.get("A")!.controlId, optionKey: "A", desiredSelected: true }] };
    expect((await executeTransaction(plan("C", block), action, mapping)).outcome).toBe("FILL_VERIFICATION_FAILED");
    expect((document.getElementById("b") as HTMLInputElement).checked).toBe(true); expect((document.getElementById("a") as HTMLInputElement).checked).toBe(false);
  });

  it("TX-RADIO2 reports rollback failure when the framework blocks restoring B", async () => {
    document.body.innerHTML = '<section class="question-item" id="q12">12. <label><input id="a" type="radio" name="q">A. a</label><label><input id="b" type="radio" name="q" checked>B. b</label><label><input id="c" type="radio" name="q">C. c</label></section>';
    const owner = document.getElementById("q12")!; const block = blockFor(owner);
    const mapping = buildControlMapping(block, owner); if (!mapping.ok) throw new Error(mapping.message);
    (document.getElementById("b") as HTMLInputElement).addEventListener("click", (event) => event.preventDefault());
    const action: ActionPlan = { schemaVersion: 1, ...identity(block), answerSemanticHash: "C", steps: [{ type: "select-option", controlId: mapping.options.get("A")!.controlId, optionKey: "A", desiredSelected: true }] };
    expect((await executeTransaction(plan("C", block), action, mapping)).outcome).toBe("ROLLBACK_FAILED");
  });
});
