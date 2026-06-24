import type { BoundingBox } from "@/shared/types";

type ScopeDeps = {
  collectTextFromContainer: (container: Element, bbox: BoundingBox) => string;
  collectTextFromRegion: (bbox: BoundingBox) => string;
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  findNearbySemanticFormulaTextForImage: (img: Element) => string;
  intersectionArea: (rect: DOMRect, bbox: BoundingBox) => number;
  isDecorativeQuestionImage: (img: Element) => boolean;
  isElementVisible: (el: HTMLElement) => boolean;
  isExtensionUiElement: (el: Element) => boolean;
  normalizeQuestionText: (text: string) => string;
  scoreQuestionLikeText: (text: string, node: Element, depth: number) => number;
};

export function pickAnchorElement(
  bbox: BoundingBox,
  isExtensionUiElement: (el: Element) => boolean,
): Element | null {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const els = document.elementsFromPoint(cx, cy);
  for (const el of els) {
    if (!isExtensionUiElement(el)) return el;
  }
  return null;
}

export function findBestQuestionContainer(
  anchor: Element,
  bbox: BoundingBox,
  deps: Pick<ScopeDeps, "extractRichQuestionPreviewFromElement" | "intersectionArea" | "isExtensionUiElement">,
): Element | null {
  let node: Element | null = anchor;
  let best: Element | null = null;
  let bestScore = -Infinity;
  const bboxArea = Math.max(1, bbox.width * bbox.height);

  for (let depth = 0; depth < 12 && node; depth++) {
    if (deps.isExtensionUiElement(node)) {
      node = node.parentElement;
      continue;
    }
    const rect = node.getBoundingClientRect();
    const interArea = deps.intersectionArea(rect, bbox);
    if (interArea <= 0) {
      node = node.parentElement;
      continue;
    }

    const nodeArea = Math.max(1, rect.width * rect.height);
    const areaRatio = nodeArea / bboxArea;
    const overlapRatio = interArea / Math.min(nodeArea, bboxArea);
    const text = deps.extractRichQuestionPreviewFromElement(node);
    const optionLikeCount = (
      text.match(/(?:^|\n)\s*(?:[A-D][\.\):\uFF1A\u3001]?|[\u2460\u2461\u2462\u2463])\s*/g) || []
    ).length;
    const hasQuestion = /[?\uFF1F]/.test(text);

    let score = 0;
    score += overlapRatio * 100;
    score += optionLikeCount * 20;
    if (hasQuestion) score += 20;
    if (areaRatio < 0.5) score -= 30;
    if (areaRatio > 8) score -= 60;
    if (node.tagName === "BODY" || node.tagName === "HTML") score -= 200;
    score -= depth * 4;

    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
    node = node.parentElement;
  }

  return best;
}

export function extractTextFromAnchoredContainer(
  bbox: BoundingBox,
  deps: Pick<ScopeDeps, "collectTextFromContainer" | "normalizeQuestionText"> & {
    findBestQuestionContainer: (anchor: Element, bbox: BoundingBox) => Element | null;
    pickAnchorElement: (bbox: BoundingBox) => Element | null;
  },
): string {
  const anchor = deps.pickAnchorElement(bbox);
  if (!anchor) return "";
  const container = deps.findBestQuestionContainer(anchor, bbox);
  if (!container) return "";

  const text = deps.collectTextFromContainer(container, bbox);
  if (text.trim().length > 0) return text;

  return deps.normalizeQuestionText((container as HTMLElement).innerText || container.textContent || "");
}

export function extractTextFromBBox(
  bbox: BoundingBox,
  deps: Pick<ScopeDeps, "collectTextFromRegion" | "extractRichQuestionPreviewFromElement" | "isExtensionUiElement" | "scoreQuestionLikeText"> & {
    extractTextFromAnchoredContainer: (bbox: BoundingBox) => string;
  },
): string {
  const anchored = deps.extractTextFromAnchoredContainer(bbox);
  if (anchored.trim().length > 0) return anchored.slice(0, 1200);

  const regionText = deps.collectTextFromRegion(bbox);
  if (regionText.trim().length > 0) return regionText.slice(0, 1200);

  const samplePoints: Array<{ x: number; y: number }> = [
    { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
    { x: bbox.x + 8, y: bbox.y + 8 },
    { x: bbox.x + bbox.width - 8, y: bbox.y + 8 },
    { x: bbox.x + 8, y: bbox.y + bbox.height - 8 },
    { x: bbox.x + bbox.width - 8, y: bbox.y + bbox.height - 8 },
  ];

  const seedElements: Element[] = [];
  for (const p of samplePoints) {
    const el = document.elementFromPoint(p.x, p.y);
    if (!el || deps.isExtensionUiElement(el)) continue;
    if (!seedElements.includes(el)) seedElements.push(el);
  }
  if (seedElements.length === 0) return "";

  let bestText = "";
  let bestScore = -Infinity;

  for (const seed of seedElements) {
    let node: Element | null = seed;
    for (let depth = 0; depth < 9 && node; depth++) {
      if (deps.isExtensionUiElement(node)) {
        node = node.parentElement;
        continue;
      }
      const text = deps.extractRichQuestionPreviewFromElement(node);
      const score = deps.scoreQuestionLikeText(text, node, depth);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
      node = node.parentElement;
    }
  }

  return bestText.slice(0, 1200);
}

export function extractQuestionImageUrlFromBBox(
  bbox: BoundingBox,
  deps: Pick<ScopeDeps, "findNearbySemanticFormulaTextForImage" | "intersectionArea" | "isDecorativeQuestionImage" | "isElementVisible"> & {
    findBestQuestionContainer: (anchor: Element, bbox: BoundingBox) => Element | null;
    pickAnchorElement: (bbox: BoundingBox) => Element | null;
  },
): string | null {
  const anchor = deps.pickAnchorElement(bbox);
  const scope = anchor ? (deps.findBestQuestionContainer(anchor, bbox) ?? document.body) : document.body;
  const images = Array.from(scope.querySelectorAll("img")) as HTMLImageElement[];
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const img of images) {
    if (!deps.isElementVisible(img)) continue;
    if (deps.isDecorativeQuestionImage(img)) continue;
    if (deps.findNearbySemanticFormulaTextForImage(img)) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) continue;
    const inter = deps.intersectionArea(rect, bbox);
    if (inter <= 0) continue;
    const score = inter + rect.width * rect.height * 0.05;
    if (score > bestScore) {
      const url = (img.currentSrc || img.src || "").trim();
      if (url) {
        bestScore = score;
        bestUrl = url;
      }
    }
  }
  return bestUrl;
}
