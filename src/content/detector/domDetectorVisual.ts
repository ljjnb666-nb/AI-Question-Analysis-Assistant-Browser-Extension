import { findNearbySemanticFormulaTextForImage } from "../formulaEmbedFallback";

export function hasMeaningfulVisualContent(el: Element): boolean {
  if (Array.from(el.querySelectorAll("canvas, figure")).length > 0) return true;
  if (Array.from(el.querySelectorAll("svg, math, mjx-container, .MathJax, .katex, embed")).some((node) => isStandaloneVisualMathNode(node))) {
    return true;
  }
  return Array.from(el.querySelectorAll("img")).some((img) => !isDecorativeQuestionImage(img));
}

export function isDecorativeQuestionImage(img: Element): boolean {
  const classText = String((img as HTMLElement).className || "");
  const src = String((img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src || "").trim();

  if (img.closest(".option-item") && /icon-lou|aloha-icon|iconfont/i.test(classText)) return true;
  if (/icon-lou|aloha-icon|iconfont|radio|checkbox|select/i.test(classText)) return true;
  if (/689dc301e4b07b838da42b38\.png/i.test(src)) return true;

  const rect = (img as HTMLElement).getBoundingClientRect?.();
  if (rect && rect.width <= 28 && rect.height <= 28) return true;

  return false;
}

export function pickQuestionImageFromElement(el: Element): string | null {
  const imgs = Array.from(el.querySelectorAll("img")) as HTMLImageElement[];
  let best: { score: number; url: string } | null = null;
  for (const img of imgs) {
    const src = String(img.currentSrc || img.src || "").trim();
    if (!src || /^data:/i.test(src)) continue;
    if (isDecorativeQuestionImage(img)) continue;
    if (findNearbySemanticFormulaTextForImage(img)) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) continue;
    const area = rect.width * rect.height;
    const score = area;
    if (!best || score > best.score) best = { score, url: src };
  }
  return best?.url ?? null;
}

function isStandaloneVisualMathNode(node: Element): boolean {
  const rect = (node as HTMLElement).getBoundingClientRect?.();
  if (!rect) return false;
  if (node.closest("figure")) return true;
  return rect.width >= 180 || rect.height >= 72;
}
