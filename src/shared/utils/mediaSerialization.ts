import type { QuestionBlock, QuestionDisplaySegment } from "@/shared/types";
import { sanitizeMediaUrlForSerialization } from "./mediaUrlPrivacy";

function sanitizeQuestionBlock(block: QuestionBlock, keepRuntimeHandle: boolean): QuestionBlock {
  const serialized = {
    ...block,
    runtimeQuestionHandle: keepRuntimeHandle ? block.runtimeQuestionHandle : undefined,
    runtimeOwnerKey: undefined,
    questionImageUrl: sanitizeMediaUrlForSerialization(block.questionImageUrl),
    displaySegments: block.displaySegments?.map((segment): QuestionDisplaySegment | null => {
      if (segment.type !== "image") return segment;
      const url = sanitizeMediaUrlForSerialization(segment.url) ?? (segment.mediaAssetId ? `media://${segment.mediaAssetId}` : undefined);
      return url ? { ...segment, url } : null;
    }).filter((segment): segment is QuestionDisplaySegment => segment !== null),
    imageDataUrl: undefined,
  };
  for (const symbol of Object.getOwnPropertySymbols(serialized)) Reflect.deleteProperty(serialized, symbol);
  return serialized;
}

/** Safe for history, storage, progress, analytics, and other persistent boundaries. */
export function sanitizeQuestionBlockForSerialization(block: QuestionBlock): QuestionBlock {
  return sanitizeQuestionBlock(block, false);
}

/** Safe for the short-lived content-to-extension candidate message round trip. */
export function sanitizeQuestionBlockForRuntimeMessage(block: QuestionBlock): QuestionBlock {
  return sanitizeQuestionBlock(block, true);
}
