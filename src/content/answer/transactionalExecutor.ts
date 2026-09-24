import type { ActionPlan, ActionStep, AnswerPlan } from "@/shared/types";
import { isHTMLInputInOwnerRealm, isHTMLTextAreaInOwnerRealm } from "../domRealm";
import {
  clickControlForTransaction,
  dispatchTextEventForTransaction,
  setTextValueForTransaction,
} from "../answerDomUtils";
import { controlRegistry, type ControlRef } from "./controlRegistry";
import { controlIsVisibleAndEnabled, semanticFingerprintForControl, type ControlMappingResult } from "./controlMapping";

export type FillOutcome =
  | "FILLED_VERIFIED"
  | "NO_CHANGE_NEEDED"
  | "CONTROL_MAPPING_AMBIGUOUS"
  | "CONTROL_MAPPING_CHANGED"
  | "STALE_ACTION_PLAN"
  | "STALE_MUTATION_AUTHORITY"
  | "USER_STATE_CHANGED"
  | "FILL_VERIFICATION_FAILED"
  | "ROLLBACK_FAILED"
  | "ROLLBACK_AUTHORITY_LOST"
  | "PARTIAL_MUTATION_UNPROVABLE"
  | "UNSUPPORTED_CONTROL";

export type TransactionResult = {
  outcome: FillOutcome;
  filledCount: number;
  message: string;
  stopAutomation: boolean;
  rolledBack?: boolean;
  cause?: FillOutcome;
};

type Snapshot = Map<string, string | boolean>;
type SuccessfulMapping = Extract<ControlMappingResult, { ok: true }>;
export type FreshMappingResolution =
  | { ok: true; mapping: SuccessfulMapping }
  | { ok: false; code: "STALE_MUTATION_AUTHORITY" | "CONTROL_MAPPING_CHANGED" | "CONTROL_MAPPING_AMBIGUOUS" };
export type FreshMappingResolver = (allowEquivalentOwnerRebind?: boolean) => FreshMappingResolution;

type MutationLedgerEntry = {
  intent: string;
  before: Snapshot;
  expectedAutomationAfter: Snapshot;
};

type ExecutorState = {
  plan: AnswerPlan;
  mappingSignature: string;
  resolveFreshMapping: FreshMappingResolver;
  initial: Snapshot;
  expectedCurrent: Snapshot;
  ledger: MutationLedgerEntry[];
};

export const MIN_AUTOFILL_MAPPING_CONFIDENCE = 0.9;
const TEXT_EVENT_SEQUENCE = ["input", "change", "keyup", "blur"] as const;

export function buildActionPlan(plan: AnswerPlan, mapping: SuccessfulMapping): ActionPlan {
  const steps: ActionPlan["steps"] = [];
  const selected = new Set([...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key));
  if (plan.kind === "single-choice" || plan.kind === "multiple-choice" || plan.kind === "boolean") {
    const desired = new Set(plan.kind === "boolean" ? [plan.optionKey!] : plan.optionKeys);
    for (const [key] of mapping.options) {
      if (desired.has(key) && !selected.has(key)) steps.push({ type: "select-option", optionKey: key, desiredSelected: true });
      if (plan.kind === "multiple-choice" && !desired.has(key) && selected.has(key)) steps.push({ type: "clear-option", optionKey: key, desiredSelected: false });
    }
  } else if (plan.kind === "fill-blank") {
    for (const blank of plan.blanks) {
      const ref = mapping.blanks[blank.index];
      if (ref && readValue(ref) !== normalize(blank.value)) steps.push({ type: "set-text", value: blank.value, blankIndex: blank.index });
    }
  } else if (plan.kind === "short-answer" && mapping.text && readValue(mapping.text) !== normalize(plan.value)) {
    steps.push({ type: "set-text", value: plan.value });
  }
  return {
    schemaVersion: 1,
    questionId: plan.questionId,
    contentFingerprint: plan.contentFingerprint,
    answerSemanticHash: plan.answerSemanticHash,
    steps,
  };
}

/** Snapshots are keyed by semantic target, so a same-question DOM replacement preserves the baseline. */
export function snapshotControls(mapping: SuccessfulMapping): Snapshot {
  return new Map([...mapping.options.values(), ...mapping.blanks].map((ref) => [semanticKey(ref), readRaw(ref)]));
}

export async function executeTransaction(
  plan: AnswerPlan,
  action: ActionPlan,
  preparedMapping: SuccessfulMapping,
  solveSnapshot: Snapshot | undefined,
  resolveFreshMapping: FreshMappingResolver,
): Promise<TransactionResult> {
  if (action.questionId !== plan.questionId
    || action.contentFingerprint !== plan.contentFingerprint
    || action.answerSemanticHash !== plan.answerSemanticHash) {
    return failure("STALE_ACTION_PLAN", "Action intent does not match its validated answer plan");
  }

  const state: ExecutorState = {
    plan,
    mappingSignature: mappingSignature(preparedMapping),
    resolveFreshMapping,
    initial: new Map(),
    expectedCurrent: new Map(),
    ledger: [],
  };
  const first = resolveCurrentMapping(state);
  if (!first.ok) return failure("STALE_ACTION_PLAN", "Current question authority or control mapping could not be proven", { cause: first.code });
  const before = snapshotControls(first.mapping);
  state.initial = new Map(before);
  state.expectedCurrent = new Map(before);
  if (solveSnapshot && !sameSnapshot(solveSnapshot, before)) {
    return failure("USER_STATE_CHANGED", "User changed answer after solve started; no overwrite");
  }
  if (!action.steps.length) {
    return verifyAnswerPlan(plan, first.mapping)
      ? success("NO_CHANGE_NEEDED", "Answer already verified")
      : failure("FILL_VERIFICATION_FAILED", "Existing state does not verify");
  }

  let changed = 0;
  for (const step of action.steps) {
    const resolved = resolveCurrentMapping(state);
    if (!resolved.ok) {
      if (state.ledger.length) return partialFailure(resolved.code);
      return failure(resolved.code, "Current question authority or control mapping could not be proven");
    }
    const currentSnapshot = snapshotControls(resolved.mapping);
    if (!sameSnapshot(state.expectedCurrent, currentSnapshot)) {
      return failure("USER_STATE_CHANGED", "Answer state changed outside the authorized transaction", { stopAutomation: state.ledger.length > 0 });
    }
    const ref = resolveStepTarget(step, resolved.mapping);
    if (!ref) return failAndRollback(state, "CONTROL_MAPPING_CHANGED", "Semantic target no longer maps uniquely");

    if (step.type === "set-text" || step.type === "clear-text") {
      const value = step.type === "set-text" ? step.value : "";
      const targetKey = semanticKey(ref);
      const beforeStep = new Map(state.expectedCurrent);
      const element = controlRegistry.get(ref.controlId);
      if (!element || !setTextValueForTransaction(element, value)) {
        const existing = readRaw(ref);
        if (existing === value) continue;
        return failAndRollback(state, "UNSUPPORTED_CONTROL", "Text target rejected the value update");
      }
      await Promise.resolve();
      const afterSet = resolveCurrentMapping(state, true);
      if (!afterSet.ok) return partialFailure(afterSet.code);
      const expectedAfterSet = new Map(beforeStep);
      expectedAfterSet.set(targetKey, value);
      const actualAfterSet = snapshotControls(afterSet.mapping);
      if (!sameSnapshot(actualAfterSet, expectedAfterSet)) {
        if (sameSnapshot(actualAfterSet, beforeStep)) {
          return failAndRollback(state, "UNSUPPORTED_CONTROL", "Text target did not accept the value update");
        }
        return failure("USER_STATE_CHANGED", "Text state changed outside the authorized transaction", { stopAutomation: true });
      }
      const entry: MutationLedgerEntry = {
        intent: semanticIntent(step),
        before: beforeStep,
        expectedAutomationAfter: new Map(actualAfterSet),
      };
      state.ledger.push(entry);
      state.expectedCurrent = new Map(actualAfterSet);

      for (const eventType of TEXT_EVENT_SEQUENCE) {
        const beforeEvent = resolveCurrentMapping(state);
        if (!beforeEvent.ok) return partialFailure(beforeEvent.code);
        if (!sameSnapshot(state.expectedCurrent, snapshotControls(beforeEvent.mapping))) {
          return failure("USER_STATE_CHANGED", "Text state changed before a transaction event", { stopAutomation: true });
        }
        const freshRef = resolveStepTarget(step, beforeEvent.mapping);
        const freshElement = freshRef && controlRegistry.get(freshRef.controlId);
        if (!freshRef || !freshElement || semanticKey(freshRef) !== targetKey) {
          return partialFailure("CONTROL_MAPPING_CHANGED");
        }
        // Each event gets a fresh control; no event uses a node retained across
        // an input/change/key/blur boundary.
        dispatchTextEventForTransaction(freshElement, eventType);
        await Promise.resolve();
        const afterEvent = resolveCurrentMapping(state);
        if (!afterEvent.ok) return partialFailure(afterEvent.code);
        const afterEventSnapshot = snapshotControls(afterEvent.mapping);
        if (!sameSnapshot(state.expectedCurrent, afterEventSnapshot)) {
          return failure("USER_STATE_CHANGED", "Text state changed outside the authorized transaction", { stopAutomation: true });
        }
        entry.expectedAutomationAfter = new Map(afterEventSnapshot);
      }
      changed += 1;
      continue;
    }

    const beforeStep = new Map(state.expectedCurrent);
    const expectedAfter = expectedAfterOptionMutation(beforeStep, step, plan, resolved.mapping);
    const element = controlRegistry.get(ref.controlId);
    if (!element) return failAndRollback(state, "CONTROL_MAPPING_CHANGED", "Fresh option control is unavailable");
    clickControlForTransaction(element);
    await Promise.resolve();
    const afterClick = resolveCurrentMapping(state, true);
    if (!afterClick.ok) return partialFailure(afterClick.code);
    const actualAfterClick = snapshotControls(afterClick.mapping);
    if (!sameSnapshot(actualAfterClick, expectedAfter)) {
      if (sameSnapshot(actualAfterClick, beforeStep)) {
        return failAndRollback(state, "UNSUPPORTED_CONTROL", "Option control did not apply the requested state");
      }
      return failure("USER_STATE_CHANGED", "Option state changed outside the authorized transaction", { stopAutomation: true });
    }
    state.ledger.push({
      intent: semanticIntent(step),
      before: beforeStep,
      expectedAutomationAfter: new Map(actualAfterClick),
    });
    state.expectedCurrent = new Map(actualAfterClick);
    changed += 1;
  }

  const final = resolveCurrentMapping(state);
  if (!final.ok) return partialFailure(final.code);
  const finalSnapshot = snapshotControls(final.mapping);
  if (!sameSnapshot(state.expectedCurrent, finalSnapshot)) {
    return failure("USER_STATE_CHANGED", "Answer state changed before final verification", { stopAutomation: true });
  }
  return verifyAnswerPlan(plan, final.mapping)
    ? success("FILLED_VERIFIED", "Filled and verified by fresh DOM readback", changed)
    : failAndRollback(state, "FILL_VERIFICATION_FAILED", "Fresh DOM readback did not match the answer plan");
}

function resolveCurrentMapping(state: ExecutorState, allowEquivalentOwnerRebind = state.ledger.length > 0): { ok: true; mapping: SuccessfulMapping } | { ok: false; code: FillOutcome } {
  const current = state.resolveFreshMapping(allowEquivalentOwnerRebind);
  if (!current.ok) return current;
  if (current.mapping.confidence < MIN_AUTOFILL_MAPPING_CONFIDENCE) return { ok: false, code: "CONTROL_MAPPING_AMBIGUOUS" };
  if (current.mapping.questionId !== state.plan.questionId || !revalidate(current.mapping, state.plan)) {
    return { ok: false, code: "STALE_MUTATION_AUTHORITY" };
  }
  if (mappingSignature(current.mapping) !== state.mappingSignature) return { ok: false, code: "CONTROL_MAPPING_CHANGED" };
  return current;
}

function revalidate(mapping: SuccessfulMapping, plan: AnswerPlan): boolean {
  return mapping.questionId === plan.questionId
    && mapping.owner.isConnected
    && [...mapping.options.values(), ...mapping.blanks].every((ref) => {
      const entry = controlRegistry.metadata(ref.controlId);
      const element = entry?.element;
      if (!element) return false;
      const currentOwner = element.closest(".question-item,.questionBox,.base-question-component,[data-question-id],[data-questionid],[data-problem-id],[data-problemid],[data-item-id]");
      return entry.questionId === plan.questionId
        && entry.owner === mapping.owner
        && element.isConnected
        && mapping.owner.contains(element)
        && currentOwner === mapping.owner
        && controlIsVisibleAndEnabled(element)
        && semanticFingerprintForControl(element, ref) === ref.semanticFingerprint;
    });
}

function mappingSignature(mapping: SuccessfulMapping): string {
  const options = [...mapping.options]
    .map(([key, ref]) => key + ":" + ref.controlType + ":" + ref.semanticFingerprint)
    .sort()
    .join("|");
  const blanks = mapping.blanks
    .map((ref, index) => index + ":" + ref.controlType + ":" + ref.semanticFingerprint)
    .join("|");
  const text = mapping.text ? String(mapping.text.blankIndex ?? "") + ":" + mapping.text.semanticFingerprint : "";
  return options + "#" + blanks + "#" + text;
}

function expectedAfterOptionMutation(before: Snapshot, step: ActionStep, plan: AnswerPlan, mapping: SuccessfulMapping): Snapshot {
  const expected = new Map(before);
  if (step.type !== "select-option" && step.type !== "clear-option") return expected;
  expected.set("option:" + step.optionKey, step.desiredSelected);
  if (step.desiredSelected && (plan.kind === "single-choice" || plan.kind === "boolean")) {
    for (const key of mapping.options.keys()) expected.set("option:" + key, key === step.optionKey);
  }
  const ref = mapping.options.get(step.optionKey);
  if (ref?.controlType === "radio" && step.desiredSelected) {
    const element = controlRegistry.get(ref.controlId);
    if (isHTMLInputInOwnerRealm(element) && element.name) {
      for (const [key, peer] of mapping.options) {
        const peerElement = controlRegistry.get(peer.controlId);
        if (key !== step.optionKey && isHTMLInputInOwnerRealm(peerElement)
          && peerElement.name === element.name && peerElement.form === element.form) {
          expected.set("option:" + key, false);
        }
      }
    }
  }
  return expected;
}

function resolveStepTarget(step: ActionStep, mapping: SuccessfulMapping): ControlRef | null {
  if (step.type === "select-option" || step.type === "clear-option") return mapping.options.get(step.optionKey) ?? null;
  if (step.blankIndex !== undefined) return mapping.blanks[step.blankIndex] ?? null;
  return mapping.text;
}

async function failAndRollback(state: ExecutorState, outcome: FillOutcome, message: string): Promise<TransactionResult> {
  if (!state.ledger.length) return failure(outcome, message, { rolledBack: true });
  const latestMutation = state.ledger[state.ledger.length - 1];
  if (!latestMutation || !sameSnapshot(state.expectedCurrent, latestMutation.expectedAutomationAfter)) {
    return partialFailure("STALE_MUTATION_AUTHORITY", "ROLLBACK_AUTHORITY_LOST");
  }
  const rollbackFailure = (result: TransactionResult) => ({ ...result, stopAutomation: true });
  const initial = resolveCurrentMapping(state);
  if (!initial.ok) return partialFailure(initial.code, "ROLLBACK_AUTHORITY_LOST");
  if (!sameSnapshot(state.expectedCurrent, snapshotControls(initial.mapping))) {
    return failure("USER_STATE_CHANGED", "User or page changed answer state; rollback left it untouched", { cause: outcome, stopAutomation: true });
  }

  // Restore radio groups by selecting the originally selected semantic option first.
  for (const [key, value] of state.initial) {
    if (!value || !key.startsWith("option:")) continue;
    const current = resolveCurrentMapping(state);
    if (!current.ok) return partialFailure(current.code, "ROLLBACK_AUTHORITY_LOST");
    if (!sameSnapshot(state.expectedCurrent, snapshotControls(current.mapping))) {
      return failure("USER_STATE_CHANGED", "User changed answer state during rollback", { cause: outcome, stopAutomation: true });
    }
    const ref = current.mapping.options.get(key.slice("option:".length));
    if (ref?.controlType === "radio" && !isSelected(ref)) {
      const restored = await restoreOption(state, current.mapping, ref, true);
      if (!restored.ok) return rollbackFailure(restored.result);
    }
  }

  for (const [key, value] of state.initial) {
    if (!key.startsWith("option:") || state.expectedCurrent.get(key) === value) continue;
    const current = resolveCurrentMapping(state);
    if (!current.ok) return partialFailure(current.code, "ROLLBACK_AUTHORITY_LOST");
    if (!sameSnapshot(state.expectedCurrent, snapshotControls(current.mapping))) {
      return failure("USER_STATE_CHANGED", "User changed answer state during rollback", { cause: outcome, stopAutomation: true });
    }
    const ref = current.mapping.options.get(key.slice("option:".length));
    if (!ref) return partialFailure("CONTROL_MAPPING_CHANGED", "ROLLBACK_AUTHORITY_LOST");
    if (ref.controlType === "radio") {
      if (!value) return failure("ROLLBACK_FAILED", "A radio control cannot be safely unchecked", { cause: outcome, stopAutomation: true });
      const restored = await restoreOption(state, current.mapping, ref, true);
      if (!restored.ok) return rollbackFailure(restored.result);
    } else {
      const restored = await restoreOption(state, current.mapping, ref, Boolean(value));
      if (!restored.ok) return rollbackFailure(restored.result);
    }
  }

  for (const [key, value] of state.initial) {
    if (key.startsWith("option:") || state.expectedCurrent.get(key) === value) continue;
    const current = resolveCurrentMapping(state);
    if (!current.ok) return partialFailure(current.code, "ROLLBACK_AUTHORITY_LOST");
    if (!sameSnapshot(state.expectedCurrent, snapshotControls(current.mapping))) {
      return failure("USER_STATE_CHANGED", "User changed answer state during rollback", { cause: outcome, stopAutomation: true });
    }
    const blankIndex = Number(key.slice("blank:".length));
    const ref = current.mapping.blanks[blankIndex];
    if (!ref || typeof value !== "string") return partialFailure("CONTROL_MAPPING_CHANGED", "ROLLBACK_AUTHORITY_LOST");
    const restored = await restoreText(state, ref, value);
    if (!restored.ok) return rollbackFailure(restored.result);
  }

  const restored = resolveCurrentMapping(state);
  if (!restored.ok) return partialFailure(restored.code, "ROLLBACK_AUTHORITY_LOST");
  if (!sameSnapshot(state.initial, snapshotControls(restored.mapping))) {
    return failure("ROLLBACK_FAILED", "Fresh rollback mapping did not restore the original answer state", { cause: outcome, stopAutomation: true });
  }
  return failure(outcome, outcome + "; original state restored", { rolledBack: true, stopAutomation: true });
}

async function restoreOption(
  state: ExecutorState,
  mapping: SuccessfulMapping,
  ref: ControlRef,
  desired: boolean,
): Promise<{ ok: true } | { ok: false; result: TransactionResult }> {
  if (readRaw(ref) === desired) return { ok: true };
  if (ref.controlType === "radio" && !desired) {
    return { ok: false, result: failure("ROLLBACK_FAILED", "A radio control cannot be safely unchecked") };
  }
  const before = new Map(state.expectedCurrent);
  const expected = new Map(before);
  expected.set(semanticKey(ref), desired);
  if (desired && ref.controlType === "radio") {
    const target = controlRegistry.get(ref.controlId);
    if (isHTMLInputInOwnerRealm(target) && target.name) {
      for (const [optionKey, peer] of mapping.options) {
        const element = controlRegistry.get(peer.controlId);
        if (optionKey !== ref.optionKey && isHTMLInputInOwnerRealm(element)
          && element.name === target.name && element.form === target.form) {
          expected.set("option:" + optionKey, false);
        }
      }
    }
  }
  const element = controlRegistry.get(ref.controlId);
  if (!element) return { ok: false, result: partialFailure("CONTROL_MAPPING_CHANGED", "ROLLBACK_AUTHORITY_LOST") };
  clickControlForTransaction(element);
  await Promise.resolve();
  const current = resolveCurrentMapping(state);
  if (!current.ok) return { ok: false, result: partialFailure(current.code, "ROLLBACK_AUTHORITY_LOST") };
  const actual = snapshotControls(current.mapping);
  if (!sameSnapshot(actual, expected)) {
    return { ok: false, result: failure("ROLLBACK_FAILED", "Fresh rollback option did not restore its semantic state") };
  }
  state.expectedCurrent = new Map(actual);
  return { ok: true };
}

async function restoreText(
  state: ExecutorState,
  ref: ControlRef,
  desired: string,
): Promise<{ ok: true } | { ok: false; result: TransactionResult }> {
  const key = semanticKey(ref);
  if (readRaw(ref) === desired) return { ok: true };
  const expected = new Map(state.expectedCurrent);
  expected.set(key, desired);
  const element = controlRegistry.get(ref.controlId);
  if (!element || !setTextValueForTransaction(element, desired)) {
    return { ok: false, result: failure("ROLLBACK_FAILED", "Fresh rollback text target rejected the original value") };
  }
  await Promise.resolve();
  let current = resolveCurrentMapping(state);
  if (!current.ok) return { ok: false, result: partialFailure(current.code, "ROLLBACK_AUTHORITY_LOST") };
  let actual = snapshotControls(current.mapping);
  if (!sameSnapshot(actual, expected)) {
    return { ok: false, result: failure("ROLLBACK_FAILED", "Fresh rollback text target did not restore its value") };
  }
  state.expectedCurrent = new Map(actual);
  for (const eventType of TEXT_EVENT_SEQUENCE) {
    current = resolveCurrentMapping(state);
    if (!current.ok) return { ok: false, result: partialFailure(current.code, "ROLLBACK_AUTHORITY_LOST") };
    if (!sameSnapshot(state.expectedCurrent, snapshotControls(current.mapping))) {
      return { ok: false, result: failure("USER_STATE_CHANGED", "User changed answer state during rollback") };
    }
    const freshRef = current.mapping.blanks[ref.blankIndex ?? 0];
    const freshElement = freshRef && controlRegistry.get(freshRef.controlId);
    if (!freshElement) return { ok: false, result: partialFailure("CONTROL_MAPPING_CHANGED", "ROLLBACK_AUTHORITY_LOST") };
    dispatchTextEventForTransaction(freshElement, eventType);
    await Promise.resolve();
    current = resolveCurrentMapping(state);
    if (!current.ok) return { ok: false, result: partialFailure(current.code, "ROLLBACK_AUTHORITY_LOST") };
    actual = snapshotControls(current.mapping);
    if (!sameSnapshot(actual, state.expectedCurrent)) {
      return { ok: false, result: failure("USER_STATE_CHANGED", "User or page changed answer state during rollback") };
    }
  }
  return { ok: true };
}

function partialFailure(cause: FillOutcome, overrideCause?: FillOutcome): TransactionResult {
  return failure("PARTIAL_MUTATION_UNPROVABLE", "A partial page mutation could not be safely proven or restored", {
    cause: overrideCause ?? cause,
    stopAutomation: true,
  });
}

function semanticIntent(step: ActionStep): string {
  if (step.type === "select-option" || step.type === "clear-option") return step.type + ":" + step.optionKey;
  if (step.type === "set-text" || step.type === "clear-text") return step.type + ":" + (step.blankIndex ?? "text");
  throw new Error("Unsupported transaction step");
}

export function verifyAnswerPlan(plan: AnswerPlan, mapping: SuccessfulMapping): boolean {
  if (plan.kind === "single-choice" || plan.kind === "multiple-choice" || plan.kind === "boolean") {
    const expected = new Set(plan.kind === "boolean" ? [plan.optionKey!] : plan.optionKeys);
    const actual = new Set([...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key));
    return expected.size === actual.size && [...expected].every((key) => actual.has(key));
  }
  if (plan.kind === "fill-blank") return plan.blanks.every((blank) => normalize(readValue(mapping.blanks[blank.index])) === normalize(blank.value));
  return Boolean(mapping.text) && normalize(readValue(mapping.text!)) === normalize(plan.value);
}

export function readSelectedOptionKeys(mapping: SuccessfulMapping): string[] {
  return [...mapping.options].filter(([, ref]) => isSelected(ref)).map(([key]) => key).sort();
}

function semanticKey(ref: ControlRef): string {
  return ref.role === "option" ? "option:" + (ref.optionKey ?? "") : "blank:" + (ref.blankIndex ?? 0);
}

function isSelected(ref: ControlRef): boolean {
  const element = controlRegistry.get(ref.controlId);
  return isHTMLInputInOwnerRealm(element)
    ? element.checked
    : element?.getAttribute("aria-checked") === "true"
      || Boolean(element?.classList.contains("is-choose") || element?.classList.contains("selected") || element?.classList.contains("active"));
}

function readRaw(ref: ControlRef): string | boolean {
  return ref.role === "option" ? isSelected(ref) : readValue(ref);
}

function readValue(ref: ControlRef): string {
  const element = controlRegistry.get(ref.controlId);
  return isHTMLInputInOwnerRealm(element) || isHTMLTextAreaInOwnerRealm(element) ? element.value : element?.textContent ?? "";
}

function normalize(value: string): string {
  return String(value).normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

function sameSnapshot(left: Snapshot, right: Snapshot): boolean {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
}

function failure(
  outcome: FillOutcome,
  message: string,
  extra: Partial<Pick<TransactionResult, "rolledBack" | "cause" | "stopAutomation">> = {},
): TransactionResult {
  return { outcome, filledCount: 0, message, stopAutomation: false, ...extra };
}

function success(outcome: "FILLED_VERIFIED" | "NO_CHANGE_NEEDED", message: string, filledCount = 0): TransactionResult {
  return { outcome, filledCount, message, stopAutomation: false };
}
