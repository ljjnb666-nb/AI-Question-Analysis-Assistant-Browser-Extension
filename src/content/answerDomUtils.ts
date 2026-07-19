import type { BoundingBox } from "@/shared/types";

export function applyTextValue(control: HTMLElement, value: string): boolean {
  if (control instanceof HTMLInputElement) {
    if (control.value === value) return false;
    control.focus();
    setNativeInputValue(control, value);
    dispatchTextEvents(control);
    return true;
  }

  if (control instanceof HTMLTextAreaElement) {
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

export function clickElement(target: HTMLElement) {
  target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  target.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
  if (typeof target.click === "function") {
    target.click();
  }
}

export function compareRectPosition(a: DOMRect, b: DOMRect): number {
  return (a.top - b.top) || (a.left - b.left);
}

export function dispatchChoiceEvents(target: HTMLInputElement) {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
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
  const style = getComputedStyle(el);
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

  try {
    const response = await chrome.runtime.sendMessage({
      type: "REAL_CLICK",
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    await pause(80);
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

export function setNativeChecked(input: HTMLInputElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
  if (setter) {
    setter.call(input, checked);
  } else {
    input.checked = checked;
  }
}

function dispatchTextEvents(target: HTMLElement) {
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
  target.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

function setNativeTextareaValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

function replaceContentEditableText(control: HTMLElement, value: string): boolean {
  const selection = window.getSelection();
  if (!selection) return false;

  try {
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(control);
    selection.addRange(range);

    if (typeof document.execCommand === "function") {
      const ok = document.execCommand("insertText", false, value);
      if (ok) return true;
    }
  } catch {
    return false;
  }

  return false;
}
