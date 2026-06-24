import type { BoundingBox, QuestionBlock } from "@/shared/types";

type AnswerState = {
  mode: "choice" | "text" | "none";
  answeredCount: number;
  totalCount: number;
  complete: boolean;
};

type AutoSolveDomStateDeps = {
  findBestQuestionContainer: (anchor: Element, bbox: BoundingBox) => Element | null;
  isDecorativeQuestionImage: (img: Element) => boolean;
  isElementVisible: (el: HTMLElement) => boolean;
  isExtensionUiElement: (el: Element) => boolean;
  normalizeQuestionText: (text: string) => string;
  pickAnchorElement: (bbox: BoundingBox) => Element | null;
};

export function detectTotalQuestionCount(deps: Pick<AutoSolveDomStateDeps, "isElementVisible" | "isExtensionUiElement" | "normalizeQuestionText">): number {
  const containers = Array.from(document.querySelectorAll("div,section,aside,article"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => !deps.isExtensionUiElement(el))
    .filter((el) => /答题卡/.test(deps.normalizeQuestionText(el.innerText || el.textContent || "")));

  for (const container of containers) {
    const nums = Array.from(container.querySelectorAll("button,span,div,a,li"))
      .map((el) => deps.normalizeQuestionText((el as HTMLElement).innerText || el.textContent || ""))
      .filter((text) => /^\d{1,3}$/.test(text))
      .map((text) => Number(text))
      .filter((num) => num > 0 && num <= 300);
    if (nums.length) return Math.max(...nums);
  }

  return 0;
}

export function inspectAutoSolveAnswerState(
  block: QuestionBlock,
  deps: Pick<AutoSolveDomStateDeps, "findBestQuestionContainer" | "pickAnchorElement" | "normalizeQuestionText">,
): AnswerState {
  const scope = resolveAutoSolveAnswerScope(block, deps);
  const textControls = Array.from(scope.querySelectorAll("input:not([type='radio']):not([type='checkbox']):not([type='hidden']):not([type='button']):not([type='submit']), textarea, [contenteditable='true']"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => rectIntersectsExpandedBBox(el.getBoundingClientRect(), block.bbox, 40, 320));
  if (textControls.length > 0) {
    const answeredCount = textControls.filter((el) => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return Boolean(String(el.value || "").trim());
      if (el.isContentEditable) return Boolean(String(el.textContent || "").trim());
      return false;
    }).length;
    return {
      mode: "text",
      answeredCount,
      totalCount: textControls.length,
      complete: answeredCount > 0 && answeredCount === textControls.length,
    };
  }

  const choiceInputs = Array.from(scope.querySelectorAll("input[type='radio'], input[type='checkbox']"))
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
    .filter((el) => rectIntersectsExpandedBBox(el.getBoundingClientRect(), block.bbox, 28, 260));
  if (choiceInputs.length > 0) {
    const answeredCount = choiceInputs.filter((el) => el.checked).length;
    return {
      mode: "choice",
      answeredCount,
      totalCount: choiceInputs.length,
      complete: answeredCount > 0,
    };
  }

  const optionRows = Array.from(scope.querySelectorAll("div,li,label,span,p"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => rectIntersectsExpandedBBox(el.getBoundingClientRect(), block.bbox, 28, 260))
    .filter((el) => {
      const normalized = deps.normalizeQuestionText(el.innerText || el.textContent || "");
      return /^[A-F][\.\):：、]/.test(normalized) || /^(?:对|错|正确|错误)$/.test(normalized);
    });
  if (optionRows.length > 0) {
    const selectedRows = optionRows.filter((el) => {
      const cls = String(el.className || "");
      const ariaChecked = el.getAttribute("aria-checked");
      return /is-choose|selected|checked|active/.test(cls) || ariaChecked === "true";
    });
    return {
      mode: "choice",
      answeredCount: selectedRows.length,
      totalCount: optionRows.length,
      complete: selectedRows.length > 0,
    };
  }

  return { mode: "none", answeredCount: 0, totalCount: 0, complete: false };
}

export function extractSelectedChoiceAnswer(
  block: QuestionBlock,
  deps: Pick<AutoSolveDomStateDeps, "findBestQuestionContainer" | "pickAnchorElement" | "normalizeQuestionText">,
): string {
  const scope = resolveAutoSolveAnswerScope(block, deps);
  const selectedRows = Array.from(scope.querySelectorAll("div,li,label,span,p"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => rectIntersectsExpandedBBox(el.getBoundingClientRect(), block.bbox, 28, 260))
    .filter((el) => {
      const cls = String(el.className || "");
      const ariaChecked = el.getAttribute("aria-checked");
      return /is-choose|selected|checked|active/.test(cls) || ariaChecked === "true";
    })
    .map((el) => deps.normalizeQuestionText(el.innerText || el.textContent || ""))
    .map((text) => {
      const judgeMatch = text.match(/^(对|错|正确|错误)/);
      if (judgeMatch?.[1]) return judgeMatch[1];
      const choiceMatch = text.match(/^([A-F])[\.\):：、]/i);
      return choiceMatch?.[1]?.toUpperCase() || "";
    })
    .filter(Boolean);

  if (selectedRows.length) {
    const unique = Array.from(new Set(selectedRows));
    return unique.join(",");
  }

  const checkedInputs = Array.from(scope.querySelectorAll("input[type='radio'], input[type='checkbox']"))
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
    .filter((el) => rectIntersectsExpandedBBox(el.getBoundingClientRect(), block.bbox, 28, 260))
    .filter((el) => el.checked)
    .map((el) => {
      const text = deps.normalizeQuestionText(el.closest("label,.option-item,li,div")?.textContent || "");
      const choiceMatch = text.match(/^([A-F])[\.\):：、]/i);
      return choiceMatch?.[1]?.toUpperCase() || "";
    })
    .filter(Boolean);

  return Array.from(new Set(checkedInputs)).join(",");
}

export function hasVisibleAutoSolveMedia(
  scope: Element,
  deps: Pick<AutoSolveDomStateDeps, "isDecorativeQuestionImage" | "isElementVisible">,
): boolean {
  const mediaNodes = Array.from(scope.querySelectorAll("img, canvas, svg, math, figure, mjx-container, .MathJax, .katex, embed"));
  return mediaNodes.some((node) => {
    if (!(node instanceof HTMLElement) || !deps.isElementVisible(node)) return false;
    if (node.tagName.toLowerCase() === "img" && deps.isDecorativeQuestionImage(node)) return false;
    if (/^(svg|math|mjx-container|embed)$/i.test(node.tagName) || node.matches(".MathJax, .katex")) {
      return isStandaloneVisualMathNode(node);
    }
    return true;
  });
}

function resolveAutoSolveAnswerScope(
  block: QuestionBlock,
  deps: Pick<AutoSolveDomStateDeps, "findBestQuestionContainer" | "pickAnchorElement">,
): Element {
  const anchor = deps.pickAnchorElement(block.bbox);
  if (!anchor) return document.body;
  return deps.findBestQuestionContainer(anchor, block.bbox) ?? document.body;
}

function rectIntersectsExpandedBBox(rect: DOMRect, bbox: BoundingBox, verticalPad: number, horizontalPad: number): boolean {
  return !(
    rect.right < bbox.x - horizontalPad
    || rect.left > bbox.x + bbox.width + horizontalPad
    || rect.bottom < bbox.y - verticalPad
    || rect.top > bbox.y + bbox.height + verticalPad
  );
}

function isStandaloneVisualMathNode(node: Element): boolean {
  const rect = (node as HTMLElement).getBoundingClientRect?.();
  if (!rect) return false;
  if (node.closest("figure")) return true;
  return rect.width >= 180 || rect.height >= 72;
}
