import { isHtmlElementNode } from "../detector/domDetectorShared";
import { isHTMLInputInOwnerRealm, isHTMLTextAreaInOwnerRealm } from "../domRealm";
import { isVisible, normalizeText } from "../answerDomUtils";
import type { ControlType } from "./controlRegistry";

export interface DiscoveredControl { element: HTMLElement; controlType: ControlType; visible: boolean; enabled: boolean; text: string; }
const SELECTOR = "input[type=radio],input[type=checkbox],input:not([type]),input[type=text],textarea,[contenteditable=true],[role=radio],[role=checkbox],[role=option],[aria-checked],button,[role=button],.option-item,.option,.choice-item,[data-option-key]";

/** O(N) in the supplied question owner subtree; it deliberately never scans document. */
export function discoverControls(owner: Element): DiscoveredControl[] {
  const seen = new Set<Element>();
  const out: DiscoveredControl[] = [];
  const push = (element: HTMLElement, controlType: ControlType) => {
    if (seen.has(element)) return;
    seen.add(element);
    out.push({
      element,
      controlType,
      visible: isVisible(element) && !element.hidden && element.getAttribute("aria-hidden") !== "true",
      enabled: !isDisabled(element),
      text: normalizeText(controlText(element)),
    });
  };
  for (const node of owner.querySelectorAll(SELECTOR)) {
    if (!isHtmlElementNode(node)) continue;
    const element = node as HTMLElement;
    const controlType = getControlType(element);
    // Visually-hidden native choice input (e.g. Element Plus .el-radio__original
    // with opacity:0): the input itself can never be the click target, but its
    // visible <label> wrapper is. Register the label as the proxy control.
    if ((controlType === "radio" || controlType === "checkbox") && isTransparentlyHidden(element)) {
      const proxy = choiceLabelProxy(element);
      if (proxy) {
        push(proxy, "custom-choice");
        continue;
      }
    }
    push(element, controlType);
  }
  return [...out, ...discoverEditorIframeBodies(owner)];
}

/**
 * Rendered but fully transparent (opacity:0), e.g. Element Plus choice inputs.
 * display:none elements are excluded: they are not activation targets either.
 */
function isTransparentlyHidden(el: HTMLElement): boolean {
  const style = (el.ownerDocument?.defaultView ?? window).getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity === "0";
}

/** Nearest visible <label> wrapping a transparently-hidden choice input. */
function choiceLabelProxy(el: HTMLElement): HTMLElement | null {
  if ((el as HTMLInputElement).disabled) return null;
  const label = el.closest("label");
  if (label && isHtmlElementNode(label) && isVisible(label) && !label.hidden) return label;
  return null;
}

/**
 * Rich-text editors (UEditor/TinyMCE/CKEditor/Quill/…) render the editable
 * surface inside a same-origin iframe; the host page only keeps a hidden
 * textarea. querySelectorAll never descends into iframe documents, so without
 * this, subjective questions on such pages have no fillable control at all.
 */
const EDITOR_IFRAME_HINT = /ueditor|edui|tinymce|cke_|ckeditor|quill|froala|kindeditor|nicedit|wangEditor/i;

function getReadableIframeDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    return null; // Cross-origin: not readable, not fillable.
  }
}

function discoverEditorIframeBodies(owner: Element): DiscoveredControl[] {
  const out: DiscoveredControl[] = [];
  for (const node of owner.querySelectorAll("iframe")) {
    if (!isHtmlElementNode(node)) continue;
    const iframe = node as HTMLIFrameElement;
    const doc = getReadableIframeDocument(iframe);
    if (!doc) continue;
    const body = doc.body;
    if (!body) continue;
    const hint = `${iframe.id} ${iframe.name} ${iframe.className} ${iframe.title}`;
    if (!EDITOR_IFRAME_HINT.test(hint) && !body.isContentEditable && doc?.designMode !== "on") continue;
    if (!isVisible(iframe) || !isVisible(body)) continue;
    out.push({ element: body, controlType: "contenteditable", visible: true, enabled: true, text: "" });
  }
  return out;
}

function getControlType(el: HTMLElement): ControlType {
  if (isHTMLInputInOwnerRealm(el)) return el.type === "radio" ? "radio" : el.type === "checkbox" ? "checkbox" : "text";
  if (isHTMLTextAreaInOwnerRealm(el)) return "textarea";
  if (el.isContentEditable) return "contenteditable";
  return "custom-choice";
}
function isDisabled(el: HTMLElement) { return Boolean((el as HTMLInputElement).disabled || el.getAttribute("aria-disabled") === "true"); }
function controlText(el: HTMLElement): string {
  const label = el.id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "";
  return [el.getAttribute("aria-label"), (el as HTMLInputElement).value, label, el.closest("label")?.textContent, el.textContent].filter(Boolean).join(" ");
}
