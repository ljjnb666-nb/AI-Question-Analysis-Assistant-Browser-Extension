import type { QuestionBlock } from "@/shared/types";

type OrderedPlanStateLike = unknown;

type ProgressPayload = {
  running: boolean;
  solved: number;
  filled: number;
  total: number;
  current: number;
  statusText: string;
  currentQuestionId?: string;
  currentPreview?: string;
  currentBlock?: QuestionBlock;
};

type DonePayload = {
  ok: boolean;
  stopped?: boolean;
  solved: number;
  filled: number;
  total: number;
  message: string;
};

type LoopState = {
  lastFingerprint: string;
  repeatedCount: number;
  total: number;
};

type PrepareIterationOptions = {
  driveFromOrderedPlan: boolean;
  filled: number;
  getOrderedPlanCursor: (state: OrderedPlanStateLike) => number;
  getOrderedPlanSize: (state: OrderedPlanStateLike) => number;
  lastFingerprint: string;
  orderedPlanState: OrderedPlanStateLike;
  pickLiveAutoSolveBlock: () => QuestionBlock | null;
  repeatedCount: number;
  resolveOrderedPlanViewportBlock: (state: OrderedPlanStateLike) => Promise<QuestionBlock | null>;
  sendAutoSolveDone: (payload: DonePayload) => void;
  sendAutoSolveProgress: (payload: ProgressPayload) => void;
  solved: number;
  stopRequested: boolean;
  toProgressBlock: (block: QuestionBlock) => QuestionBlock;
  total: number;
  updateTotalCount: () => number;
};

type PrepareIterationResult =
  | { kind: "done"; state: LoopState }
  | {
    kind: "ready";
    currentBlock: QuestionBlock;
    currentFingerprint: string;
    currentOrder: number | null;
    repeatedSameQuestion: boolean;
    state: LoopState;
  };

export async function prepareAutoSolveIteration(
  options: PrepareIterationOptions,
  deps: {
    extractAutoSolveQuestionOrder: (text: string) => number | null;
    getAutoSolveFingerprint: (block: QuestionBlock) => string;
  },
): Promise<PrepareIterationResult> {
  if (options.stopRequested) {
    options.sendAutoSolveDone({
      ok: true,
      stopped: true,
      solved: options.solved,
      filled: options.filled,
      total: Math.max(options.total, options.solved),
      message: "已停止自动答题",
    });
    return {
      kind: "done",
      state: {
        lastFingerprint: options.lastFingerprint,
        repeatedCount: options.repeatedCount,
        total: options.total,
      },
    };
  }

  const currentBlock = options.driveFromOrderedPlan
    ? await options.resolveOrderedPlanViewportBlock(options.orderedPlanState)
    : options.pickLiveAutoSolveBlock();
  if (!currentBlock) {
    if (options.driveFromOrderedPlan && options.getOrderedPlanCursor(options.orderedPlanState) >= options.getOrderedPlanSize(options.orderedPlanState)) {
      options.sendAutoSolveDone({
        ok: true,
        solved: options.solved,
        filled: options.filled,
        total: Math.max(options.total, options.solved),
        message: `自动答题完成，共处理 ${options.solved} 题`,
      });
    } else {
      options.sendAutoSolveDone({
        ok: false,
        solved: options.solved,
        filled: options.filled,
        total: Math.max(options.total, options.solved),
        message: "未找到当前题目题块，自动答题已停止",
      });
    }
    return {
      kind: "done",
      state: {
        lastFingerprint: options.lastFingerprint,
        repeatedCount: options.repeatedCount,
        total: options.total,
      },
    };
  }

  let total = options.total;
  if (total <= 0) {
    total = Math.max(options.updateTotalCount(), options.solved + 1);
  }

  const currentFingerprint = deps.getAutoSolveFingerprint(currentBlock);
  const currentOrder = deps.extractAutoSolveQuestionOrder(currentBlock.previewText || "");
  let repeatedCount = options.repeatedCount;
  let lastFingerprint = options.lastFingerprint;
  if (currentFingerprint && currentFingerprint === lastFingerprint) {
    repeatedCount += 1;
  } else {
    repeatedCount = 0;
    lastFingerprint = currentFingerprint;
  }

  const repeatedSameQuestion = repeatedCount >= 2;
  options.sendAutoSolveProgress({
    running: true,
    solved: options.solved,
    filled: options.filled,
    total,
    current: options.solved + 1,
    statusText: repeatedSameQuestion
      ? `第 ${options.solved + 1} 题仍未完成，正在重试...`
      : `正在解析第 ${options.solved + 1} 题...`,
    currentQuestionId: currentBlock.id,
    currentPreview: currentBlock.previewText,
    currentBlock: options.toProgressBlock(currentBlock),
  });

  return {
    kind: "ready",
    currentBlock,
    currentFingerprint,
    currentOrder,
    repeatedSameQuestion,
    state: {
      lastFingerprint,
      repeatedCount,
      total,
    },
  };
}
