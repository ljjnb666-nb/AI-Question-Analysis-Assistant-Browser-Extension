import type { QuestionBlock } from "@/shared/types";
import { stableHash } from "../questionIdentity";
import { discoverControls } from "./controlDiscovery";
import { controlRegistry, type ControlMappingReason, type ControlRef } from "./controlRegistry";
import { countExpectedBlankParts } from "../autoSolveHeuristics";
import { resolveCanonicalQuestionOwner } from "../liveQuestionObservation";
import { TOP_ROOT_KEY } from "../roots/rootContext";
import { sharedRootRegistry } from "../roots/rootRegistry";
import { getTraversalRoot } from "../roots/rootDom";
import { isVisible, normalizeText } from "../answerDomUtils";

export type ControlMappingFailure = "CONTROL_MAPPING_AMBIGUOUS" | "CONTROL_NOT_FOUND" | "CONTROL_COUNT_MISMATCH";
export type ControlMappingResult = { ok: true; questionId: string; owner: Element; options: Map<string, ControlRef>; blanks: ControlRef[]; text: ControlRef | null; confidence: number } | { ok: false; code: ControlMappingFailure; message: string };

export function normalizeOptionKey(text: string): string | null {
  const match = String(text).trim().replace(/\u3000/g, " ").match(/(?:^|\s|[（(])([A-Fa-fＡ-Ｆ])\s*(?:[.、):：]|[）)\s])/);
  return match ? match[1].normalize("NFKC").toUpperCase() : null;
}
export function booleanKey(text: string): boolean | null {
  const normalized = String(text).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  if (/(正确|对|true|yes)(?:$|[，,。.])/i.test(normalized)) return true;
  if (/(错误|错|false|no)(?:$|[，,。.])/i.test(normalized)) return false;
  return null;
}

export function buildControlMapping(block: QuestionBlock, owner: Element): ControlMappingResult {
  const questionId = block.identity?.stableId ?? block.id;
  const semanticOwner = resolveCanonicalQuestionOwner(block, owner);
  if (!semanticOwner) return { ok: false, code: "CONTROL_MAPPING_AMBIGUOUS", message: "Supplied owner contains multiple independent questions" };
  const options = new Map<string, ControlRef>();
  const blanks: ControlRef[] = [];
  const textControls: ControlRef[] = [];
  // Runtime control ids are root-scoped: identical labels in different roots
  // must never alias into the same registry entry.
  const controlRootKey = sharedRootRegistry().rootKeyOfRoot(getTraversalRoot(semanticOwner)) ?? TOP_ROOT_KEY;
  for (const found of discoverControls(semanticOwner)) {
    if (found.controlType === "custom-choice" && found.element.querySelector("input[type=radio],input[type=checkbox]")) continue;
    if (!found.visible || !found.enabled) continue;
    const key = normalizeOptionKey(found.text);
    const role = found.controlType === "radio" || found.controlType === "checkbox" || found.controlType === "custom-choice" ? "option" : found.controlType === "text" || found.controlType === "textarea" || found.controlType === "contenteditable" ? "blank" : null;
    if (!role) continue;
    const reason: ControlMappingReason[] = key ? ["EXPLICIT_LABEL"] : [];
    const blankEvidence = role === "blank" ? blankIndexEvidence(found.element, found.text) : null;
    const blankIndex = blankEvidence?.index ?? blanks.length;
    const ref: ControlRef = { controlId: `control_v1_${stableHash(`${questionId}\u001f${controlRootKey}\u001f${role}\u001f${key ?? blankIndex}\u001f${found.text}`)}`, questionId, role, optionKey: key ?? undefined, blankIndex: role === "blank" ? blankIndex : undefined, controlType: found.controlType, semanticFingerprint: semanticFingerprintForControl(found.element, { controlType: found.controlType, role, optionKey: key ?? undefined, blankIndex, semanticText: found.text }), semanticText: found.text, enabled: found.enabled, visible: found.visible, confidence: key ? 1 : blankEvidence ? .95 : .75, reasons: blankEvidence ? ["SEMANTIC_CONTAINER"] : reason };
    controlRegistry.put(ref, found.element, semanticOwner);
    if (role === "option") {
      if (!key) continue;
      if (options.has(key)) return { ok: false, code: "CONTROL_MAPPING_AMBIGUOUS", message: `Multiple active controls map to ${key}` };
      options.set(key, ref);
    } else { blanks[blankIndex] = ref; textControls.push(ref); }
  }
  const text = textControls.length === 1 ? textControls[0] : null;
  const expectedBlanks = countExpectedBlankParts(block.previewText);
  if (block.questionTypeGuess === "short_answer" && text) { text.confidence = .95; text.reasons.push("UNIQUE_TEXT_CONTROL"); }
  if (block.questionTypeGuess === "fill_blank" && expectedBlanks > 0 && blanks.length === expectedBlanks && blanks.every(Boolean)) {
    // Cardinality is corroboration only. Each blank still needs independent index evidence.
    for (const ref of blanks) if (ref.confidence >= .95) ref.reasons.push("SEMANTIC_BLANK_COUNT");
  }
  const confidence = options.size || blanks.length ? Math.min(...[...options.values(), ...blanks].map((ref) => ref.confidence)) : 0;
  return { ok: true, questionId, owner: semanticOwner, options, blanks, text, confidence };
}

function blankIndexEvidence(element: HTMLElement, text: string): { index: number; signature: string } | null {
  const sources = [element.getAttribute("data-blank-index"), element.getAttribute("data-index"), element.getAttribute("aria-label"), element.getAttribute("name"), element.getAttribute("id"), element.closest("label")?.textContent, element.parentElement?.textContent, text];
  for (const source of sources) {
    const match = String(source || "").match(/(?:blank|空|\(|（|^\s*)(\d{1,3})(?:\)|）|\s|$)/i);
    if (match) return { index: Number(match[1]) - 1, signature: `blank:${match[1]}` };
  }
  return null;
}

export function semanticFingerprintForControl(element: HTMLElement, ref: Pick<ControlRef, "controlType" | "role" | "optionKey" | "blankIndex" | "semanticText">): string {
  const text = normalizeText([element.getAttribute("aria-label"), element.id && element.ownerDocument.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent, element.closest("label")?.textContent, element.textContent].filter(Boolean).join(" "));
  const optionKey = normalizeOptionKey(text);
  const blank = ref.role === "blank" ? blankIndexEvidence(element, text)?.signature ?? `anonymous:${ref.blankIndex ?? ""}` : "";
  return stableHash(`${ref.controlType}\u001f${ref.role === "option" ? optionKey ?? text : blank || text}`);
}

export function controlIsVisibleAndEnabled(element: HTMLElement): boolean {
  return isVisible(element) && !element.hidden && element.getAttribute("aria-hidden") !== "true" && !(element as HTMLInputElement).disabled && element.getAttribute("aria-disabled") !== "true";
}
