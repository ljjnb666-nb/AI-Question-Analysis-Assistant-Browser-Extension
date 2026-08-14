import type { QuestionOwnershipDecision } from "@/shared/types";
import type { QuestionFragment } from "./questionFragment";

export type OwnershipGeometryContext = { verticalGap: number; horizontalOverlapRatio: number };

const different = (reason: QuestionOwnershipDecision["reasons"][number], confidence = .99): QuestionOwnershipDecision => ({ relation: "different-question", confidence, reasons: [reason] });
const same = (reason: QuestionOwnershipDecision["reasons"][number], confidence = .9): QuestionOwnershipDecision => ({ relation: "same-question", confidence, reasons: [reason] });

export function resolveQuestionOwnership(previous: QuestionFragment, next: QuestionFragment, geometry?: OwnershipGeometryContext): QuestionOwnershipDecision {
  if (previous.nativeQuestionId && next.nativeQuestionId && previous.nativeQuestionId !== next.nativeQuestionId) return different("different-native-id");
  if (previous.ordinalHint && next.ordinalHint && previous.ordinalHint !== next.ordinalHint) return different("different-ordinal");
  const nextStem = next.hasStrongStemSignal && !isOptionContinuation(next);
  if (previous.hasCompleteOptionSetSignal && nextStem) return different("complete-options-before-new-stem", .98);
  if (previous.viewportState === "clipped-top" && previous.hasOptionSignal && nextStem) return different("partial-top", .97);
  if (previous.ownerKey && next.ownerKey && previous.ownerKey !== next.ownerKey) return different("different-owner-container", .96);
  const complementary = previous.hasOptionSignal !== next.hasOptionSignal || (previous.hasQuestionStartSignal && next.hasOptionSignal);
  const nearby = geometry && geometry.verticalGap <= 140 && geometry.horizontalOverlapRatio >= .45;
  if (previous.nativeQuestionId && previous.nativeQuestionId === next.nativeQuestionId && complementary) return same("same-native-id", nearby ? .99 : .9);
  if (previous.ordinalHint && previous.ordinalHint === next.ordinalHint && complementary) return same("same-ordinal", nearby ? .96 : .86);
  if (previous.ownerKey && previous.ownerKey === next.ownerKey && complementary) return same("same-owner-container", nearby ? .95 : .84);
  return { relation: "unknown", confidence: .25, reasons: ["conflicting-evidence"] };
}

function isOptionContinuation(fragment: QuestionFragment): boolean {
  return fragment.hasOptionSignal && !fragment.hasStrongStemSignal && fragment.optionKeys.length > 0;
}
