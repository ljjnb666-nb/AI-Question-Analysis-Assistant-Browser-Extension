import { isVisible, normalizeText } from "../answerDomUtils";
import type { ControlType } from "./controlRegistry";

export interface DiscoveredControl { element: HTMLElement; controlType: ControlType; visible: boolean; enabled: boolean; text: string; }
const SELECTOR = "input[type=radio],input[type=checkbox],input:not([type]),input[type=text],textarea,[contenteditable=true],[role=radio],[role=checkbox],[role=option],[aria-checked],button,[role=button],.option-item,.option,.choice-item,[data-option-key]";

/** O(N) in the supplied question owner subtree; it deliberately never scans document. */
export function discoverControls(owner: Element): DiscoveredControl[] {
  return Array.from(owner.querySelectorAll(SELECTOR)).filter((node): node is HTMLElement => node instanceof HTMLElement).map((element) => ({
    element,
    controlType: getControlType(element),
    visible: isVisible(element) && !element.hidden && element.getAttribute("aria-hidden") !== "true",
    enabled: !isDisabled(element),
    text: normalizeText(controlText(element)),
  }));
}

function getControlType(el: HTMLElement): ControlType {
  if (el instanceof HTMLInputElement) return el.type === "radio" ? "radio" : el.type === "checkbox" ? "checkbox" : "text";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el.isContentEditable) return "contenteditable";
  return "custom-choice";
}
function isDisabled(el: HTMLElement) { return Boolean((el as HTMLInputElement).disabled || el.getAttribute("aria-disabled") === "true"); }
function controlText(el: HTMLElement): string {
  const label = el.id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "";
  return [el.getAttribute("aria-label"), (el as HTMLInputElement).value, label, el.closest("label")?.textContent, el.textContent].filter(Boolean).join(" ");
}
