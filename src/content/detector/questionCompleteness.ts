import type { QuestionBlock, QuestionCompleteness } from "@/shared/types";
import { countOptionMarkersInText, normalizeText } from "./domText";

const STEM_VISUAL_RE = /(?:according to (?:the )?(?:figure|diagram|chart)|see (?:the )?(?:figure|diagram)|如图|看图|图中|下图|示意图)/i;
const OPTION_VISUAL_RE = /(?:which (?:image|picture|diagram|figure)|选择正确的(?:图|图片|图形)|下列图形中|观察图片)/i;
const USABLE_AVAILABILITY = new Set(["available", "url-only"]);
const UNCERTAIN_AVAILABILITY = new Set(["pending", "blocked", "tainted", "unresolved"]);
export function evaluateQuestionCompleteness(block: QuestionBlock): QuestionCompleteness {
  const text = normalizeText(block.previewText);
  const boundary = block.boundary;
  const choice = block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice";
  const options = countOptionMarkersInText(text);
  const stemComplete: boolean | "unknown" = /^[A-F][.):：、】【]/.test(text) ? false : text.length >= 8 ? true : "unknown";
  const optionsComplete: boolean | "unknown" = choice ? (options >= 4 ? true : boundary?.clippedBottom ? false : "unknown") : true;
  const visualComplete = evaluateVisualCompleteness(text, block);
  const boundaryComplete: boolean | "unknown" = boundary ? boundary.state === "complete" : "unknown";
  const reasons: string[] = [];
  if (boundary?.clippedTop) reasons.push("Q_BOUNDARY_PARTIAL_TOP");
  if (boundary?.clippedBottom) reasons.push("Q_BOUNDARY_PARTIAL_BOTTOM");
  if (stemComplete === false) reasons.push("Q_INCOMPLETE_STEM");
  if (optionsComplete === false) reasons.push("Q_INCOMPLETE_OPTIONS");
  if (visualComplete === false) reasons.push("Q_INCOMPLETE_VISUAL");
  const incomplete = stemComplete === false || optionsComplete === false || visualComplete === false || (boundaryComplete === false && (stemComplete !== true || optionsComplete !== true));
  const unknown = stemComplete === "unknown" || optionsComplete === "unknown" || visualComplete === "unknown";
  return { state: incomplete ? "incomplete" : unknown ? "unknown" : "complete", boundaryComplete, stemComplete, optionsComplete, visualComplete, controlsComplete: choice ? (options > 0 ? true : "unknown") : true, confidence: incomplete ? .94 : .85, reasons };
}

function evaluateVisualCompleteness(text: string, block: QuestionBlock): boolean | "unknown" {
  const assets = block.mediaAssets ?? [];
  if (OPTION_VISUAL_RE.test(text)) {
    const options = new Map(assets.filter((asset) => asset.ownership.role === "option" && asset.ownership.optionKey).map((asset) => [asset.ownership.optionKey!, asset]));
    const required = ["A", "B", "C", "D"];
    if (required.some((key) => !options.has(key))) return false;
    if (required.some((key) => UNCERTAIN_AVAILABILITY.has(options.get(key)!.availability))) return "unknown";
    return required.every((key) => USABLE_AVAILABILITY.has(options.get(key)!.availability));
  }
  if (!STEM_VISUAL_RE.test(text)) return true;
  if (assets.length === 0) return Boolean(block.hasImage || block.questionImageUrl || block.displaySegments?.some((segment) => segment.type === "image"));
  const stemAssets = assets.filter((asset) => asset.ownership.role === "stem");
  if (stemAssets.some((asset) => USABLE_AVAILABILITY.has(asset.availability))) return true;
  if (stemAssets.some((asset) => UNCERTAIN_AVAILABILITY.has(asset.availability))) return "unknown";
  return false;
}
