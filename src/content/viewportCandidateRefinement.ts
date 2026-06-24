import type { BoundingBox, QuestionBlock, QuestionType } from "@/shared/types";
import {
  findBestVisibleCandidateByOrder,
  findMatchingCandidate,
  projectAbsoluteBboxToViewport,
} from "./candidateMatching";
import type { ScanScrollRoot } from "./detector/fullPageDetector";

type ResolvedQuestionScope = {
  refinedBBox: BoundingBox;
  finalBBox: BoundingBox;
  previewText: string;
  matchedCandidate: QuestionBlock | null;
};

type RefinementDeps = {
  detectCandidatesInViewport: () => QuestionBlock[];
  extractQuestionImageUrlFromBBox: (bbox: BoundingBox) => string | null;
  extractQuestionOrder: (text: string) => number | null;
  extractTextFromBBox: (bbox: BoundingBox) => string;
  inferQuestionType: (text: string) => QuestionType;
  pickBestPreviewText: (rawPreviewText: string, richPreviewText: string, typeGuess: QuestionType) => string;
  resolveQuestionBlockFromBBox: (bbox: BoundingBox) => ResolvedQuestionScope;
  shouldPreferViewportPreview: (
    rawPreviewText: string,
    richPreviewText: string,
    matchedCandidate?: QuestionBlock | null,
  ) => boolean;
};

type RefinementOptions = {
  resolvedBboxMode?: "always" | "large-only";
};

export type ViewportCandidateRefinement = {
  finalViewportBBox: BoundingBox;
  hasImage: boolean;
  imageUrl?: string;
  matchedCandidate: QuestionBlock | null;
  matchedVisibleCandidate: QuestionBlock | null;
  previewText: string;
  resolved: ResolvedQuestionScope;
  typeGuess: QuestionType;
};

export function refineViewportCandidate(
  candidate: QuestionBlock,
  scrollRoot: ScanScrollRoot,
  deps: RefinementDeps,
  options: RefinementOptions = {},
): ViewportCandidateRefinement {
  const viewportBBox = projectAbsoluteBboxToViewport(candidate.bbox, scrollRoot);
  const visibleCandidates = deps.detectCandidatesInViewport();
  const viewportTarget: QuestionBlock = {
    ...candidate,
    bbox: viewportBBox,
  };
  const matchedVisibleCandidate =
    findMatchingCandidate(visibleCandidates, viewportTarget)
    ?? findBestVisibleCandidateByOrder(visibleCandidates, candidate, deps.extractQuestionOrder);

  const resolved = deps.resolveQuestionBlockFromBBox(viewportBBox);
  const rawPreviewText = deps.extractTextFromBBox(resolved.finalBBox);
  const matchedCandidate = matchedVisibleCandidate ?? resolved.matchedCandidate;
  const typeGuess =
    matchedCandidate?.questionTypeGuess
    ?? candidate.questionTypeGuess
    ?? deps.inferQuestionType(rawPreviewText || candidate.previewText);
  const richPreviewText =
    matchedVisibleCandidate?.previewText
    || resolved.previewText
    || matchedCandidate?.previewText
    || candidate.previewText;
  const previewText = deps.shouldPreferViewportPreview(rawPreviewText, richPreviewText, matchedCandidate)
    ? richPreviewText
    : (deps.pickBestPreviewText(rawPreviewText, richPreviewText, typeGuess) || richPreviewText || rawPreviewText);
  const imageUrl =
    matchedVisibleCandidate?.questionImageUrl
    ?? matchedCandidate?.questionImageUrl
    ?? deps.extractQuestionImageUrlFromBBox(resolved.finalBBox)
    ?? candidate.questionImageUrl;
  const hasImage = Boolean(imageUrl) || Boolean(matchedCandidate?.hasImage) || candidate.hasImage;
  const resolvedBboxMode = options.resolvedBboxMode ?? "large-only";
  const canUseResolvedBbox =
    resolvedBboxMode === "always"
    || (resolved.finalBBox.width > 120 && resolved.finalBBox.height > 60);
  const finalViewportBBox =
    matchedVisibleCandidate?.bbox
    ?? (canUseResolvedBbox ? resolved.finalBBox : viewportBBox);

  return {
    finalViewportBBox,
    hasImage,
    imageUrl: imageUrl ?? undefined,
    matchedCandidate,
    matchedVisibleCandidate,
    previewText,
    resolved,
    typeGuess,
  };
}
