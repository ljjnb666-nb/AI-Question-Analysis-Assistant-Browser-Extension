import { getTraversalRoot } from "./roots/rootDom";
import { sharedRootRegistry, topViewportPointForElement } from "./roots/rootRegistry";
import type { BoundingBox } from "@/shared/types";
import { isHTMLInputInOwnerRealm, isHTMLTextAreaInOwnerRealm } from "./domRealm";

export function applyTextValue(control: HTMLElement, value: string): boolean {
  if (isHTMLInputInOwnerRealm(control)) {
    if (control.value === value) return false;
    control.focus();
    setNativeInputValue(control, value);
    dispatchTextEvents(control);
    return true;
  }

  if (isHTMLTextAreaInOwnerRealm(control)) {
    if (control.value === value) return false;
    control.focus();
    setNativeTextareaValue(control, value);
    dispatchTextEvents(control);
    return true;
  }

  if (control.isContentEditable) {
    const existing = control.textContent || "";
    if (existing === value) return false;
    control.focus();
    if (!replaceContentEditableText(control, value)) {
      control.textContent = value;
    }
    dispatchTextEvents(control);
    return true;
  }

  return false;
}

/** Set a text control's value without focus or event dispatch; the transaction revalidates before each event. */
export function setTextValueForTransaction(control: HTMLElement, value: string): boolean {
  if (isHTMLInputInOwnerRealm(control)) {
    if (control.value === value) return false;
    setNativeInputValue(control, value);
    return true;
  }
  if (isHTMLTextAreaInOwnerRealm(control)) {
    if (control.value === value) return false;
    setNativeTextareaValue(control, value);
    return true;
  }
  if (control.isContentEditable) {
    if ((control.textContent || "") === value) return false;
    if (!replaceContentEditableText(control, value)) control.textContent = value;
    return true;
  }
  return false;
}

/** Dispatch one text event at a time so each possible framework rerender is a transaction boundary. */
export function dispatchTextEventForTransaction(control: HTMLElement, eventType: "input" | "change" | "keyup" | "blur"): void {
  const view = control.ownerDocument.defaultView ?? window;
  if (eventType === "input" || eventType === "change") {
    control.dispatchEvent(new view.Event(eventType, { bubbles: true }));
  } else if (eventType === "keyup") {
    control.dispatchEvent(new view.KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
  } else {
    control.dispatchEvent(new view.FocusEvent("blur", { bubbles: true }));
  }
}

/** A single native click activation is one synchronous mutation boundary. */
export function clickControlForTransaction(control: HTMLElement): void {
  if (typeof control.click === "function") {
    control.click();
    return;
  }
  const view = control.ownerDocument.defaultView ?? window;
  control.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true }));
}

export function clickElement(target: HTMLElement) {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.PointerEvent("pointerover", { bubbles: true }));
  target.dispatchEvent(new view.PointerEvent("pointerenter", { bubbles: true }));
  target.dispatchEvent(new view.PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
  target.dispatchEvent(new view.MouseEvent("mouseover", { bubbles: true }));
  target.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true }));
  target.dispatchEvent(new view.MouseEvent("mouseup", { bubbles: true }));
  target.dispatchEvent(new view.PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
  if (typeof target.click === "function") {
    target.click();
  }
}

export function compareRectPosition(a: DOMRect, b: DOMRect): number {
  return (a.top - b.top) || (a.left - b.left);
}

export function dispatchChoiceEvents(target: HTMLInputElement) {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.MouseEvent("click", { bubbles: true }));
  target.dispatchEvent(new view.Event("input", { bubbles: true }));
  target.dispatchEvent(new view.Event("change", { bubbles: true }));
}

export function intersectionArea(rect: DOMRect, bbox: BoundingBox): number {
  const left = Math.max(rect.left, bbox.x);
  const top = Math.max(rect.top, bbox.y);
  const right = Math.min(rect.right, bbox.x + bbox.width);
  const bottom = Math.min(rect.bottom, bbox.y + bbox.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

export function isVisible(el: HTMLElement): boolean {
  // Frame-owned elements must be styled by their own window, never the top one.
  const style = (el.ownerDocument?.defaultView ?? window).getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

export function normalizeText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function isExtensionUiElement(el: Element): boolean {
  const id = (el as HTMLElement).id || "";
  if (id.startsWith("qs-")) return true;
  return !!el.closest?.("#qs-floating-host, #qs-highlight-layer, #qs-overlay-root, #qs-capture-toolbar");
}

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function rectIntersectsExpandedBBox(
  rect: DOMRect,
  bbox: BoundingBox,
  verticalPad: number,
  horizontalPad: number,
): boolean {
  return !(
    rect.right < bbox.x - horizontalPad
    || rect.left > bbox.x + bbox.width + horizontalPad
    || rect.bottom < bbox.y - verticalPad
    || rect.top > bbox.y + bbox.height + verticalPad
  );
}

export async function requestRealClick(target: HTMLElement): Promise<boolean> {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;

  // The debugger click path uses top-tab viewport coordinates. Frame-owned
  // controls must be transformed through their frame chain; ambiguous or
  // detached transforms refuse the click instead of guessing.
  const traversalRoot = getTraversalRoot(target);
  let clickX = rect.left + rect.width / 2;
  let clickY = rect.top + rect.height / 2;
  if (traversalRoot !== document) {
    const context = sharedRootRegistry().rootKeyOfRoot(traversalRoot);
    if (!context) return false;
    const transformed = topViewportPointForElement(sharedRootRegistry(), target, { x: clickX, y: clickY });
    if (!transformed) return false;
    clickX = transformed.x;
    clickY = transformed.y;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "REAL_CLICK",
      x: clickX,
      y: clickY,
    });
    await pause(80);
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

export function setNativeChecked(input: HTMLInputElement, checked: boolean) {
  const constructor = input.ownerDocument.defaultView?.HTMLInputElement ?? HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(constructor.prototype, "checked")?.set;
  if (setter) {
    setter.call(input, checked);
  } else {
    input.checked = checked;
  }
}

function dispatchTextEvents(target: HTMLElement) {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.Event("input", { bubbles: true }));
  target.dispatchEvent(new view.Event("change", { bubbles: true }));
  target.dispatchEvent(new view.KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
  target.dispatchEvent(new view.FocusEvent("blur", { bubbles: true }));
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const constructor = input.ownerDocument.defaultView?.HTMLInputElement ?? HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(constructor.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

function setNativeTextareaValue(input: HTMLTextAreaElement, value: string) {
  const constructor = input.ownerDocument.defaultView?.HTMLTextAreaElement ?? HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(constructor.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

function replaceContentEditableText(control: HTMLElement, value: string): boolean {
  const ownerDocument = control.ownerDocument;
  const selection = ownerDocument.defaultView?.getSelection();
  if (!selection) return false;

  try {
    selection.removeAllRanges();
    const range = ownerDocument.createRange();
    range.selectNodeContents(control);
    selection.addRange(range);

    if (typeof ownerDocument.execCommand === "function") {
      const ok = ownerDocument.execCommand("insertText", false, value);
      if (ok) return true;
    }
  } catch {
    return false;
  }

  return false;
}
