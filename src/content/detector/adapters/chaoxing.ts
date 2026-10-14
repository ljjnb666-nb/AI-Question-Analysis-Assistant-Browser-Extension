import { isHtmlElementNode } from "../domDetectorShared";
import type { QuestionBlock, QuestionType } from "@/shared/types";
import { inferQuestionType, normalizeText, sanitizePreviewTextByType } from "../domText";
import { extractReadableNodeText, extractStructuredQuestionText } from "../domStructuredText";
import { isLikelyCompleteQuestionText } from "../domDetectorPostprocess";
import { bindDomQuestionBlockToOwner as attachDetectedQuestionIdentity } from "../../domQuestionBinding";
import { hasMeaningfulVisualContent, pickQuestionImageFromElement } from "../domDetectorVisual";
import {
  applyRightCutToRect,
  boundaryFromRawRect,
  getVisibleVerticalRatio,
  inViewport,
} from "../domCandidateGeometry";
import type { SiteAdapter } from "./types";

/* Chaoxing (超星学习通) adapter.
 *
 * Question pages (dowork/workexam) wrap each question in `.questionLi`
 * carrying a `typename` attribute ("单选题", "多选题", "判断题", "填空题",
 * "简答题", "其它", …) and a `data` question id. The stem lives in
 * `h3.mark_name` + rich-text paragraphs; subjective questions answer through
 * a UEditor rich-text editor inside `.stem_answer` (whose hidden textarea
 * must not be mistaken for a fill-in-the-blank control — see
 * countBlankControls).
 */

function isChaoxingHost(): boolean {
  return (window.location.hostname || "").toLowerCase().includes("chaoxing.com");
}

const TYPENAME_TO_TYPE: Array<[RegExp, QuestionType]> = [
  [/单选/, "single_choice"],
  [/多选/, "multi_choice"],
  [/判断/, "judge"],
  [/填空/, "fill_blank"],
  [/其它|简答|名词解释|论述|计算|证明|作答/, "short_answer"],
];

export function chaoxingTypeFromTypename(typename: string, fallbackText: string): QuestionType {
  for (const [re, type] of TYPENAME_TO_TYPE) {
    if (re.test(typename)) return type;
  }
  return inferQuestionType(fallbackText);
}

/** Stem text without the answer/editor area: UEditor toolbars ("加粗/斜体/…")
 * must not leak into the preview, and hidden editor fields carry no stem. */
function extractChaoxingStemText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(
    ".eidtDiv, [id^='edui'], .edui-editor, textarea, iframe, input[type='hidden']",
  ).forEach((node) => node.remove());
  return normalizeText(extractReadableNodeText(clone));
}

/** Stem-only rect: the UEditor answer area (.stem_answer) is input surface, not
 * question text — the highlight/parse box must not cover it. */
function stemRectExcludingAnswer(el: HTMLElement, rawRect: DOMRect): DOMRect {
  const answer = el.querySelector(".stem_answer");
  if (!answer || !isHtmlElementNode(answer)) return rawRect;
  const aRect = answer.getBoundingClientRect();
  if (Number.isFinite(aRect.top) && aRect.top > rawRect.top + 40 && aRect.top < rawRect.bottom) {
    return new DOMRect(rawRect.left, rawRect.top, rawRect.width, Math.max(1, aRect.top - rawRect.top));
  }
  return rawRect;
}

export function buildChaoxingCandidates(
  hostRightCutX: number | null,
  vw: number,
  vh: number,
): QuestionBlock[] {
  const out: QuestionBlock[] = [];
  const items = Array.from(document.querySelectorAll(".questionLi"))
    .filter((node): node is HTMLElement => isHtmlElementNode(node));

  for (const [index, el] of items.entries()) {
    const rawRect = el.getBoundingClientRect();
    const stemRect = stemRectExcludingAnswer(el, rawRect);
    const rect = applyRightCutToRect(stemRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 200 || rect.height < 80) continue;
    if (getVisibleVerticalRatio(stemRect, vh) < 0.15) continue;

    const text = extractChaoxingStemText(el);
    if (!text || text.length < 10) continue;

    const typename = el.getAttribute("typename") || "";
    const questionType = chaoxingTypeFromTypename(typename, text);
    const previewText = sanitizePreviewTextByType(text, questionType);
    if (!isLikelyCompleteQuestionText(previewText, questionType)) continue;

    // Identity must round-trip through observeLiveQuestion(): the exact
    // structured projection is what the authority check re-derives, so
    // identifyObservationSource() proves "structured" and later re-observation
    // yields the identical fingerprint. Without this the parse/fill authority
    // check fails and the UI reports "页面已变化". The noise-stripped stem
    // text stays preview/AI-only.
    const structuredText = extractStructuredQuestionText(el);
    const identityText = structuredText && structuredText.length >= 10 ? structuredText : text;

    const qid = el.getAttribute("data") || el.id || `chaoxing-${index}`;
    // Deliberately unclamped stem box: full-page accumulation converts each
    // scroll step to absolute coords, so every observation yields the same box
    // and merges into one complete box. Per-viewport clamping produced partial
    // slices that never merged (each step kept a different slice).
    out.push(attachDetectedQuestionIdentity({
      id: `auto-chaoxing-${Date.now()}-${index}`,
      bbox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      previewText: previewText.slice(0, 900),
      hasImage: hasMeaningfulVisualContent(el),
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
      questionTypeGuess: questionType,
      confidence: 0.9,
      source: "auto_dom",
      identitySourceText: text,
      runtimeOwnerKey: `chaoxing-${qid}`,
      boundary: boundaryFromRawRect(stemRect, vh),
    // Note: no explicit nativeQuestionId — observeLiveQuestion() re-derives
    // identity via extractNativeQuestionId(), so bind-time and observe-time
    // must use the same extraction or stableId mismatches ("页面已变化").
    }, el, { identityText }));
  }

  return out;
}

export const chaoxingAdapter: SiteAdapter = {
  id: "chaoxing",
  matches: isChaoxingHost,
  buildCandidates: ({ hostRightCutX, vw, vh }) =>
    buildChaoxingCandidates(hostRightCutX, vw, vh),
};
