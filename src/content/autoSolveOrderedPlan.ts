import type { QuestionBlock } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";

type OrderedPlanState = {
  orderedPlan: OrderedPlanEntry[] | null;
  orderedPlanSize: number;
  orderedPlanCursor: number;
};

type OrderedPlanCoordinateSpace = "TOP_VIEWPORT" | "SCROLL_ROOT_ABSOLUTE" | "ROOT_LOCAL";
type OrderedPlanEntry = { block: QuestionBlock; coordinateSpace: OrderedPlanCoordinateSpace };

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
  /** Cross-root detection fallback for pages whose questions live outside the top document. */
  detectRootCandidates?: () => QuestionBlock[];
  detectTotalQuestionCount: () => number;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  getActiveCandidates: () => QuestionBlock[];
  getScrollLeft: (scrollRoot: ScanScrollRoot) => number;
  projectViewportBboxToAbsolute: (bbox: QuestionBlock["bbox"], scrollRoot: ScanScrollRoot) => QuestionBlock["bbox"];
  refreshRuntimeQuestionBlock: (candidate: QuestionBlock) => QuestionBlock | null;
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
): Promise<OrderedPlanEntry[]> {
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
  let refined = await deps.refineFullPageCandidatesViaManualPipeline(roughCandidates);
  let rootFallback: QuestionBlock[] | null = null;
  if (roughCandidates.length === 0 && refined.length === 0 && deps.detectRootCandidates) {
    // The top document has no questions; try every accessible root. Root
    // blocks are already canonical, so they skip the manual refinement.
    rootFallback = deps.detectRootCandidates();
    refined = rootFallback;
  }

  if (rootFallback) {
    state.orderedPlan = deps.sortAutoSolveCandidates(rootFallback).map((block) => ({
      block: { ...block, bbox: deps.projectViewportBboxToAbsolute(block.bbox, deps.scrollRoot) },
      coordinateSpace: "SCROLL_ROOT_ABSOLUTE",
    }));
  } else {
    const blocks = domPlan.length > 0
      ? deps.mergeOrderedPlanWithDetectedCandidates(domPlan, refined)
      : deps.sortAutoSolveCandidates(refined);
    state.orderedPlan = blocks.map((block) => ({ block, coordinateSpace: "SCROLL_ROOT_ABSOLUTE" }));
  }
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
  const currentY = deps.projectViewportBboxToAbsolute(currentBlock.bbox, deps.scrollRoot).y;
  const nextCandidate = plan.find(({ block: candidate }) => {
    const candidateOrder = deps.extractAutoSolveQuestionOrder(candidate.previewText || "");
    if (currentOrder !== null && candidateOrder !== null) return candidateOrder > currentOrder;
    return candidate.bbox.y > currentY + 24;
  });
  if (!nextCandidate) return false;

  const targetBlock = nextCandidate.block;
  const absoluteBox = nextCandidate.coordinateSpace === "TOP_VIEWPORT"
    ? deps.projectViewportBboxToAbsolute(targetBlock.bbox, deps.scrollRoot)
    : targetBlock.bbox;
  const targetTop = Math.max(0, absoluteBox.y - Math.max(96, Math.floor(window.innerHeight * 0.16)));
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

  const entry = plan[state.orderedPlanCursor];
  if (!entry || entry.coordinateSpace === "ROOT_LOCAL") return null;
  const candidate = entry.block;
  const absoluteBox = entry.coordinateSpace === "TOP_VIEWPORT"
    ? deps.projectViewportBboxToAbsolute(candidate.bbox, deps.scrollRoot)
    : candidate.bbox;
  const targetTop = Math.max(0, absoluteBox.y - Math.max(96, Math.floor(window.innerHeight * 0.16)));
  deps.setScrollPosition(deps.scrollRoot, targetTop, deps.getScrollLeft(deps.scrollRoot));
  await deps.pauseMs(550);

  if (candidate.runtimeQuestionHandle) {
    const refreshed = deps.refreshRuntimeQuestionBlock(candidate);
    if (!refreshed) return null;
    return refreshed;
  }

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
