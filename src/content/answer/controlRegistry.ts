export type ControlRole = "option" | "blank" | "text-answer";
export type ControlType = "radio" | "checkbox" | "text" | "textarea" | "contenteditable" | "custom-choice";
export type ControlMappingReason = "EXPLICIT_LABEL" | "INPUT_VALUE" | "ASSOCIATED_LABEL" | "WRAPPING_LABEL" | "ARIA_LABEL" | "SEMANTIC_CONTAINER" | "DOM_ORDER_FALLBACK";

export interface ControlRef {
  controlId: string;
  questionId: string;
  role: ControlRole;
  optionKey?: string;
  blankIndex?: number;
  controlType: ControlType;
  semanticFingerprint: string;
  semanticText?: string;
  enabled: boolean;
  visible: boolean;
  confidence: number;
  reasons: ControlMappingReason[];
}

/** Runtime-only ownership of DOM nodes. Never serialize this registry. */
export class ControlRegistry {
  private readonly elements = new Map<string, { element: HTMLElement; questionId: string; semanticFingerprint: string; owner: Element }>();
  put(ref: ControlRef, element: HTMLElement, owner: Element) { this.elements.set(ref.controlId, { element, questionId: ref.questionId, semanticFingerprint: ref.semanticFingerprint, owner }); return ref; }
  get(controlId: string) { return this.elements.get(controlId)?.element ?? null; }
  metadata(controlId: string) { return this.elements.get(controlId) ?? null; }
  delete(controlId: string) { this.elements.delete(controlId); }
  clear(questionId?: string) {
    if (!questionId) return this.elements.clear();
    for (const [id, entry] of this.elements) if (entry.questionId === questionId) this.elements.delete(id);
  }
}

export const controlRegistry = new ControlRegistry();
