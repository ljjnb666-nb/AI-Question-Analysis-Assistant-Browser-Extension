import type { QuestionBlock, QuestionCompleteness } from "@/shared/types";
import { countOptionMarkersInText, normalizeText } from "./domText";

const VISUAL_RE = /(?:according to (?:the )?(?:figure|diagram|chart)|see (?:the )?(?:figure|diagram)|如图|看图|图中|下图|示意图)/i;
export function evaluateQuestionCompleteness(block: QuestionBlock): QuestionCompleteness {
  const text = normalizeText(block.previewText);
  const boundary = block.boundary;
  const choice = block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice";
  const options = countOptionMarkersInText(text);
  const stemComplete: boolean | "unknown" = /^[A-F][.):：、】【]/.test(text) ? false : text.length >= 8 ? true : "unknown";
  const optionsComplete: boolean | "unknown" = choice ? (options >= 4 ? true : boundary?.clippedBottom ? false : "unknown") : true;
  const visualComplete: boolean | "unknown" = VISUAL_RE.test(text) ? (block.hasImage || block.questionImageUrl || block.displaySegments?.some(s => s.type === "image") ? true : false) : true;
  const boundaryComplete: boolean | "unknown" = boundary ? boundary.state === "complete" : "unknown";
  const reasons: string[] = [];
  if (boundary?.clippedTop) reasons.push("Q_BOUNDARY_PARTIAL_TOP");
  if (boundary?.clippedBottom) reasons.push("Q_BOUNDARY_PARTIAL_BOTTOM");
  if (stemComplete === false) reasons.push("Q_INCOMPLETE_STEM");
  if (optionsComplete === false) reasons.push("Q_INCOMPLETE_OPTIONS");
  if (visualComplete === false) reasons.push("Q_INCOMPLETE_VISUAL");
  const incomplete = stemComplete === false || optionsComplete === false || visualComplete === false || (boundaryComplete === false && (stemComplete !== true || optionsComplete !== true));
  return { state: incomplete ? "incomplete" : stemComplete === "unknown" || optionsComplete === "unknown" ? "unknown" : "complete", boundaryComplete, stemComplete, optionsComplete, visualComplete, controlsComplete: choice ? (options > 0 ? true : "unknown") : true, confidence: incomplete ? .94 : .85, reasons };
}
