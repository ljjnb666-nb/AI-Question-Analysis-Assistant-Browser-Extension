import type { QuestionBlock } from "@/shared/types";

type AdvanceResult = "continued" | "done";

type AdvanceOptions = {
  currentBlock: QuestionBlock;
  currentOrder: number | null;
  driveFromOrderedPlan: boolean;
  filled: number;
  fixedTotal: number;
  lastFingerprint: string;
  solved: number;
  statusText: string;
  total: number;
};

type AdvanceDeps = {
  advanceAfterSolvedQuestion: (options: {
    currentBlock: QuestionBlock;
    currentOrder: number | null;
    driveFromOrderedPlan: boolean;
    filled: number;
    fixedTotal: number | null;
    lastFingerprint: string;
    solved: number;
    total: number;
  }) => Promise<AdvanceResult>;
  incrementOrderedPlanCursor: () => void;
  sendProgress: (payload: {
    currentBlock: QuestionBlock;
    filled: number;
    questionId: string;
    questionPreview: string;
    solved: number;
    statusText: string;
    total: number;
  }) => void;
  toProgressBlock: (block: QuestionBlock) => QuestionBlock;
};

export async function reportSolvedQuestionAndAdvance(
  options: AdvanceOptions,
  deps: AdvanceDeps,
): Promise<AdvanceResult> {
  deps.sendProgress({
    solved: options.solved,
    filled: options.filled,
    total: options.total,
    currentBlock: deps.toProgressBlock(options.currentBlock),
    questionId: options.currentBlock.id,
    questionPreview: options.currentBlock.previewText,
    statusText: options.statusText,
  });

  const advanceResult = await deps.advanceAfterSolvedQuestion({
    currentBlock: options.currentBlock,
    currentOrder: options.currentOrder,
    driveFromOrderedPlan: options.driveFromOrderedPlan,
    filled: options.filled,
    fixedTotal: options.fixedTotal,
    lastFingerprint: options.lastFingerprint,
    solved: options.solved,
    total: options.total,
  });
  if (options.driveFromOrderedPlan) {
    deps.incrementOrderedPlanCursor();
  }
  return advanceResult;
}
