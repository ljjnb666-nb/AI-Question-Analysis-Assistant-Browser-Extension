import type { BoundingBox, QuestionBlock, QuestionType } from "@/shared/types";
import { countOptionMarkersInText, normalizeText } from "./domText";
import { classifyViewportBoundary, type ViewportState } from "./questionBoundary";

export interface QuestionFragment {
  runtimeId: string;
  text: string;
  bbox: BoundingBox;
  questionType: QuestionType;
  ordinalHint?: number;
  nativeQuestionId?: string;
  optionKeys: string[];
  hasQuestionStartSignal: boolean;
  hasStrongStemSignal: boolean;
  hasOptionSignal: boolean;
  hasCompleteOptionSetSignal: boolean;
  viewportState: ViewportState;
  ownerKey?: string;
}

const STEM_RE = /(?:which|what|please choose|calculate|given|determine|judge|select|下列|请选择|判断|计算|已知|根据|设)/i;
export function questionFragmentFromBlock(block: QuestionBlock): QuestionFragment {
  const text = normalizeText(block.previewText);
  const optionKeys = Array.from(text.matchAll(/(?:^|\s)([A-F])(?:[.):：、】【])/g)).map(match => match[1]);
  const boundary = classifyViewportBoundary(block.bbox);
  return {
    runtimeId: block.id, text, bbox: block.bbox, questionType: block.questionTypeGuess,
    ordinalHint: block.identity?.ordinalHint,
    nativeQuestionId: block.identity?.nativeQuestionId,
    optionKeys, hasQuestionStartSignal: Boolean(block.identity?.ordinalHint) || STEM_RE.test(text),
    hasStrongStemSignal: STEM_RE.test(text) || /[?？]/.test(text),
    hasOptionSignal: countOptionMarkersInText(text) > 0,
    hasCompleteOptionSetSignal: new Set(optionKeys).size >= 4,
    viewportState: boundary.state, ownerKey: block.runtimeOwnerKey,
  };
}
