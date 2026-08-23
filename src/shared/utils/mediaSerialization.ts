import type { QuestionBlock, QuestionDisplaySegment } from "@/shared/types";
import { sanitizeMediaUrlForSerialization } from "./mediaUrlPrivacy";

/** Safe for history, messages, and any other cross-runtime serialization boundary. */
export function sanitizeQuestionBlockForSerialization(block: QuestionBlock): QuestionBlock {
  return {
    ...block,
    questionImageUrl: sanitizeMediaUrlForSerialization(block.questionImageUrl),
    displaySegments: block.displaySegments?.map((segment): QuestionDisplaySegment | null => {
      if (segment.type !== "image") return segment;
      const url = sanitizeMediaUrlForSerialization(segment.url) ?? (segment.mediaAssetId ? `media://${segment.mediaAssetId}` : undefined);
      return url ? { ...segment, url } : null;
    }).filter((segment): segment is QuestionDisplaySegment => segment !== null),
    imageDataUrl: undefined,
  };
}
