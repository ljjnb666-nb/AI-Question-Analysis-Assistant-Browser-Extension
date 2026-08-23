import type { MediaOwnership } from "@/shared/types";
import { findNearbySemanticFormulaTextForImage } from "../formulaEmbedFallback";
import { isDecorativeQuestionImage } from "../detector/domDetectorVisual";

const QUESTION_SELECTOR = ".questionBox,.question-item,.base-question-component,.q-detail,.problem-item,.exam-item,.test-item";
const OPTION_SELECTOR = ".option-item,[class*='option'],li,label";

export function isFormulaMediaRepresentation(element: Element): boolean {
  return Boolean(
    element.closest("math,mjx-container,.MathJax,.katex,[data-svg-latex],[data-latex]")
    || (element.tagName.toLowerCase() === "img" && findNearbySemanticFormulaTextForImage(element)),
  );
}

export function isMediaDecoration(element: Element): boolean {
  if (element.tagName.toLowerCase() === "img" && isDecorativeQuestionImage(element)) return true;
  const label = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("alt") ?? ""} ${element.className ?? ""}`;
  if (/(?:logo|avatar|icon|checkbox|radio|navigation|advert)/i.test(label)) return true;
  const rect = (element as HTMLElement).getBoundingClientRect?.();
  const tag = element.tagName.toLowerCase();
  return tag === "svg" && Boolean(rect && rect.width > 0 && rect.height > 0 && rect.width <= 20 && rect.height <= 20 && !element.getAttribute("aria-label") && !element.getAttribute("title"));
}

export function resolveSemanticQuestionOwner(element: Element): Element | null {
  return element.matches(QUESTION_SELECTOR) ? element : element.closest(QUESTION_SELECTOR);
}

export function isInsideDifferentQuestionOwner(element: Element, owner: Element): boolean {
  const current = resolveSemanticQuestionOwner(owner);
  const nearest = resolveSemanticQuestionOwner(element);
  // A broad wrapper has no semantic question identity. Nested cards must never inherit it.
  if (!current) return Boolean(nearest);
  return Boolean(nearest && nearest !== current);
}

export function resolveMediaOwnership(element: Element, owner: Element): MediaOwnership {
  if (isInsideDifferentQuestionOwner(element, owner)) {
    return { role: "unknown", confidence: 0, reasons: ["CROSS_QUESTION_OWNER"] };
  }
  if (isFormulaMediaRepresentation(element)) {
    return { role: "decoration", confidence: 1, reasons: ["FORMULA_REPRESENTATION"] };
  }
  if (isMediaDecoration(element)) {
    return { role: "decoration", confidence: 1, reasons: ["DECORATIVE"] };
  }
  const option = element.closest(OPTION_SELECTOR);
  const optionText = String((option as HTMLElement | null)?.innerText || option?.textContent || "").trim();
  const optionKey = optionText.match(/^\s*([A-F])(?:[.):：、】【\s]|$)/i)?.[1]?.toUpperCase();
  if (option && optionKey) {
    return { role: "option", optionKey, confidence: .98, reasons: ["OPTION_ANCESTRY", "SAME_QUESTION_OWNER"] };
  }
  const stem = element.closest(".questionContent,.qeustion-content,.question-content,.stem,.question-body,.content,figure");
  if (stem) return { role: "stem", confidence: .94, reasons: ["STEM_ANCESTRY", "SAME_QUESTION_OWNER"] };
  if (owner.contains(element)) return { role: "stem", confidence: .72, reasons: ["SAME_QUESTION_OWNER", "GEOMETRY_SUPPORT"] };
  return { role: "unknown", confidence: 0, reasons: ["AMBIGUOUS_OWNER"] };
}
