import type { QuestionBlock } from "@/shared/types";
import { stableHash } from "../questionIdentity";
import { discoverControls } from "./controlDiscovery";
import { controlRegistry, type ControlMappingReason, type ControlRef } from "./controlRegistry";

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
  const options = new Map<string, ControlRef>();
  const blanks: ControlRef[] = [];
  const textControls: ControlRef[] = [];
  for (const found of discoverControls(owner)) {
    if (!found.visible || !found.enabled) continue;
    const key = normalizeOptionKey(found.text);
    const role = found.controlType === "radio" || found.controlType === "checkbox" || found.controlType === "custom-choice" ? "option" : found.controlType === "text" || found.controlType === "textarea" || found.controlType === "contenteditable" ? "blank" : null;
    if (!role) continue;
    const reason: ControlMappingReason[] = key ? ["EXPLICIT_LABEL"] : [];
    const ref: ControlRef = { controlId: `control_v1_${stableHash(`${questionId}\u001f${role}\u001f${key ?? blanks.length}\u001f${found.text}`)}`, questionId, role, optionKey: key ?? undefined, blankIndex: role === "blank" ? blanks.length : undefined, controlType: found.controlType, semanticFingerprint: stableHash(`${found.controlType}\u001f${key ?? found.text}`), semanticText: found.text, enabled: found.enabled, visible: found.visible, confidence: key ? 1 : .75, reasons: reason };
    found.element.dataset.qsQuestionId = questionId;
    controlRegistry.put(ref, found.element);
    if (role === "option") {
      if (!key) continue;
      if (options.has(key)) return { ok: false, code: "CONTROL_MAPPING_AMBIGUOUS", message: `Multiple active controls map to ${key}` };
      options.set(key, ref);
    } else { blanks.push(ref); textControls.push(ref); }
  }
  const text = textControls.length === 1 ? textControls[0] : null;
  const confidence = options.size || blanks.length ? Math.min(...[...options.values(), ...blanks].map((ref) => ref.confidence)) : 0;
  return { ok: true, questionId, owner, options, blanks, text, confidence };
}
