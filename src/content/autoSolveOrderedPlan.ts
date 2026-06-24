import type { QuestionBlock } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";

type OrderedPlanState = {
  orderedPlan: QuestionBlock[] | null;
  orderedPlanSize: number;
  orderedPlanCursor: number;
};

type ViewportRefinement = {
  finalViewportBBox: QuestionBlock["bbox"];
  hasImage: boolean;
  imageUrl?: string;
  matchedVisibleCandidate?: QuestionBlock | null;
  previewText: string;
  typeGuess: QuestionBlock["questionTypeGuess"];
};

type OrderedPlanDeps = {
  activeDetectMode: "viewport" | "fullpage" | null;
  detectCandidatesFullPage: () => Promise<QuestionBlock[]>;
  detectTotalQuestionCount: () => number;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  getActiveCandidates: () => QuestionBlock[];
  getScrollLeft: (scrollRoot: ScanScrollRoot) => number;
  mergeOrderedPlanWithDetectedCandidates: (domPlan: QuestionBlock[], refined: QuestionBlock[]) => QuestionBlock[];
  pauseMs: (ms: number) => Promise<void>;
  refineFullPageCandidatesViaManualPipeline: (candidates: QuestionBlock[]) => Promise<QuestionBlock[]>;
  refineViewportCandidate: (candidate: QuestionBlock, scrollRoot: ScanScrollRoot) => ViewportRefinement;
  scrollRoot: ScanScrollRoot;
  sequentialScrollMode: boolean;
  setScrollPosition: (scrollRoot: ScanScrollRoot, top: number, left: number) => void;
  sortAutoSolveCandidates: (candidates: QuestionBlock[]) => QuestionBlock[];
  buildOrderedPlanFromDomQuestionCards: (scrollRoot: ScanScrollRoot) => QuestionBlock[];
};

export function createOrderedPlanState(): OrderedPlanState {
  return {
    orderedPlan: null,
    orderedPlanSize: 0,
    orderedPlanCursor: 0,
  };
}

export async function ensureOrderedPlan(
  state: OrderedPlanState,
  deps: OrderedPlanDeps,
): Promise<QuestionBlock[]> {
  if (state.orderedPlan?.length) return state.orderedPlan;

  const shouldForceFullPagePlan =
    deps.activeDetectMode !== "fullpage"
    || deps.getActiveCandidates().length <= 1
    || deps.detectTotalQuestionCount() > Math.max(deps.getActiveCandidates().length, 0) + 1;

  const domPlan = deps.sequentialScrollMode
    ? deps.buildOrderedPlanFromDomQuestionCards(deps.scrollRoot)
    : [];
  const roughCandidates = shouldForceFullPagePlan
    ? await deps.detectCandidatesFullPage()
    : deps.getActiveCandidates();
  const refined = await deps.refineFullPageCandidatesViaManualPipeline(roughCandidates);

  state.orderedPlan = domPlan.length > 0
    ? deps.mergeOrderedPlanWithDetectedCandidates(domPlan, refined)
    : deps.sortAutoSolveCandidates(refined);
  state.orderedPlanSize = state.orderedPlan.length;
  return state.orderedPlan;
}

export async function jumpToNextCandidateInFullPage(
  currentBlock: QuestionBlock,
  state: OrderedPlanState,
  deps: OrderedPlanDeps,
): Promise<boolean> {
  if (!deps.sequentialScrollMode) return false;
  const plan = await ensureOrderedPlan(state, deps);
  if (!plan.length) return false;

  const currentOrder = deps.extractAutoSolveQuestionOrder(currentBlock.previewText || "");
  const currentY = currentBlock.bbox.y;
  const nextCandidate = plan.find((candidate) => {
    const candidateOrder = deps.extractAutoSolveQuestionOrder(candidate.previewText || "");
    if (currentOrder !== null && candidateOrder !== null) return candidateOrder > currentOrder;
    return candidate.bbox.y > currentY + 24;
  });
  if (!nextCandidate) return false;

  const targetTop = Math.max(0, nextCandidate.bbox.y - Math.max(96, Math.floor(window.innerHeight * 0.16)));
  deps.setScrollPosition(deps.scrollRoot, targetTop, deps.getScrollLeft(deps.scrollRoot));
  await deps.pauseMs(550);
  return true;
}

export async function resolveOrderedPlanViewportBlock(
  state: OrderedPlanState,
  deps: OrderedPlanDeps,
): Promise<QuestionBlock | null> {
  const plan = await ensureOrderedPlan(state, deps);
  if (state.orderedPlanCursor >= plan.length) return null;

  const candidate = plan[state.orderedPlanCursor];
  const targetTop = Math.max(0, candidate.bbox.y - Math.max(96, Math.floor(window.innerHeight * 0.16)));
  deps.setScrollPosition(deps.scrollRoot, targetTop, deps.getScrollLeft(deps.scrollRoot));
  await deps.pauseMs(550);

  const refined = deps.refineViewportCandidate(candidate, deps.scrollRoot);
  return {
    ...candidate,
    bbox: refined.finalViewportBBox,
    previewText: refined.previewText,
    questionTypeGuess: refined.typeGuess,
    questionImageUrl: refined.imageUrl,
    hasImage: refined.hasImage,
    confidence: refined.matchedVisibleCandidate?.confidence ?? candidate.confidence,
  };
}

export function incrementOrderedPlanCursor(state: OrderedPlanState): void {
  state.orderedPlanCursor += 1;
}

export function getOrderedPlanCursor(state: OrderedPlanState): number {
  return state.orderedPlanCursor;
}

export function getOrderedPlanSize(state: OrderedPlanState): number {
  return state.orderedPlanSize;
}
