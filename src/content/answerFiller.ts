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
import type { FillAnswerCode, FillAnswerResult, VerifyAnswerResult } from "./answerTypes";
import { buildValidatedAnswerPlan } from "./answer/answerPlanValidator";
import { buildControlMapping } from "./answer/controlMapping";
import { buildActionPlan, executeTransaction, readSelectedOptionKeys, snapshotControls, verifyAnswerPlan, type CurrentTransactionAuthority } from "./answer/transactionalExecutor";
import { observeLiveQuestion } from "./liveQuestionObservation";
import { clearQuestionRevisionAttemptForBlock, hasQuestionRevisionAttempt, isCurrentQuestionRevisionBlock, STALE_ROOT_CONTEXT } from "./revision/questionRevisionRuntime";
import { rootAttachmentOf } from "./roots/rootContext";
import { resolveFillRootContext, sharedRootRegistry } from "./roots/rootRegistry";
import { getTraversalRoot } from "./roots/rootDom";

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

type ResolvedFillScope = { ok: true; doc: Document; localBBox: BoundingBox; shadowRoot: ShadowRoot | null; owner: Element | null } | { ok: false; code: FillAnswerCode; message: string };

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
  const rootContext = resolveFillRootContext(sharedRootRegistry(), block);
  if (!rootContext.ok) return { ok: false, code: rootContext.reason, message: rootContext.reason };
  const { doc, shadowRoot, localBBox } = rootContext;
  return { ok: true, doc, localBBox, shadowRoot, owner: rootContext.owner };
}

export async function fillParsedAnswerInPage(block: QuestionBlock, result: ParseResult, options: { mode?: "auto" | "manual" } = {}): Promise<FillAnswerResult> {
  const resolved = resolveFillScopeForBlock(block);
  if (!resolved.ok) {
    return { ok: false, filledCount: 0, code: resolved.code, message: resolved.message };
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
    return { ok: false, filledCount: 0, message: STALE_ROOT_CONTEXT };
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
  const rootContext = resolveFillRootContext(sharedRootRegistry(), block);
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
  if (mode === "auto" && (autoStatus !== "captured" || !solveStart)) return { ok: false, filledCount: 0, code: "USER_STATE_SNAPSHOT_UNAVAILABLE", message: "USER_STATE_SNAPSHOT_UNAVAILABLE" };

  const resolveAuthority = (): CurrentTransactionAuthority => {
    try {
      if (mode === "auto" && hasQuestionRevisionAttempt() && !isCurrentQuestionRevisionBlock(block)) {
        return { ok: false, code: "STALE_QUESTION_REVISION", message: "STALE_QUESTION_REVISION" };
      }
      const root = resolveFillRootContext(sharedRootRegistry(), block);
      if (!root.ok) return { ok: false, code: root.reason, message: root.reason };
      const candidateOwner = root.owner ?? scope;
      if (!candidateOwner.isConnected || candidateOwner.ownerDocument !== root.doc || getTraversalRoot(candidateOwner) !== root.context.root) {
        return { ok: false, code: "STALE_ROOT_CONTEXT", message: STALE_ROOT_CONTEXT };
      }
      const mapping = buildControlMapping(block, candidateOwner);
      if (!mapping.ok) return { ok: false, code: mapping.code, message: mapping.message };
      if (root.owner && mapping.owner !== root.owner && !root.owner.contains(mapping.owner)) {
        return { ok: false, code: "STALE_RUNTIME_QUESTION_HANDLE", message: "Fresh question mapping escaped its runtime owner" };
      }
      const identity = observeLiveQuestion(block, mapping.owner).identity;
      const stableId = block.identity?.stableId ?? block.id;
      const contentFingerprint = block.identity?.contentFingerprint ?? block.id;
      if (block.identity && (identity.stableId !== stableId || identity.contentFingerprint !== contentFingerprint)) {
        return { ok: false, code: "STALE_ACTION_PLAN", message: "Live question identity changed during fill" };
      }
      if (solveStart && (solveStart.stableId !== identity.stableId || solveStart.contentFingerprint !== identity.contentFingerprint)) {
        return { ok: false, code: "STALE_ACTION_PLAN", message: "Solve-start question identity changed during fill" };
      }
      return {
        ok: true,
        mapping,
        stableId,
        contentFingerprint,
        rootKey: root.context.rootKey,
        rootGeneration: root.context.rootGeneration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code: "CONTROL_MAPPING_CHANGED", message: `Fresh question mapping failed: ${message}` };
    }
  };

  const resolved = resolveAuthority();
  if (!resolved.ok) return { ok: false, filledCount: 0, code: resolved.code, message: resolved.code };
  try {
    const validated = buildValidatedAnswerPlan(block, result, resolved.mapping);
    if (!validated.ok) return { ok: false, filledCount: 0, code: validated.code, message: validated.message };
    const outcome = await executeTransaction(validated.plan, buildActionPlan(validated.plan, resolved.mapping), resolved.mapping, solveStart?.controls, resolveAuthority);
    return {
      ok: outcome.outcome === "FILLED_VERIFIED" || outcome.outcome === "NO_CHANGE_NEEDED",
      filledCount: outcome.filledCount,
      code: outcome.outcome,
      message: outcome.outcome,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, filledCount: 0, code: "PARTIAL_MUTATION_UNPROVABLE", message: `Transaction failed without a provable final state: ${message}` };
  }
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
