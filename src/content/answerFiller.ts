import { isExtensionUiElement, isHtmlElementNode } from "./detector/domDetectorShared";
import type { BoundingBox, ParseResult, QuestionBlock } from "@/shared/types";
import { fillChoiceLikeAnswer as fillChoiceLikeAnswerCore, verifyChoiceAnswerInScope } from "./answerChoiceInteraction";
import {
  applyTextValue,
  clickElement,
  compareRectPosition,
  dispatchChoiceEvents,
  intersectionArea,
  isVisible,
  normalizeText,
  pause,
  rectIntersectsExpandedBBox,
  requestRealClick,
  setNativeChecked,
} from "./answerDomUtils";
import {
  collectTextControls,
  ensureQuestionRegionVisible,
  normalizeBBoxToViewport,
  relocateQuestionScopeByText,
  relocateQuestionScopeByTextSync,
  resolveDirectQuestionScope,
  resolveDirectQuestionScopeSync,
  resolveQuestionScope,
  shouldRelocateScope,
} from "./answerScope";
import {
  buildControlValues as buildControlValuesCore,
  formatSingleTextAnswer as formatSingleTextAnswerCore,
  inferTypeFromAnswer as inferTypeFromAnswerCore,
  normalizeChoiceAnswerKeys as normalizeChoiceAnswerKeysCore,
  resolveTextAnswerSource as resolveTextAnswerSourceCore,
  splitAnswerParts as splitAnswerPartsCore,
} from "./answerText";
import type { FillAnswerResult, VerifyAnswerResult } from "./answerTypes";
import { buildValidatedAnswerPlan } from "./answer/answerPlanValidator";
import { buildControlMapping } from "./answer/controlMapping";
import { buildActionPlan, executeTransaction, readSelectedOptionKeys, snapshotControls, verifyAnswerPlan, type FreshMappingResolution } from "./answer/transactionalExecutor";
import { equivalentQuestionOwnersInRoot, observeLiveQuestion, QUESTION_OWNER_SELECTOR } from "./liveQuestionObservation";
import { clearQuestionRevisionAttemptForBlock, hasQuestionRevisionAttempt, isCurrentQuestionRevisionBlock, STALE_ROOT_CONTEXT } from "./revision/questionRevisionRuntime";
import { routeFingerprintForLocation } from "./revision/questionRevisionRegistry";
import { rebindRuntimeQuestionHandleOwner, rootAttachmentOf, runtimeQuestionHandleRecord, TOP_ROOT_GENERATION, TOP_ROOT_KEY, topRootContext } from "./roots/rootContext";
import { isCurrentRootContext, resolveFillRootContext, rootContextOwnsElement, sharedRootRegistry } from "./roots/rootRegistry";

const solveStartSnapshots = new Map<string, { controls: ReturnType<typeof snapshotControls>; stableId: string; contentFingerprint: string }>();
const autoSnapshotStatus = new Map<string, "captured" | "unavailable">();
// Runtime solve-start state is root-scoped: identical semantic questions in
// different accessible roots must never share a baseline (or a snapshot key).
const snapshotKey = (block: QuestionBlock) => `${rootAttachmentOf(block).rootKey ?? "root-top"}:${block.identity?.stableId ?? block.id}:${block.identity?.contentFingerprint ?? block.id}`;

/** Called by the auto-solve parser before the provider request; runtime only. */
export function captureSolveStartControlState(block: QuestionBlock): void {
  const key = snapshotKey(block);
  // An auto-solve attempt owns this baseline. Provider/review retries must not
  // replace it after a user has interacted with the question.
  if (autoSnapshotStatus.has(key)) return;
  autoSnapshotStatus.set(key, "unavailable");
  const rootContext = resolveFillRootContext(sharedRootRegistry(), block);
  if (!rootContext.ok) return;
  let scope: Element;
  try {
    scope = rootContext.owner
      ?? (rootContext.shadowRoot
      ? resolveShadowQuestionScope(rootContext.shadowRoot, rootContext.localBBox, block) ?? rootContext.shadowRoot.host
      : resolveQuestionScope(normalizeBBoxToViewport(rootContext.localBBox), scopeSelectors, rootContext.doc));
  } catch {
    // Scope resolution unavailable in this root (e.g. no elementsFromPoint):
    // the snapshot stays "unavailable" and every fill fails closed.
    return;
  }
  const mapping = buildControlMapping(block, scope);
  if (mapping.ok) {
    const live = observeLiveQuestion(block, mapping.owner).identity;
    solveStartSnapshots.set(key, { controls: snapshotControls(mapping), stableId: live.stableId, contentFingerprint: live.contentFingerprint });
    autoSnapshotStatus.set(key, "captured");
  }
}

export function finishAutoSolveQuestionAttempt(block: QuestionBlock): void {
  const key = snapshotKey(block);
  solveStartSnapshots.delete(key);
  autoSnapshotStatus.delete(key);
  clearQuestionRevisionAttemptForBlock(block);
}

/** Runtime-only, read-only test seam; no DOM or user answer data is exposed. */
export function hasAutoSolveQuestionAttempt(block: QuestionBlock): boolean {
  return autoSnapshotStatus.has(snapshotKey(block));
}

const TEXT_INPUT_SELECTOR = [
  "input:not([type='radio'])",
  "input:not([type='checkbox'])",
  "input:not([type='hidden'])",
  "input:not([type='button'])",
  "input:not([type='submit'])",
  "textarea",
  "[contenteditable='true']",
].join(",");

const CHOICE_INPUT_SELECTOR = "input[type='radio'],input[type='checkbox']";
const OPTION_ROW_SELECTOR = "li,label,div,p,span";
const CODE_EDITOR_SELECTOR = ".cm-content[contenteditable='true'], .monaco-editor [contenteditable='true']";

const choiceHelperDeps = {
  clickElement,
  compareRectPosition,
  dispatchChoiceEvents,
  intersectionArea,
  isVisible,
  normalizeText,
  pause,
  rectIntersectsExpandedBBox,
  requestRealClick,
  setNativeChecked,
};

const scopeSelectors = {
  textInputSelector: TEXT_INPUT_SELECTOR,
  choiceInputSelector: CHOICE_INPUT_SELECTOR,
};

type ResolvedFillScope = { ok: true; doc: Document; localBBox: BoundingBox; shadowRoot: ShadowRoot | null; owner: Element | null } | { ok: false; message: string };

/**
 * Locate a question scope inside an open shadow root. Identity match wins:
 * the canonical stableId proves ownership without geometry. Geometry is only
 * a fallback hint; the root boundary itself is already component-scoped.
 */
function resolveShadowQuestionScope(shadowRoot: ShadowRoot, bbox: BoundingBox, block: QuestionBlock): Element | null {
  const candidates = Array.from(shadowRoot.querySelectorAll(".question-item,.questionBox,.base-question-component"))
    .filter((el): el is HTMLElement =>isHtmlElementNode( el) && !isExtensionUiElement(el) && isVisible(el));
  if (!candidates.length) return null;
  if (block.identity?.stableId) {
    for (const candidate of candidates) {
      if (observeLiveQuestion(block, candidate).identity.stableId === block.identity.stableId) return candidate;
    }
  }
  let best: Element | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    const inter = intersectionArea(rect, bbox);
    if (inter <= 0) continue;
    const area = Math.max(1, rect.width * rect.height);
    const bboxArea = Math.max(1, bbox.width * bbox.height);
    const score = (inter / Math.min(area, bboxArea)) * 140 + candidate.querySelectorAll("input,textarea,[contenteditable='true'],button").length * 6;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best ?? candidates[0]!;
}

/**
 * Resolves the fill context for a question. Root-aware: frame-owned questions
 * resolve inside their frame document with local coordinates, shadow-owned
 * questions hit-test within their open shadow root. A root that disappeared
 * or was replaced since detection fails closed.
 */
function resolveFillScopeForBlock(block: QuestionBlock): ResolvedFillScope {
  const rootContext = resolveFillRootContextForTransaction(block);
  if (!rootContext.ok) return { ok: false, message: rootContext.reason };
  const { doc, shadowRoot, localBBox } = rootContext;
  return { ok: true, doc, localBBox, shadowRoot, owner: rootContext.owner };
}

/** Recover only an exact, unique owner inside the attachment's already-authorized root. */
function resolveFillRootContextForTransaction(block: QuestionBlock, allowEquivalentOwnerRebind = false) {
  const registry = sharedRootRegistry();
  const current = resolveFillRootContext(registry, block);
  if (current.ok || current.reason !== "STALE_RUNTIME_QUESTION_HANDLE" || block.source !== "auto_dom" || !allowEquivalentOwnerRebind) return current;
  const record = runtimeQuestionHandleRecord(block);
  if (!record) return current;
  const { attachment } = record;
  const context = attachment.rootKey === TOP_ROOT_KEY
    ? (attachment.rootGeneration === TOP_ROOT_GENERATION ? topRootContext(document) : null)
    : registry.get(attachment.rootKey) ?? null;
  if (!context) return current;
  if (attachment.rootKey !== TOP_ROOT_KEY && !isCurrentRootContext(registry, attachment.rootKey, attachment.rootGeneration)) {
    return { ok: false as const, reason: "STALE_ROOT_CONTEXT" as const };
  }
  const root = context.root;
  const candidates = equivalentQuestionOwnersInRoot(block, root);
  if (candidates.length !== 1 || !rebindRuntimeQuestionHandleOwner(block, candidates[0]!, attachment)) return current;
  return resolveFillRootContext(registry, block);
}

function resolveTransactionOwner(
  block: QuestionBlock,
  rootContext: NonNullable<Extract<ReturnType<typeof resolveFillRootContextForTransaction>, { ok: true }>["context"]>,
  runtimeOwner: Element | null,
  fallback: Element,
  stableId: string,
  contentFingerprint: string,
  allowEquivalentOwnerRebind: boolean,
): Element | null {
  const isExactOwner = (owner: Element) => {
    if (!owner.isConnected || !rootContextOwnsElement(rootContext, owner)) return false;
    const identity = observeLiveQuestion(block, owner).identity;
    return identity.stableId === stableId && identity.contentFingerprint === contentFingerprint;
  };
  if (runtimeOwner && isExactOwner(runtimeOwner)) return runtimeOwner;
  if (isExactOwner(fallback)) return fallback;
  if (!allowEquivalentOwnerRebind) return null;
  const exact = Array.from(rootContext.root.querySelectorAll(QUESTION_OWNER_SELECTOR)).filter((candidate) => {
    const identity = observeLiveQuestion(block, candidate).identity;
    return identity.stableId === stableId && identity.contentFingerprint === contentFingerprint;
  });
  const matches = exact.filter((candidate) => !exact.some((other) => other !== candidate && other.contains(candidate)));
  return matches.length === 1 && isExactOwner(matches[0]!) ? matches[0]! : null;
}

export async function fillParsedAnswerInPage(block: QuestionBlock, result: ParseResult, options: { mode?: "auto" | "manual" } = {}): Promise<FillAnswerResult> {
  const resolved = resolveFillScopeForBlock(block);
  if (!resolved.ok) {
    return { ok: false, filledCount: 0, message: resolved.message, stopAutomation: true };
  }
  const { doc, localBBox, shadowRoot, owner } = resolved;

  // Runtime candidates are bound to the exact owner resolved from the opaque
  // content-side handle. This also keeps shadow candidates inside their root.
  if (owner) return fillVerifiedAnswerIntoScope(owner, block, result, options.mode ?? "manual");

  if (shadowRoot) {
    const shadowScope = resolveShadowQuestionScope(shadowRoot, localBBox, block) ?? shadowRoot.host;
    if (shadowScope) {
      return fillVerifiedAnswerIntoScope(shadowScope, block, result, options.mode ?? "manual");
    }
    return { ok: false, filledCount: 0, message: STALE_ROOT_CONTEXT, code: STALE_ROOT_CONTEXT, stopAutomation: true };
  }

  const directScope = await resolveDirectQuestionScope(block, result, doc).catch(() => null);
  if (directScope) {
    return fillVerifiedAnswerIntoScope(directScope.scope, block, result, options.mode ?? "manual");
  }

  ensureQuestionRegionVisible(localBBox);
  const viewportBbox = normalizeBBoxToViewport(localBBox);
  let scope = resolveQuestionScope(viewportBbox, scopeSelectors, doc);
  if (shouldRelocateScope(scope, block, result)) {
    const relocatedFirst = await relocateQuestionScopeByText(block, result, doc);
    if (relocatedFirst) {
      scope = relocatedFirst.scope;
    }
  }

  return fillVerifiedAnswerIntoScope(scope, block, result, options.mode ?? "manual");
}

export function verifyParsedAnswerInPage(block: QuestionBlock, result: ParseResult): VerifyAnswerResult {
  // Verification must run in the question's own root: a shadow/frame question
  // verified against the top document always fails closed with a bogus scope.
  const rootContext = resolveFillRootContextForTransaction(block);
  if (!rootContext.ok) return { ok: false, expectedKeys: [], actualKeys: [], message: rootContext.reason };
  const { doc, shadowRoot, localBBox, owner } = rootContext;

  if (owner) return verifyVerifiedAnswerInScope(owner, block, result);

  if (shadowRoot) {
    const shadowScope = resolveShadowQuestionScope(shadowRoot, localBBox, block) ?? shadowRoot.host;
    if (shadowScope) return verifyVerifiedAnswerInScope(shadowScope, block, result);
    return { ok: false, expectedKeys: [], actualKeys: [], message: STALE_ROOT_CONTEXT };
  }

  const directScope = resolveDirectQuestionScopeSync(block, result, doc);
  if (directScope) {
    return verifyVerifiedAnswerInScope(directScope.scope, block, result);
  }

  let scope = resolveQuestionScope(normalizeBBoxToViewport(localBBox), scopeSelectors, doc);
  if (shouldRelocateScope(scope, block, result)) {
    const relocatedFirst = relocateQuestionScopeByTextSync(block, result, doc);
    if (relocatedFirst) {
      scope = relocatedFirst.scope;
    }
  }

  return verifyVerifiedAnswerInScope(scope, block, result);
}

async function fillVerifiedAnswerIntoScope(scope: Element, block: QuestionBlock, result: ParseResult, mode: "auto" | "manual"): Promise<FillAnswerResult> {
  const key = snapshotKey(block); const autoStatus = autoSnapshotStatus.get(key);
  const solveStart = solveStartSnapshots.get(key);
  if (mode === "auto" && (autoStatus !== "captured" || !solveStart)) return { ok: false, filledCount: 0, message: "USER_STATE_SNAPSHOT_UNAVAILABLE", code: "STALE_MUTATION_AUTHORITY", stopAutomation: false };
  if (mode === "auto" && hasQuestionRevisionAttempt() && !isCurrentQuestionRevisionBlock(block)) return { ok: false, filledCount: 0, message: "STALE_QUESTION_REVISION", code: "STALE_QUESTION_REVISION", stopAutomation: true };
  const startRoot = rootAttachmentOf(block);
  const startRoute = routeFingerprintForLocation();
  const firstContext = resolveFillRootContextForTransaction(block);
  if (!firstContext.ok) return { ok: false, filledCount: 0, message: firstContext.reason, code: firstContext.reason, stopAutomation: true };
  const initialMapping = buildControlMapping(block, scope);
  if (!initialMapping.ok) return { ok: false, filledCount: 0, message: initialMapping.code, code: initialMapping.code, stopAutomation: true };
  const initialIdentity = observeLiveQuestion(block, initialMapping.owner).identity;
  const authorityIdentity = block.identity ?? initialIdentity;
  if (initialIdentity.stableId !== authorityIdentity.stableId || initialIdentity.contentFingerprint !== authorityIdentity.contentFingerprint) {
    return { ok: false, filledCount: 0, message: "STALE_ACTION_PLAN", code: "STALE_MUTATION_AUTHORITY", stopAutomation: true };
  }
  const resolveFreshMapping = (allowEquivalentOwnerRebind = false): FreshMappingResolution => {
    if (routeFingerprintForLocation() !== startRoute) return { ok: false, code: "STALE_MUTATION_AUTHORITY" };
    if (mode === "auto" && hasQuestionRevisionAttempt() && !isCurrentQuestionRevisionBlock(block)) return { ok: false, code: "STALE_MUTATION_AUTHORITY" };
    const root = resolveFillRootContextForTransaction(block, allowEquivalentOwnerRebind);
    if (!root.ok || root.context.rootKey !== startRoot.rootKey || root.context.rootGeneration !== startRoot.rootGeneration) {
      return { ok: false, code: "STALE_MUTATION_AUTHORITY" };
    }
    const owner = resolveTransactionOwner(block, root.context, root.owner, scope, authorityIdentity.stableId, authorityIdentity.contentFingerprint, allowEquivalentOwnerRebind);
    if (!owner) return { ok: false, code: "CONTROL_MAPPING_AMBIGUOUS" };
    const mapping = buildControlMapping(block, owner);
    if (!mapping.ok) return { ok: false, code: "CONTROL_MAPPING_AMBIGUOUS" };
    const live = observeLiveQuestion(block, mapping.owner).identity;
    if (live.stableId !== authorityIdentity.stableId || live.contentFingerprint !== authorityIdentity.contentFingerprint
      || (solveStart && (solveStart.stableId !== live.stableId || solveStart.contentFingerprint !== live.contentFingerprint))) {
      return { ok: false, code: "STALE_MUTATION_AUTHORITY" };
    }
    return { ok: true, mapping };
  };
  const prepared = resolveFreshMapping();
  if (!prepared.ok) return { ok: false, filledCount: 0, message: prepared.code === "STALE_MUTATION_AUTHORITY" ? "STALE_ACTION_PLAN" : prepared.code, code: prepared.code, stopAutomation: true };
  const validated = buildValidatedAnswerPlan(block, result, prepared.mapping);
  if (!validated.ok) return { ok: false, filledCount: 0, message: validated.code, code: validated.code, stopAutomation: true };
  const outcome = await executeTransaction(validated.plan, buildActionPlan(validated.plan, prepared.mapping), prepared.mapping, solveStart?.controls, resolveFreshMapping);
  return {
    ok: outcome.outcome === "FILLED_VERIFIED" || outcome.outcome === "NO_CHANGE_NEEDED",
    filledCount: outcome.filledCount,
    message: outcome.outcome,
    code: outcome.outcome,
    stopAutomation: outcome.stopAutomation,
    rolledBack: outcome.rolledBack,
  };
}

function verifyVerifiedAnswerInScope(scope: Element, block: QuestionBlock, result: ParseResult): VerifyAnswerResult {
  const mapping = buildControlMapping(block, scope);
  if (!mapping.ok) return { ok: false, expectedKeys: [], actualKeys: [], message: mapping.code };
  const validated = buildValidatedAnswerPlan(block, result, mapping);
  if (!validated.ok) return { ok: false, expectedKeys: [], actualKeys: [], message: validated.code };
  return { ok: verifyAnswerPlan(validated.plan, mapping), expectedKeys: validated.plan.kind === "boolean" ? [validated.plan.optionKey ?? ""] : "optionKeys" in validated.plan ? validated.plan.optionKeys : [], actualKeys: readSelectedOptionKeys(mapping), message: "DOM readback verification" };
}

export async function fillAnswerIntoScope(scope: Element, bbox: BoundingBox, result: ParseResult): Promise<FillAnswerResult> {
  const domInferredType = inferTypeFromAnswerCore(
    scope,
    result.answer,
    TEXT_INPUT_SELECTOR,
    CHOICE_INPUT_SELECTOR,
    OPTION_ROW_SELECTOR,
    normalizeText,
  );
  const effectiveType = resolveEffectiveQuestionType(result.questionType, domInferredType);

  if (effectiveType === "single_choice" || effectiveType === "multi_choice" || effectiveType === "judge") {
    return fillChoiceLikeAnswer(scope, bbox, result, effectiveType);
  }

  return fillTextLikeAnswer(scope, bbox, result, effectiveType);
}

export function verifyAnswerInScope(scope: Element, bbox: BoundingBox, result: ParseResult): VerifyAnswerResult {
  const domInferredType = inferTypeFromAnswerCore(
    scope,
    result.answer,
    TEXT_INPUT_SELECTOR,
    CHOICE_INPUT_SELECTOR,
    OPTION_ROW_SELECTOR,
    normalizeText,
  );
  const effectiveType = resolveEffectiveQuestionType(result.questionType, domInferredType);

  if (effectiveType !== "single_choice" && effectiveType !== "multi_choice" && effectiveType !== "judge") {
    return { ok: true, expectedKeys: [], actualKeys: [], message: "non-choice" };
  }

  return verifyChoiceAnswerInScope(scope, bbox, result, effectiveType, choiceHelperDeps);
}

export function splitAnswerParts(answer: string, expectedCount: number): string[] {
  return splitAnswerPartsCore(answer, expectedCount);
}

export function normalizeChoiceAnswerKeys(answer: string, questionType: ParseResult["questionType"]): string[] {
  return normalizeChoiceAnswerKeysCore(answer, questionType);
}

function resolveEffectiveQuestionType(
  parsedType: ParseResult["questionType"],
  domType: ParseResult["questionType"],
): ParseResult["questionType"] {
  if (parsedType === "unknown") return domType;
  if (domType === "unknown") return parsedType;

  const domIsChoice = domType === "single_choice" || domType === "multi_choice" || domType === "judge";
  const parsedIsText = parsedType === "fill_blank" || parsedType === "short_answer";
  if (domIsChoice && parsedIsText) return domType;

  return parsedType;
}

async function fillChoiceLikeAnswer(
  scope: Element,
  bbox: BoundingBox,
  result: ParseResult,
  questionType: ParseResult["questionType"],
): Promise<FillAnswerResult> {
  return fillChoiceLikeAnswerCore(scope, bbox, result, questionType, choiceHelperDeps);
}

function fillTextLikeAnswer(
  scope: Element,
  bbox: BoundingBox,
  result: ParseResult,
  questionType: ParseResult["questionType"],
): FillAnswerResult {
  const controls = collectTextControls(scope, bbox, TEXT_INPUT_SELECTOR);
  if (!controls.length) {
    const fallback = tryFillCodeEditor(result, questionType);
    if (fallback) return fallback;
    return { ok: false, filledCount: 0, message: "未找到文本输入框" };
  }

  const answerSource = resolveTextAnswerSourceCore(result, controls.length, questionType);
  if (!answerSource) {
    return { ok: false, filledCount: 0, message: "答案需人工确认，未自动填写" };
  }

  const parts = splitAnswerPartsCore(answerSource, controls.length);
  const values = controls.length === 1
    ? [normalizeTextLikeAnswerForControl(formatSingleTextAnswerCore(answerSource, questionType), questionType)]
    : buildControlValuesCore(parts, controls.length, answerSource);

  let filledCount = 0;
  controls.forEach((control, index) => {
    const nextValue = values[index] ?? "";
    if (!nextValue) return;
    if (applyTextValue(control, nextValue)) filledCount += 1;
  });

  return filledCount > 0
    ? { ok: true, filledCount, message: `已填入 ${filledCount} 个输入框` }
    : { ok: false, filledCount: 0, message: "未写入任何输入框" };
}

function tryFillCodeEditor(
  result: ParseResult,
  questionType: ParseResult["questionType"],
): FillAnswerResult | null {
  if (!looksLikeCodeAnswer(result.answer, questionType)) return null;

  const editor = findBestCodeEditor();
  if (!editor) return null;

  const nextValue = normalizeCodeForEditor(formatSingleTextAnswerCore(result.answer, "short_answer"));
  if (!nextValue) {
    return { ok: false, filledCount: 0, message: "答案为空，无法填写代码" };
  }

  const changed = applyTextValue(editor, nextValue);
  return changed
    ? { ok: true, filledCount: 1, message: "已填入 1 个代码编辑器" }
    : { ok: false, filledCount: 0, message: "代码编辑器内容未发生变化" };
}

function findBestCodeEditor(): HTMLElement | null {
  const editors = Array.from(document.querySelectorAll(CODE_EDITOR_SELECTOR))
    .filter((node): node is HTMLElement =>isHtmlElementNode( node))
    .filter((node) => isVisible(node) && node.isContentEditable);
  if (!editors.length) return null;

  return editors
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter((entry) => entry.rect.width > 10 && entry.rect.height > 10)
    .sort((a, b) => {
      const ax = a.rect.left + a.rect.width / 2;
      const bx = b.rect.left + b.rect.width / 2;
      return bx - ax || b.rect.height - a.rect.height;
    })[0]?.node ?? null;
}

function looksLikeCodeAnswer(answer: string, questionType: ParseResult["questionType"]): boolean {
  if (questionType !== "short_answer") return false;
  const text = String(answer || "").trim();
  if (!text || /需人工确认/.test(text)) return false;
  return /#include|int\s+\*?\s*[A-Za-z_]\w*\s*\(|char\s+\*?\s*[A-Za-z_]\w*\s*\(|void\s+[A-Za-z_]\w*\s*\(|return\s+|for\s*\(|while\s*\(|if\s*\(|\{[\s\S]*\}/.test(text);
}

function normalizeCodeForEditor(code: string): string {
  const source = String(code || "").replace(/\r\n?/g, "\n");
  if (!source) return "";

  let out = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of source) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
      continue;
    }

    if (ch === "\"" && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (ch === "\n" && (inSingle || inDouble)) {
      out += "\\n";
      continue;
    }

    out += ch;
  }

  return out;
}

function normalizeTextLikeAnswerForControl(answer: string, questionType: ParseResult["questionType"]): string {
  if (!looksLikeCodeAnswer(answer, questionType)) return answer;
  return normalizeCodeForEditor(answer);
}
