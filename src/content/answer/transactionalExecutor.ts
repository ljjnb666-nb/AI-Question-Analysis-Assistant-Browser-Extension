import type { ActionPlan, AnswerPlan } from "@/shared/types";
import { isHTMLInputInOwnerRealm, isHTMLTextAreaInOwnerRealm } from "../domRealm";
import {
  activateChoiceControl,
  dispatchChoiceGestureEvent,
  dispatchTextControlEvent,
  focusTextControl,
  setTextControlValueOnly,
  type ChoiceGestureEventName,
  type TextControlEventName,
} from "../answerDomUtils";
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
export function executeTransaction(
  plan: AnswerPlan,
  action: ActionPlan,
  initialMapping: Mapping,
  solveSnapshot: SemanticControlSnapshot | undefined,
  resolveAuthority: ResolveCurrentTransactionAuthority,
): Promise<TransactionResult> {
  const controlIds = [...initialMapping.options.values(), ...initialMapping.blanks].map((ref) => ref.controlId);
  const outcome = controlRegistry.withPinnedMapping(initialMapping.lifecycleToken, controlIds, () =>
    executeTransactionCore(plan, action, initialMapping, solveSnapshot, resolveAuthority));
  return Promise.resolve(outcome);
}

function executeTransactionCore(
  plan: AnswerPlan,
  action: ActionPlan,
  initialMapping: Mapping,
  solveSnapshot: SemanticControlSnapshot | undefined,
  resolveAuthority: ResolveCurrentTransactionAuthority,
): TransactionResult {
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

    const key = resolveStepKey(step, plan, current.mapping);
    if (!key || !before.has(key)) return failAndRollback("CONTROL_MAPPING_CHANGED", "Semantic mutation target is no longer uniquely mapped", ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);

    const interaction = performWithFreshBoundaries({
      plan,
      step,
      key,
      rootKey,
      rootGeneration,
      targetSet,
      resolveAuthority,
      allowTextSetterState: (state) => stepChangesAreOwned(step, key, before, state, plan)
        && state.get(key) === desiredValue(step),
    }, before);
    if (!interaction.ok) {
      if (interaction.after && !sameSnapshot(before, interaction.after)
        && interaction.after.get(key) === desiredValue(step)
        && stepChangesAreOwned(step, key, before, interaction.after, plan)) {
        ledger.push({ before, after: interaction.after });
      }
      return failAndRollback(interaction.code, interaction.message, ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
    }
    const after = interaction.after;
    if (after.get(key) !== desiredValue(step)) {
      if (sameSnapshot(before, after)) return failAndRollback(interaction.threw ? "UNSUPPORTED_CONTROL" : "FILL_VERIFICATION_FAILED", "Mutation did not produce the requested semantic state", ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
      return result("PARTIAL_MUTATION_UNPROVABLE", "Mutation changed live state without producing the requested semantic value");
    }
    if (!stepChangesAreOwned(step, key, before, after, plan)) {
      return result("USER_STATE_CHANGED", "A control outside the current mutation changed during the event; live state was preserved");
    }
    if (!sameSnapshot(before, after)) ledger.push({ before, after });
    expected = after;
    if (interaction.threw) return failAndRollback("UNSUPPORTED_CONTROL", "A transaction event could not complete", ledger, plan, rootKey, rootGeneration, targetSet, resolveAuthority);
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
  if (!controlRegistry.isCurrentTransactionToken(mapping.lifecycleToken)) {
    return { ok: false, code: "STALE_ACTION_PLAN", message: "Control mapping lifecycle ended before transaction verification" };
  }
  if (resolution.stableId !== plan.questionId || resolution.contentFingerprint !== plan.contentFingerprint
    || resolution.rootKey !== rootKey || resolution.rootGeneration !== rootGeneration
    || mapping.rootKey !== rootKey || mapping.rootGeneration !== rootGeneration
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
      && entry.rootKey === mapping.rootKey && entry.rootGeneration === mapping.rootGeneration
      && entry.lifecycleToken === mapping.lifecycleToken
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

type MutationBoundaryContext = {
  plan: AnswerPlan;
  step: ActionPlan["steps"][number];
  key: string;
  rootKey: string;
  rootGeneration: number;
  targetSet: string[];
  resolveAuthority: ResolveCurrentTransactionAuthority;
  allowTextSetterState: (state: SemanticControlSnapshot) => boolean;
};

type BoundaryResolution = { ok: true; mapping: Mapping; state: SemanticControlSnapshot } | { ok: false; code: FillAnswerCode; message: string };
type InteractionResult =
  | { ok: true; after: SemanticControlSnapshot; threw: boolean }
  | { ok: false; code: FillAnswerCode; message: string; after?: SemanticControlSnapshot };

const CHOICE_GESTURE_EVENTS: ChoiceGestureEventName[] = [
  "pointerover", "pointerenter", "pointerdown", "mouseover", "mousedown", "mouseup", "pointerup",
];
const TEXT_CONTROL_EVENTS: TextControlEventName[] = ["input", "change", "keyup", "blur"];

/** Execute the original Phase 5 interaction protocol with a fresh authority fence at every event boundary. */
function performWithFreshBoundaries(context: MutationBoundaryContext, before: SemanticControlSnapshot): InteractionResult {
  if (context.step.type === "select-option" || context.step.type === "clear-option") {
    let expected = before;
    for (const eventType of CHOICE_GESTURE_EVENTS) {
      const event = dispatchChoiceEventAtBoundary(context, expected, eventType);
      if (!event.ok) return event;
      expected = event.state;
    }

    const activation = activateChoiceAtBoundary(context, expected);
    if (!activation.ok) return activation;
    return { ok: true, after: activation.state, threw: activation.threw };
  }

  const focus = focusTextAtBoundary(context, before);
  if (!focus.ok) return focus;

  const value = desiredValue(context.step);
  if (typeof value !== "string") return { ok: false, code: "UNSUPPORTED_CONTROL", message: "Text action has a non-text value" };
  const setter = setTextAtBoundary(context, before, value);
  if (!setter.ok) return setter;
  if (setter.threw) return { ok: true, after: setter.state, threw: true };

  let expected = setter.state;
  for (const eventType of TEXT_CONTROL_EVENTS) {
    const event = dispatchTextEventAtBoundary(context, expected, eventType);
    if (!event.ok) return event;
    expected = event.state;
    if (event.threw) return { ok: true, after: event.state, threw: true };
  }
  return { ok: true, after: expected, threw: false };
}

function dispatchChoiceEventAtBoundary(context: MutationBoundaryContext, expected: SemanticControlSnapshot, type: ChoiceGestureEventName): { ok: true; state: SemanticControlSnapshot } | { ok: false; code: FillAnswerCode; message: string; after?: SemanticControlSnapshot } {
  const current = resolveTargetBoundary(context, expected);
  if (!current.ok) return current;
  let threw = false;
  try { dispatchChoiceGestureEvent(current.element, type); } catch { threw = true; }
  const after = resolveBoundaryState(context);
  if (!after.ok) return after;
  if (!sameSnapshot(expected, after.state)) return changedDuringNonActivationBoundary(context, expected, after.state);
  return threw
    ? { ok: false, code: "UNSUPPORTED_CONTROL", message: `Could not dispatch ${type}` }
    : { ok: true, state: after.state };
}

function activateChoiceAtBoundary(context: MutationBoundaryContext, expected: SemanticControlSnapshot): { ok: true; state: SemanticControlSnapshot; threw: boolean } | { ok: false; code: FillAnswerCode; message: string; after?: SemanticControlSnapshot } {
  const current = resolveTargetBoundary(context, expected);
  if (!current.ok) return current;
  let threw = false;
  try { activateChoiceControl(current.element); } catch { threw = true; }
  const after = resolveBoundaryState(context);
  return after.ok ? { ok: true, state: after.state, threw } : after;
}

function focusTextAtBoundary(context: MutationBoundaryContext, expected: SemanticControlSnapshot): { ok: true } | { ok: false; code: FillAnswerCode; message: string; after?: SemanticControlSnapshot } {
  const current = resolveTargetBoundary(context, expected);
  if (!current.ok) return current;
  let threw = false;
  try { focusTextControl(current.element); } catch { threw = true; }
  const after = resolveBoundaryState(context);
  if (!after.ok) return after;
  if (!sameSnapshot(expected, after.state)) return changedDuringNonActivationBoundary(context, expected, after.state);
  return threw
    ? { ok: false, code: "UNSUPPORTED_CONTROL", message: "Could not focus the current text control" }
    : { ok: true };
}

function setTextAtBoundary(context: MutationBoundaryContext, expected: SemanticControlSnapshot, value: string): { ok: true; state: SemanticControlSnapshot; threw: boolean } | { ok: false; code: FillAnswerCode; message: string; after?: SemanticControlSnapshot } {
  const current = resolveTargetBoundary(context, expected);
  if (!current.ok) return current;
  let changed = false;
  let threw = false;
  try { changed = setTextControlValueOnly(current.element, value); } catch { threw = true; }
  const after = resolveBoundaryState(context);
  if (!after.ok) return after;
  if (!context.allowTextSetterState(after.state)) {
    if (sameSnapshot(expected, after.state)) {
      return { ok: false, code: threw ? "UNSUPPORTED_CONTROL" : "FILL_VERIFICATION_FAILED", message: "Text setter did not produce the requested value" };
    }
    if (stepChangesAreOwned(context.step, context.key, expected, after.state, context.plan)) {
      return { ok: false, code: "PARTIAL_MUTATION_UNPROVABLE", message: "Text setter changed live state without proving the requested value", after: after.state };
    }
    return { ok: false, code: "USER_STATE_CHANGED", message: "Live answer state changed during text assignment" };
  }
  if (!changed && !threw) return { ok: false, code: "FILL_VERIFICATION_FAILED", message: "Text setter reported no mutation" };
  return { ok: true, state: after.state, threw };
}

function dispatchTextEventAtBoundary(context: MutationBoundaryContext, expected: SemanticControlSnapshot, type: TextControlEventName): { ok: true; state: SemanticControlSnapshot; threw: boolean } | { ok: false; code: FillAnswerCode; message: string; after?: SemanticControlSnapshot } {
  const current = resolveTargetBoundary(context, expected);
  if (!current.ok) return current;
  let threw = false;
  try { dispatchTextControlEvent(current.element, type); } catch { threw = true; }
  const after = resolveBoundaryState(context);
  if (!after.ok) return after;
  if (!sameSnapshot(expected, after.state)) return changedDuringNonActivationBoundary(context, expected, after.state);
  return { ok: true, state: after.state, threw };
}

function resolveBoundaryState(context: MutationBoundaryContext): BoundaryResolution {
  const resolution = resolveSafely(context.resolveAuthority, true);
  if (!resolution.ok) return { ok: false, code: "PARTIAL_MUTATION_UNPROVABLE", message: `Authority lost at an interaction boundary: ${resolution.code}` };
  const validated = validateResolution(resolution, context.plan, context.rootKey, context.rootGeneration, context.targetSet);
  if (!validated.ok) return { ok: false, code: "PARTIAL_MUTATION_UNPROVABLE", message: `Mapping lost at an interaction boundary: ${validated.code}` };
  return { ok: true, mapping: validated.mapping, state: snapshotControls(validated.mapping) };
}

function resolveTargetBoundary(context: MutationBoundaryContext, expected: SemanticControlSnapshot): { ok: true; mapping: Mapping; state: SemanticControlSnapshot; ref: ControlRef; element: HTMLElement } | { ok: false; code: FillAnswerCode; message: string } {
  const current = resolveBoundaryState(context);
  if (!current.ok) return current;
  if (!sameSnapshot(expected, current.state)) {
    return { ok: false, code: "USER_STATE_CHANGED", message: "Live answer state changed between interaction events" };
  }
  const ref = resolveSemanticKey(current.mapping, context.key);
  const element = ref && controlRegistry.get(ref.controlId);
  if (!ref || !element?.isConnected) {
    return { ok: false, code: "PARTIAL_MUTATION_UNPROVABLE", message: "Current semantic target disappeared at an interaction boundary" };
  }
  return { ok: true, mapping: current.mapping, state: current.state, ref, element };
}

function changedDuringNonActivationBoundary(context: MutationBoundaryContext, before: SemanticControlSnapshot, after: SemanticControlSnapshot): { ok: false; code: FillAnswerCode; message: string; after?: SemanticControlSnapshot } {
  if (after.get(context.key) === desiredValue(context.step)
    && stepChangesAreOwned(context.step, context.key, before, after, context.plan)) {
    return { ok: false, code: "PARTIAL_MUTATION_UNPROVABLE", message: "Answer state changed before the activation boundary", after };
  }
  return { ok: false, code: "USER_STATE_CHANGED", message: "A page or user state change occurred during an interaction event" };
}

function stepChangesAreOwned(
  step: ActionPlan["steps"][number],
  targetKey: string,
  before: SemanticControlSnapshot,
  after: SemanticControlSnapshot,
  plan: AnswerPlan,
): boolean {
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
      const desired = entry.before.get(key);
      if (desired === undefined) return false;
      const inverseStep = inverseActionFor(key, desired);
      if (!inverseStep) return false;
      const interaction = performWithFreshBoundaries({
        plan,
        step: inverseStep,
        key,
        rootKey,
        rootGeneration,
        targetSet,
        resolveAuthority,
        allowTextSetterState: (after) => rollbackStateIsOwned(after, entry) && after.get(key) === desired,
      }, state);
      if (!interaction.ok) {
        if (interaction.code === "USER_STATE_CHANGED") return "USER_STATE_CHANGED";
        return false;
      }
      const afterState = interaction.after;
      if (!rollbackStateIsOwned(afterState, entry)) return "USER_STATE_CHANGED";
      if (sameSnapshot(state, afterState)) return false;
      if (interaction.threw) return false;
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

function resolveStepKey(step: ActionPlan["steps"][number], plan: AnswerPlan, mapping: Mapping): string | null {
  const ref = resolveStepTarget(step, plan, mapping);
  return ref ? semanticKey(ref) : null;
}

function desiredValue(step: ActionPlan["steps"][number]): string | boolean {
  if (step.type === "select-option" || step.type === "clear-option") return step.desiredSelected;
  return step.type === "clear-text" ? "" : step.value;
}

function inverseActionFor(key: string, desired: string | boolean): ActionPlan["steps"][number] | null {
  if (key.startsWith("option:") && typeof desired === "boolean") {
    const optionKey = key.slice("option:".length);
    return desired
      ? { type: "select-option", controlId: "semantic-target", optionKey, desiredSelected: true }
      : { type: "clear-option", controlId: "semantic-target", optionKey, desiredSelected: false };
  }
  if (key.startsWith("blank:") && typeof desired === "string") {
    const blankIndex = Number(key.slice("blank:".length));
    if (!Number.isInteger(blankIndex) || blankIndex < 0) return null;
    return { type: "set-text", controlId: "semantic-target", value: desired, blankIndex };
  }
  return null;
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
