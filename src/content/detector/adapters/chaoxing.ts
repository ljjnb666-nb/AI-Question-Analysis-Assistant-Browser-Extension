import { isHtmlElementNode } from "../domDetectorShared";
import type { QuestionBlock, QuestionType } from "@/shared/types";
import { inferQuestionType, normalizeText, sanitizePreviewTextByType } from "../domText";
import { extractReadableNodeText, extractStructuredQuestionText } from "../domStructuredText";
import { isLikelyCompleteQuestionText } from "../domDetectorPostprocess";
import { bindDomQuestionBlockToOwner as attachDetectedQuestionIdentity } from "../../domQuestionBinding";
import { hasMeaningfulVisualContent, isDecorativeQuestionImage, pickQuestionImageFromElement } from "../domDetectorVisual";
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

/** True when the stem (excluding the answer editor) contains media elements.
 * The UEditor answer area is input surface: toolbar sprites/icons there are UI
 * chrome, not question figures. The media pipeline scans the full owner, so a
 * text-only question gets hasImage=true from editor chrome, and parsing then
 * hard-fails trying to fetch a "question image" that doesn't exist. */
function stemHasMedia(el: HTMLElement): boolean {
  const editor = el.querySelector(".stem_answer");
  for (const node of el.querySelectorAll("img,canvas,figure,picture")) {
    if (editor && editor.contains(node)) continue;
    if (node.tagName.toLowerCase() === "img" && isDecorativeQuestionImage(node)) continue;
    return true;
  }
  // Inline SVGs outside the editor (e.g. stem diagrams).
  for (const node of el.querySelectorAll("svg")) {
    if (editor && editor.contains(node)) continue;
    return true;
  }
  return false;
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
    // Chaoxing separates stem from the answer area, so the stem rect is exact.
    // 80px kills short judge/fill questions (1-2 lines ≈ 40-60px); 40px is enough
    // to filter slivers while keeping real questions.
    if (rect.width < 200 || rect.height < 40) continue;
    if (getVisibleVerticalRatio(stemRect, vh) < 0.15) continue;

    const text = extractChaoxingStemText(el);
    if (!text || text.length < 10) continue;

    const typename = el.getAttribute("typename") || "";
    const questionType = chaoxingTypeFromTypename(typename, text);
    const previewText = sanitizePreviewTextByType(text, questionType);
    // Chaoxing's typename is authoritative. For choice questions, count real
    // radio/checkbox inputs — options may render without "A./B./C./D." text
    // markers (styled via CSS), which the generic text heuristic would miss.
    const isChoice = questionType === "single_choice" || questionType === "multi_choice";
    const inputOptionCount = isChoice
      ? el.querySelectorAll("input[type='radio'], input[type='checkbox']").length
      : 0;
    if (isChoice && inputOptionCount >= 2) {
      // typename + real inputs: complete by construction, skip text heuristic.
    } else if (!isLikelyCompleteQuestionText(previewText, questionType)) continue;

    // Identity must round-trip through observeLiveQuestion(): the exact
    // structured projection is what the authority check re-derives, so
    // identifyObservationSource() proves "structured" and later re-observation
    // yields the identical fingerprint. Without this the parse/fill authority
    // check fails and the UI reports "页面已变化". The noise-stripped stem
    // text stays preview/AI-only.
    const structuredText = extractStructuredQuestionText(el);
    const identityText = structuredText && structuredText.length >= 10 ? structuredText : text;

    const qid = el.getAttribute("data") || el.id || `chaoxing-${index}`;
    // Stable block id: the sidepanel merges re-detections by block.id, so a
    // Date.now() id orphans parse results whenever the page re-detects
    // (scroll/interaction). The qid is stable per question on this page.
    const blockId = `auto-chaoxing-${qid}`;
    // Deliberately unclamped stem box: full-page accumulation converts each
    // scroll step to absolute coords, so every observation yields the same box
    // and merges into one complete box. Per-viewport clamping produced partial
    // slices that never merged (each step kept a different slice).
    const bound = attachDetectedQuestionIdentity({
      id: blockId,
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
    }, el, { identityText });
    // The binding collects media from the full owner, including UEditor
    // toolbar chrome inside .stem_answer. When the stem itself has no media,
    // those assets are false positives that make parsing hard-fail fetching a
    // non-existent "question image" — drop them so text questions parse as text.
    out.push(stemHasMedia(el) ? bound : {
      ...bound,
      hasImage: false,
      questionImageUrl: undefined,
      mediaAssets: [],
      primaryMediaAssetId: undefined,
    });
  }

  return out;
}

export const chaoxingAdapter: SiteAdapter = {
  id: "chaoxing",
  matches: isChaoxingHost,
  buildCandidates: ({ hostRightCutX, vw, vh }) =>
    buildChaoxingCandidates(hostRightCutX, vw, vh),
};
