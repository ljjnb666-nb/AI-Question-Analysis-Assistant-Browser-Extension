import type { QuestionBlock } from "@/shared/types";

type DonePayload = {
  ok: boolean;
  stopped?: boolean;
  solved: number;
  filled: number;
  total: number;
  message: string;
};

type AdvanceDeps = {
  clickNextQuestionButton: () => boolean;
  jumpToNextCandidateInFullPage: (currentBlock: QuestionBlock) => Promise<boolean>;
  sendAutoSolveDone: (payload: DonePayload) => void;
  shouldStopAutoSolveAtTail: (currentOrder: number | null, total: number) => boolean;
  waitForQuestionAdvance: (previousFingerprint: string, previousOrder: number | null) => Promise<boolean>;
};

type AdvanceOptions = {
  currentBlock: QuestionBlock;
  currentOrder: number | null;
  driveFromOrderedPlan: boolean;
  filled: number;
  fixedTotal: number | null;
  lastFingerprint: string;
  solved: number;
  total: number;
};

export async function advanceAfterSolvedQuestion(
  options: AdvanceOptions,
  deps: AdvanceDeps,
): Promise<"continued" | "done"> {
  if (options.driveFromOrderedPlan) {
    return "continued";
  }

  const nextClicked = deps.clickNextQuestionButton();
  if (!nextClicked) {
    const advancedByScroll = await deps.jumpToNextCandidateInFullPage(options.currentBlock);
    if (advancedByScroll) return "continued";
  }

  if (!nextClicked) {
    deps.sendAutoSolveDone({
      ok: true,
      solved: options.solved,
      filled: options.filled,
      total: Math.max(options.total, options.solved),
      message: `自动答题完成，共处理 ${options.solved} 题`,
    });
    return "done";
  }

  const advanced = await deps.waitForQuestionAdvance(options.lastFingerprint, options.currentOrder);
  if (!advanced && deps.shouldStopAutoSolveAtTail(options.currentOrder, options.fixedTotal || options.total)) {
    deps.sendAutoSolveDone({
      ok: true,
      solved: options.solved,
      filled: options.filled,
      total: Math.max(options.fixedTotal || options.total, options.solved),
      message: `自动答题完成，共处理 ${options.solved} 题`,
    });
    return "done";
  }

  return "continued";
}

export function toProgressBlock(block: QuestionBlock): QuestionBlock {
  return { ...block, imageDataUrl: undefined };
}
