import type { ActionPlan, AnswerPlan } from "@/shared/types";
import { isHTMLInputInOwnerRealm, isHTMLTextAreaInOwnerRealm } from "../domRealm";
import { applyTextValue, clickElement } from "../answerDomUtils";
import type { FillAnswerCode } from "../answerTypes";
import { controlRegistry, type ControlRef } from "./controlRegistry";
import { controlIsVisibleAndEnabled, semanticFingerprintForControl, type ControlMappingResult } from "./controlMapping";

type Mapping = Extract<ControlMappingResult, { ok: true }>;
export type SemanticControlSnapshot = Map<string, string | boolean>;
export type CurrentTransactionAuthority =
  | { ok: true; mapping: Mapping; stableId: string; contentFingerprint: string; rootKey: string; rootGeneration: number }
  | { ok: false; code: FillAnswerCode; message: string };
export type ResolveCurrentTransactionAuthority = () => CurrentTransactionAuthority;
export type FillOutcome = FillAnswerCode;
export type TransactionResult = { outcome: FillOutcome; filledCount: number; message: string };

type AppliedMutation = { before: SemanticControlSnapshot; after: SemanticControlSnapshot };
export const MIN_AUTOFILL_MAPPING_CONFIDENCE = 0.9;

export function buildActionPlan(plan: AnswerPlan, mapping: Mapping): ActionPlan {
  const steps: ActionPlan["steps"] = [];
  const selected = new Set([...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key));
  if (plan.kind === "single-choice" || plan.kind === "multiple-choice" || plan.kind === "boolean") {
    const desired = new Set(plan.kind === "boolean" ? [plan.optionKey!] : plan.optionKeys);
    for (const [key, ref] of mapping.options) {
      if (desired.has(key) && !selected.has(key)) steps.push({ type: "select-option", controlId: ref.controlId, optionKey: key, desiredSelected: true });
      if (plan.kind === "multiple-choice" && !desired.has(key) && selected.has(key)) steps.push({ type: "clear-option", controlId: ref.controlId, optionKey: key, desiredSelected: false });
    }
  } else if (plan.kind === "fill-blank") {
    for (const blank of plan.blanks) {
      const ref = mapping.blanks[blank.index];
      if (ref && readValue(ref) !== normalize(blank.value)) steps.push({ type: "set-text", controlId: ref.controlId, value: blank.value, blankIndex: blank.index });
    }
  } else if (plan.kind === "short-answer" && mapping.text && readValue(mapping.text) !== normalize(plan.value)) {
    steps.push({ type: "set-text", controlId: mapping.text.controlId, value: plan.value });
  }
  return { schemaVersion: 1, questionId: plan.questionId, contentFingerprint: plan.contentFingerprint, answerSemanticHash: plan.answerSemanticHash, steps };
}

export function snapshotControls(mapping: Mapping): SemanticControlSnapshot {
  const snapshot: SemanticControlSnapshot = new Map();
  for (const [key, ref] of mapping.options) snapshot.set(optionKey(key), readRaw(ref));
  mapping.blanks.forEach((ref, index) => { if (ref) snapshot.set(blankKey(ref.blankIndex ?? index), readRaw(ref)); });
  return snapshot;
}

/** One current authority resolution per semantic mutation and after each event boundary. */
export async function executeTransaction(
  plan: AnswerPlan,
  action: ActionPlan,
  initialMapping: Mapping,
  solveSnapshot: SemanticControlSnapshot | undefined,
  resolveAuthority: ResolveCurrentTransactionAuthority,
): Promise<TransactionResult> {
  if (action.questionId !== plan.questionId || action.contentFingerprint !== plan.contentFingerprint
    || action.answerSemanticHash !== plan.answerSemanticHash || initialMapping.questionId !== plan.questionId) {
    return result("STALE_ACTION_PLAN", "Action plan no longer matches the answer plan");
  }

  const firstResolution = resolveSafely(resolveAuthority, false);
  if (!firstResolution.ok) return result(firstResolution.code, firstResolution.message);
  const rootKey = firstResolution.rootKey;
  const rootGeneration = firstResolution.rootGeneration;
  const targetSet = semanticKeys(initialMapping);
  const first = validateResolution(firstResolution, plan, rootKey, rootGeneration, targetSet);
  if (!first.ok) return result(first.code, first.message);
  const initial = snapshotControls(first.mapping);
  if (solveSnapshot && !sameSnapshot(solveSnapshot, initial)) return result("USER_STATE_CHANGED", "User changed answer after solve started; no overwrite");
  if (!action.steps.length) return verifyAnswerPlan(plan, first.mapping)
    ? result("NO_CHANGE_NEEDED", "Answer already verified")
    : result("FILL_VERIFICATION_FAILED", "Existing state does not verify");

  const ledger: AppliedMutation[] = [];
  let expected = initial;
  for (const step of action.steps) {
    const resolution = resolveSafely(resolveAuthority, ledger.length > 0);
    if (!resolution.ok) return failAndRollback(resolution.code, resolution.message, ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
    const current = validateResolution(resolution, plan, rootKey, rootGeneration, targetSet);
    if (!current.ok) return failAndRollback(current.code, current.message, ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
    const before = snapshotControls(current.mapping);
    if (!sameSnapshot(expected, before)) return result("USER_STATE_CHANGED", "Live answer state changed outside the authorized transaction");

    const target = resolveStepTarget(step, plan, current.mapping);
    const key = target && semanticKey(target);
    if (!target || !key || !before.has(key)) return failAndRollback("CONTROL_MAPPING_CHANGED", "Semantic mutation target is no longer uniquely mapped", ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);

    let threw = false;
    try { perform(step, target); } catch { threw = true; }

    // Even a throwing event handler may have changed the page; old refs are
    // discarded and the live question is resolved again before any decision.
    const afterResolution = resolveSafely(resolveAuthority, true);
    if (!afterResolution.ok) return result("PARTIAL_MUTATION_UNPROVABLE", `Post-mutation authority lost: ${afterResolution.code}`);
    const afterAuthority = validateResolution(afterResolution, plan, rootKey, rootGeneration, targetSet);
    if (!afterAuthority.ok) return result("PARTIAL_MUTATION_UNPROVABLE", `Post-mutation authority lost: ${afterAuthority.code}`);
    const after = snapshotControls(afterAuthority.mapping);
    if (after.get(key) !== desiredValue(step)) {
      if (sameSnapshot(before, after)) return failAndRollback(threw ? "UNSUPPORTED_CONTROL" : "FILL_VERIFICATION_FAILED", "Mutation did not produce the requested semantic state", ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
      return result("PARTIAL_MUTATION_UNPROVABLE", "Mutation changed live state without producing the requested semantic value");
    }
    if (!stepChangesAreOwned(step, target, before, after, current.mapping, plan)) {
      return result("USER_STATE_CHANGED", "A control outside the current mutation changed during the event; live state was preserved");
    }
    if (!sameSnapshot(before, after)) ledger.push({ before, after });
    expected = after;
    if (threw) return failAndRollback("UNSUPPORTED_CONTROL", "Page handler threw during a fill mutation", ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
  }

  const finalResolution = resolveSafely(resolveAuthority, ledger.length > 0);
  if (!finalResolution.ok) return failAndRollback(finalResolution.code, finalResolution.message, ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
  const final = validateResolution(finalResolution, plan, rootKey, rootGeneration, targetSet);
  if (!final.ok) return failAndRollback(final.code, final.message, ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
  const finalState = snapshotControls(final.mapping);
  if (!sameSnapshot(expected, finalState)) return result("USER_STATE_CHANGED", "Live answer state changed before final verification");
  return verifyAnswerPlan(plan, final.mapping)
    ? result("FILLED_VERIFIED", "Filled and verified using fresh live controls", ledger.length)
    : failAndRollback("FILL_VERIFICATION_FAILED", "Fresh live DOM readback did not match the answer", ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
}

function validateResolution(
  resolution: Extract<CurrentTransactionAuthority, { ok: true }>,
  plan: AnswerPlan,
  rootKey: string,
  rootGeneration: number,
  expectedKeys: string[],
): { ok: true; mapping: Mapping } | { ok: false; code: FillAnswerCode; message: string } {
  const { mapping } = resolution;
  if (resolution.stableId !== plan.questionId || resolution.contentFingerprint !== plan.contentFingerprint
    || resolution.rootKey !== rootKey || resolution.rootGeneration !== rootGeneration
    || mapping.questionId !== plan.questionId || !mapping.owner.isConnected) {
    return { ok: false, code: "STALE_ACTION_PLAN", message: "Question, runtime owner, or root authority changed" };
  }
  if (mapping.confidence < MIN_AUTOFILL_MAPPING_CONFIDENCE || !sameStrings(expectedKeys, semanticKeys(mapping))) {
    return { ok: false, code: "CONTROL_MAPPING_CHANGED", message: "Fresh controls no longer have the exact semantic target set" };
  }
  if (!mappingIsCurrent(mapping)) return { ok: false, code: "STALE_ACTION_PLAN", message: "Fresh mapping failed live ownership validation" };
  return { ok: true, mapping };
}

function mappingIsCurrent(mapping: Mapping): boolean {
  return [...mapping.options.values(), ...mapping.blanks].every((ref) => {
    const entry = controlRegistry.metadata(ref.controlId);
    const element = entry?.element;
    if (!element) return false;
    const owner = element.closest(".question-item,.questionBox,.base-question-component,[data-question-id],[data-questionid],[data-problem-id],[data-problemid],[data-item-id]");
    return entry.questionId === mapping.questionId && entry.owner === mapping.owner
      && element.isConnected && mapping.owner.contains(element) && owner === mapping.owner
      && controlIsVisibleAndEnabled(element) && semanticFingerprintForControl(element, ref) === ref.semanticFingerprint;
  });
}

function failAndRollback(
  failure: FillAnswerCode, message: string, ledger: AppliedMutation[], plan: AnswerPlan,
  rootKey: string, rootGeneration: number, targetSet: string[], resolveAuthority: ResolveCurrentTransactionAuthority,
): TransactionResult {
  if (!ledger.length) return result(failure, message);
  if (failure === "USER_STATE_CHANGED" || failure === "PARTIAL_MUTATION_UNPROVABLE" || failure === "ROLLBACK_AUTHORITY_LOST") return result(failure, message);
  const rollback = rollbackLedger(ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
  if (rollback === "USER_STATE_CHANGED") return result("USER_STATE_CHANGED", "User or framework changed state; rollback preserved the live value");
  if (!rollback) return result("PARTIAL_MUTATION_UNPROVABLE", `Rollback could not prove current authority: ${message}`);
  return result(failure, `${failure}; original semantic state restored`);
}

function resolveSafely(resolveAuthority: ResolveCurrentTransactionAuthority, afterMutation: boolean): CurrentTransactionAuthority {
  try {
    return resolveAuthority();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: afterMutation ? "PARTIAL_MUTATION_UNPROVABLE" : "CONTROL_MAPPING_CHANGED",
      message: `Fresh transaction authority resolution threw: ${message}`,
    };
  }
}

function stepChangesAreOwned(
  step: ActionPlan["steps"][number],
  target: ControlRef,
  before: SemanticControlSnapshot,
  after: SemanticControlSnapshot,
  mapping: Mapping,
  plan: AnswerPlan,
): boolean {
  const targetKey = semanticKey(target);
  if (!targetKey) return false;
  const changed = [...before].filter(([key, value]) => after.get(key) !== value).map(([key]) => key);
  if (!changed.includes(targetKey)) return changed.length === 0;

  const collateral = changed.filter((key) => key !== targetKey);
  if (!collateral.length) return true;

  // A single-choice action can clear the previous selection through native
  // radio behavior or the page's own controlled choice handler.
  if ((plan.kind !== "single-choice" && plan.kind !== "boolean")
    || (step.type !== "select-option" && step.type !== "clear-option")) return false;
  return collateral.every((key) => {
    return key.startsWith("option:") && before.get(key) === true && after.get(key) === false;
  });
}

/** Reverse ledger entries using fresh semantic targets. DOM elements are never stored in the ledger. */
function rollbackLedger(
  ledger: AppliedMutation[], plan: AnswerPlan, rootKey: string, rootGeneration: number,
  targetSet: string[], resolveAuthority: ResolveCurrentTransactionAuthority,
): true | "USER_STATE_CHANGED" | false {
  for (const entry of [...ledger].reverse()) {
    let turns = 0;
    while (true) {
      if (turns++ > targetSet.length + 2) return false;
      const resolution = resolveSafely(resolveAuthority, true);
      if (!resolution.ok) return false;
      const current = validateResolution(resolution, plan, rootKey, rootGeneration, targetSet);
      if (!current.ok) return false;
      const state = snapshotControls(current.mapping);
      if (!rollbackStateIsOwned(state, entry)) return "USER_STATE_CHANGED";
      if (sameSnapshot(state, entry.before)) break;

      const pending = changedKeys(entry).filter((key) => state.get(key) !== entry.before.get(key));
      const order = [
        ...pending.filter((key) => key.startsWith("option:") && entry.before.get(key) === true),
        ...pending.filter((key) => !(key.startsWith("option:") && entry.before.get(key) === true)),
      ];
      const key = order.find((candidate) => {
        const ref = resolveSemanticKey(current.mapping, candidate);
        return !(candidate.startsWith("option:") && entry.before.get(candidate) === false && ref?.controlType === "radio");
      });
      if (!key) return false;
      const ref = resolveSemanticKey(current.mapping, key);
      if (!ref) return false;
      const desired = entry.before.get(key);
      if (desired === undefined) return false;
      if (typeof desired === "boolean") {
        if (!restoreOption(ref, desired)) return false;
      } else {
        const element = controlRegistry.get(ref.controlId);
        if (!element || !applyTextValue(element, desired)) return false;
      }

      // Rollback events may rerender too. Prove each inverse before resolving
      // the next rollback target.
      const afterResolution = resolveSafely(resolveAuthority, true);
      if (!afterResolution.ok) return false;
      const after = validateResolution(afterResolution, plan, rootKey, rootGeneration, targetSet);
      if (!after.ok) return false;
      const afterState = snapshotControls(after.mapping);
      if (!rollbackStateIsOwned(afterState, entry)) return "USER_STATE_CHANGED";
      if (sameSnapshot(state, afterState)) return false;
    }
  }
  return true;
}

function rollbackStateIsOwned(current: SemanticControlSnapshot, entry: AppliedMutation): boolean {
  if (current.size !== entry.before.size || current.size !== entry.after.size) return false;
  for (const [key, before] of entry.before) {
    const after = entry.after.get(key);
    const actual = current.get(key);
    if (before === after ? actual !== before : actual !== before && actual !== after) return false;
  }
  return true;
}

function changedKeys(entry: AppliedMutation): string[] {
  return [...entry.before].filter(([key, value]) => entry.after.get(key) !== value).map(([key]) => key);
}

function resolveStepTarget(step: ActionPlan["steps"][number], plan: AnswerPlan, mapping: Mapping): ControlRef | null {
  if (step.type === "select-option" || step.type === "clear-option") return mapping.options.get(step.optionKey) ?? null;
  if (step.type === "set-text" && step.blankIndex !== undefined) return mapping.blanks[step.blankIndex] ?? null;
  if (plan.kind === "short-answer" || step.type === "clear-text") return mapping.text;
  return null;
}

function desiredValue(step: ActionPlan["steps"][number]): string | boolean {
  if (step.type === "select-option" || step.type === "clear-option") return step.desiredSelected;
  return step.type === "clear-text" ? "" : step.value;
}

function perform(step: ActionPlan["steps"][number], ref: ControlRef): boolean {
  const element = controlRegistry.get(ref.controlId);
  if (!element?.isConnected) return false;
  if (step.type === "set-text") return applyTextValue(element, step.value);
  if (step.type === "clear-text") return applyTextValue(element, "");
  if (isSelected(ref) === step.desiredSelected) return false;
  if (ref.controlType !== "radio" && ref.controlType !== "checkbox" && ref.controlType !== "custom-choice") return false;
  clickElement(element);
  return true;
}

function restoreOption(ref: ControlRef, desired: boolean): boolean {
  const element = controlRegistry.get(ref.controlId);
  if (!element?.isConnected) return false;
  if (isSelected(ref) === desired) return true;
  if (!desired && ref.controlType === "radio") return false;
  if (ref.controlType !== "radio" && ref.controlType !== "checkbox" && ref.controlType !== "custom-choice") return false;
  clickElement(element);
  return true;
}

export function verifyAnswerPlan(plan: AnswerPlan, mapping: Mapping): boolean {
  if (plan.kind === "single-choice" || plan.kind === "multiple-choice" || plan.kind === "boolean") {
    const expected = new Set(plan.kind === "boolean" ? [plan.optionKey!] : plan.optionKeys);
    const actual = new Set([...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key));
    return expected.size === actual.size && [...expected].every((key) => actual.has(key));
  }
  if (plan.kind === "fill-blank") return plan.blanks.every((blank) => normalize(readValue(mapping.blanks[blank.index])) === normalize(blank.value));
  return Boolean(mapping.text) && normalize(readValue(mapping.text!)) === normalize(plan.value);
}

export function readSelectedOptionKeys(mapping: Mapping): string[] {
  return [...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key).sort();
}

function semanticKeys(mapping: Mapping): string[] {
  return [...mapping.options.keys()].map(optionKey)
    .concat(mapping.blanks.flatMap((ref, index) => ref ? [blankKey(ref.blankIndex ?? index)] : []))
    .sort();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function semanticKey(ref: ControlRef): string | null {
  if (ref.role === "option" && ref.optionKey) return optionKey(ref.optionKey);
  if (ref.role === "blank" && ref.blankIndex !== undefined) return blankKey(ref.blankIndex);
  return null;
}

function resolveSemanticKey(mapping: Mapping, key: string): ControlRef | null {
  if (key.startsWith("option:")) return mapping.options.get(key.slice("option:".length)) ?? null;
  if (key.startsWith("blank:")) return mapping.blanks[Number(key.slice("blank:".length))] ?? null;
  return null;
}

function optionKey(key: string): string { return `option:${key}`; }
function blankKey(index: number): string { return `blank:${index}`; }

function isSelected(ref: ControlRef): boolean {
  const element = controlRegistry.get(ref.controlId);
  return isHTMLInputInOwnerRealm(element) ? element.checked : element?.getAttribute("aria-checked") === "true" || Boolean(element?.classList.contains("is-choose") || element?.classList.contains("selected") || element?.classList.contains("active"));
}

function readRaw(ref: ControlRef): string | boolean { return ref.role === "option" ? isSelected(ref) : readValue(ref); }
function readValue(ref: ControlRef): string {
  const element = controlRegistry.get(ref.controlId);
  return isHTMLInputInOwnerRealm(element) || isHTMLTextAreaInOwnerRealm(element) ? element.value : element?.textContent ?? "";
}
function normalize(value: string): string { return String(value).normalize("NFC").replace(/\r\n?/g, "\n").trim(); }
function sameSnapshot(left: SemanticControlSnapshot, right: SemanticControlSnapshot): boolean {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
}
function result(outcome: FillOutcome, message: string, filledCount = 0): TransactionResult { return { outcome, filledCount, message }; }
