import type { ActionPlan, AnswerPlan } from "@/shared/types";
import { applyTextValue, clickElement } from "../answerDomUtils";
import { controlRegistry, type ControlRef } from "./controlRegistry";
import { controlIsVisibleAndEnabled, semanticFingerprintForControl, type ControlMappingResult } from "./controlMapping";

export type FillOutcome = "FILLED_VERIFIED" | "NO_CHANGE_NEEDED" | "CONTROL_MAPPING_AMBIGUOUS" | "STALE_ACTION_PLAN" | "USER_STATE_CHANGED" | "FILL_VERIFICATION_FAILED" | "ROLLBACK_FAILED" | "UNSUPPORTED_CONTROL";
export type TransactionResult = { outcome: FillOutcome; filledCount: number; message: string };
type Snapshot = Map<string, string | boolean>;
export const MIN_AUTOFILL_MAPPING_CONFIDENCE = 0.9;

export function buildActionPlan(plan: AnswerPlan, mapping: Extract<ControlMappingResult, { ok: true }>): ActionPlan {
  const steps: ActionPlan["steps"] = [];
  const selected = new Set([...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key));
  if (plan.kind === "single-choice" || plan.kind === "multiple-choice" || plan.kind === "boolean") {
    const desired = new Set(plan.kind === "boolean" ? [plan.optionKey!] : plan.optionKeys);
    for (const [key, ref] of mapping.options) {
      if (desired.has(key) && !selected.has(key)) steps.push({ type: "select-option", controlId: ref.controlId, optionKey: key, desiredSelected: true });
      if (plan.kind === "multiple-choice" && !desired.has(key) && selected.has(key)) steps.push({ type: "clear-option", controlId: ref.controlId, optionKey: key, desiredSelected: false });
    }
  } else if (plan.kind === "fill-blank") for (const blank of plan.blanks) { const ref = mapping.blanks[blank.index]; if (ref && readValue(ref) !== normalize(blank.value)) steps.push({ type: "set-text", controlId: ref.controlId, value: blank.value, blankIndex: blank.index }); }
  else if (plan.kind === "short-answer" && mapping.text && readValue(mapping.text) !== normalize(plan.value)) steps.push({ type: "set-text", controlId: mapping.text.controlId, value: plan.value });
  return { schemaVersion: 1, questionId: plan.questionId, contentFingerprint: plan.contentFingerprint, answerSemanticHash: plan.answerSemanticHash, steps };
}

export function snapshotControls(mapping: Extract<ControlMappingResult, { ok: true }>): Snapshot { return new Map([...mapping.options.values(), ...mapping.blanks].map((ref) => [ref.controlId, readRaw(ref)])); }
export async function executeTransaction(plan: AnswerPlan, action: ActionPlan, mapping: Extract<ControlMappingResult, { ok: true }>, solveSnapshot?: Snapshot): Promise<TransactionResult> {
  if (mapping.confidence < MIN_AUTOFILL_MAPPING_CONFIDENCE) return { outcome: "CONTROL_MAPPING_AMBIGUOUS", filledCount: 0, message: "Mapping confidence is below automatic-fill threshold" };
  if (action.questionId !== plan.questionId || action.contentFingerprint !== plan.contentFingerprint || !revalidate(mapping, plan)) return { outcome: "STALE_ACTION_PLAN", filledCount: 0, message: "Question revision or control mapping is stale" };
  const before = snapshotControls(mapping);
  if (solveSnapshot && !sameSnapshot(solveSnapshot, before)) return { outcome: "USER_STATE_CHANGED", filledCount: 0, message: "User changed answer after solve started; no overwrite" };
  if (!action.steps.length) return verifyAnswerPlan(plan, mapping) ? { outcome: "NO_CHANGE_NEEDED", filledCount: 0, message: "Answer already verified" } : { outcome: "FILL_VERIFICATION_FAILED", filledCount: 0, message: "Existing state does not verify" };
  let changed = 0;
  for (const step of action.steps) {
    const ref = findRef(mapping, step.controlId); if (!ref || !perform(step, ref)) return rollback(before, mapping, "UNSUPPORTED_CONTROL");
    changed += 1;
  }
  return verifyAnswerPlan(plan, mapping) ? { outcome: "FILLED_VERIFIED", filledCount: changed, message: "Filled and verified by DOM readback" } : rollback(before, mapping, "FILL_VERIFICATION_FAILED");
}
function revalidate(mapping: Extract<ControlMappingResult, { ok: true }>, plan: AnswerPlan) {
  return mapping.questionId === plan.questionId && mapping.owner.isConnected && [...mapping.options.values(), ...mapping.blanks].every((ref) => {
    const entry = controlRegistry.metadata(ref.controlId); const el = entry?.element;
    if (!el) return false;
    const currentOwner = el?.closest(".question-item,.questionBox,.base-question-component,[data-question-id],[data-questionid],[data-problem-id],[data-problemid],[data-item-id]");
    return entry?.questionId === plan.questionId
      && entry.owner === mapping.owner
      && Boolean(el?.isConnected && mapping.owner.contains(el) && currentOwner === mapping.owner)
      && controlIsVisibleAndEnabled(el)
      && semanticFingerprintForControl(el, ref) === ref.semanticFingerprint;
  });
}
function perform(step: ActionPlan["steps"][number], ref: ControlRef) { const el = controlRegistry.get(ref.controlId); if (!el || !el.isConnected) return false; if (step.type === "set-text") return applyTextValue(el, step.value) || normalize(readValue(ref)) === normalize(step.value); if (step.type === "clear-text") return applyTextValue(el, "") || !readValue(ref); const desired = step.desiredSelected; if (isSelected(ref) === desired) return true; if (ref.controlType === "radio" || ref.controlType === "checkbox" || ref.controlType === "custom-choice") { clickElement(el); return isSelected(ref) === desired; } return false; }
function rollback(snapshot: Snapshot, mapping: Extract<ControlMappingResult, { ok: true }>, failure: "UNSUPPORTED_CONTROL" | "FILL_VERIFICATION_FAILED"): TransactionResult { let ok = true;
  // Restore selected radio first: native radio semantics clear peers; never try to uncheck a radio by clicking itself.
  for (const [id, value] of snapshot) { const ref = findRef(mapping, id); const el = ref && controlRegistry.get(id); if (value === true && ref?.controlType === "radio" && el && !isSelected(ref)) clickElement(el); }
  for (const [id, value] of snapshot) { const ref = findRef(mapping, id); if (!ref) { ok = false; continue; } const el = controlRegistry.get(id); if (!el) { ok = false; continue; } if (typeof value === "boolean") { if (isSelected(ref) !== value && ref.controlType !== "radio") { clickElement(el); if (isSelected(ref) !== value) ok = false; } else if (isSelected(ref) !== value) ok = false; } else if (normalize(readValue(ref)) !== normalize(value) && !applyTextValue(el, value)) ok = false; } return ok ? { outcome: failure, filledCount: 0, message: `${failure}; original state restored` } : { outcome: "ROLLBACK_FAILED", filledCount: 0, message: "Rollback could not restore original state" }; }
export function verifyAnswerPlan(plan: AnswerPlan, mapping: Extract<ControlMappingResult, { ok: true }>) { if (plan.kind === "single-choice" || plan.kind === "multiple-choice" || plan.kind === "boolean") { const expected = new Set(plan.kind === "boolean" ? [plan.optionKey!] : plan.optionKeys); const actual = new Set([...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key)); return expected.size === actual.size && [...expected].every((key) => actual.has(key)); } if (plan.kind === "fill-blank") return plan.blanks.every((blank) => normalize(readValue(mapping.blanks[blank.index])) === normalize(blank.value)); return Boolean(mapping.text) && normalize(readValue(mapping.text!)) === normalize(plan.value); }
export function readSelectedOptionKeys(mapping: Extract<ControlMappingResult, { ok: true }>) { return [...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key).sort(); }
function findRef(mapping: Extract<ControlMappingResult, { ok: true }>, id: string) { return [...mapping.options.values(), ...mapping.blanks].find((ref) => ref.controlId === id) ?? null; }
function isSelected(ref: ControlRef) { const el = controlRegistry.get(ref.controlId); return el instanceof HTMLInputElement ? el.checked : el?.getAttribute("aria-checked") === "true" || Boolean(el?.classList.contains("is-choose") || el?.classList.contains("selected") || el?.classList.contains("active")); }
function readRaw(ref: ControlRef): string | boolean { return ref.role === "option" ? isSelected(ref) : readValue(ref); }
function readValue(ref: ControlRef) { const el = controlRegistry.get(ref.controlId); return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el?.textContent ?? ""; }
function normalize(value: string) { return String(value).normalize("NFC").replace(/\r\n?/g, "\n").trim(); }
function sameSnapshot(a: Snapshot, b: Snapshot) { return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value); }
