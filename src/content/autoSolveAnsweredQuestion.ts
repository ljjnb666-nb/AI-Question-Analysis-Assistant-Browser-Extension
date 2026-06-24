import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";

type AnswerState = {
  mode: "choice" | "text" | "none";
  answeredCount: number;
  totalCount: number;
  complete: boolean;
};

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

type AdvanceResult = "continued" | "done";

type AnsweredQuestionOptions = {
  answerState: AnswerState;
  currentBlock: QuestionBlock;
  currentOrder: number | null;
  driveFromOrderedPlan: boolean;
  filled: number;
  fixedTotal: number;
  history: HistoryEntry[];
  lastFingerprint: string;
  locationHostname: string;
  repeatedCount: number;
  solved: number;
  total: number;
};

type AnsweredQuestionDeps = {
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => Promise<{ ok: boolean; filledCount: number; message: string }>;
  findReusableHistoryEntry: (history: HistoryEntry[], block: QuestionBlock, hostname?: string) => HistoryEntry | null;
  isChoiceLikeQuestionType: (questionType: ParseResult["questionType"]) => boolean;
  reportSolvedQuestionAndAdvance: (options: {
    currentBlock: QuestionBlock;
    currentOrder: number | null;
    driveFromOrderedPlan: boolean;
    filled: number;
    fixedTotal: number;
    lastFingerprint: string;
    solved: number;
    statusText: string;
    total: number;
  }) => Promise<AdvanceResult>;
  sendAutoSolveProgress: (payload: ProgressPayload) => void;
  shouldReviewLowConfidenceHistory: (entry: HistoryEntry | null) => boolean;
  toProgressBlock: (block: QuestionBlock) => QuestionBlock;
  verifyParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => { ok: boolean; message: string };
};

type AnsweredQuestionResult = {
  answerState: AnswerState;
  done: boolean;
  filled: number;
  handled: boolean;
  historyEntry: HistoryEntry | null;
  needsHistoryReview: boolean;
  needsQuickAnsweredChoiceReview: boolean;
  solved: number;
};

export async function handleAnsweredQuestionPhase(
  options: AnsweredQuestionOptions,
  deps: AnsweredQuestionDeps,
): Promise<AnsweredQuestionResult> {
  let solved = options.solved;
  let filled = options.filled;

  const historyEntry = deps.findReusableHistoryEntry(options.history, options.currentBlock, options.locationHostname);
  const needsHistoryReview = deps.shouldReviewLowConfidenceHistory(historyEntry);
  const needsQuickAnsweredChoiceReview =
    options.answerState.complete
    && options.answerState.mode === "choice"
    && !historyEntry;
  const shouldKeepCurrentChoiceAndAdvance =
    options.repeatedCount >= 1
    && options.answerState.complete
    && options.answerState.mode === "choice";
  const canSafelySkipAnsweredQuestion =
    options.answerState.complete
    && !needsHistoryReview
    && options.answerState.mode === "text";

  if (canSafelySkipAnsweredQuestion) {
    solved += 1;
    const advanceResult = await deps.reportSolvedQuestionAndAdvance({
      currentBlock: options.currentBlock,
      currentOrder: options.currentOrder,
      driveFromOrderedPlan: options.driveFromOrderedPlan,
      filled,
      fixedTotal: options.fixedTotal,
      lastFingerprint: options.lastFingerprint,
      solved,
      statusText: options.answerState.mode === "text"
        ? `检测到本题已填写 ${options.answerState.answeredCount}/${options.answerState.totalCount} 个答案，已跳过`
        : "检测到本题已作答，已跳过",
      total: options.total,
    });
    return {
      answerState: options.answerState,
      done: advanceResult === "done",
      filled,
      handled: true,
      historyEntry,
      needsHistoryReview,
      needsQuickAnsweredChoiceReview,
      solved,
    };
  }

  if (shouldKeepCurrentChoiceAndAdvance) {
    solved += 1;
    const advanceResult = await deps.reportSolvedQuestionAndAdvance({
      currentBlock: options.currentBlock,
      currentOrder: options.currentOrder,
      driveFromOrderedPlan: options.driveFromOrderedPlan,
      filled,
      fixedTotal: options.fixedTotal,
      lastFingerprint: options.lastFingerprint,
      solved,
      statusText: needsHistoryReview
        ? "本题已存在作答，复核仍未收敛，先保留当前选择并继续下一题"
        : "本题已存在作答，重复停留后保留当前选择并继续下一题",
      total: options.total,
    });
    return {
      answerState: options.answerState,
      done: advanceResult === "done",
      filled,
      handled: true,
      historyEntry,
      needsHistoryReview,
      needsQuickAnsweredChoiceReview,
      solved,
    };
  }

  if (options.answerState.complete && needsHistoryReview) {
    deps.sendAutoSolveProgress({
      running: true,
      solved,
      filled,
      total: options.total,
      current: solved + 1,
      statusText: `检测到本题已填写，但历史置信度仅 ${Math.round((historyEntry?.result.confidence ?? 0) * 100)}%，正在复核...`,
      currentQuestionId: options.currentBlock.id,
      currentPreview: options.currentBlock.previewText,
      currentBlock: deps.toProgressBlock(options.currentBlock),
    });
  }

  if (options.answerState.complete && options.answerState.mode === "choice") {
    deps.sendAutoSolveProgress({
      running: true,
      solved,
      filled,
      total: options.total,
      current: solved + 1,
      statusText: needsQuickAnsweredChoiceReview
        ? "检测到本题已作答，正在快速复核并按需覆盖..."
        : needsHistoryReview
          ? "检测到本题已作答，但历史置信度较低，正在复核并准备覆盖..."
          : historyEntry
            ? "检测到本题已作答，正在校验已选答案并按需覆盖..."
            : "检测到本题已作答，正在重新解析并按需覆盖...",
      currentQuestionId: options.currentBlock.id,
      currentPreview: options.currentBlock.previewText,
      currentBlock: deps.toProgressBlock(options.currentBlock),
    });
  }

  if (historyEntry && !needsHistoryReview) {
    deps.sendAutoSolveProgress({
      running: true,
      solved,
      filled,
      total: options.total,
      current: solved + 1,
      statusText: `复用历史解析结果并填写第 ${solved + 1} 题...`,
      currentQuestionId: options.currentBlock.id,
      currentPreview: options.currentBlock.previewText,
      currentBlock: deps.toProgressBlock(options.currentBlock),
    });

    const fillResult = await deps.fillParsedAnswerInPage(options.currentBlock, historyEntry.result);
    const isChoiceHistoryResult = deps.isChoiceLikeQuestionType(historyEntry.result.questionType);
    const verifyResult = isChoiceHistoryResult
      ? deps.verifyParsedAnswerInPage(options.currentBlock, historyEntry.result)
      : { ok: true, message: fillResult.message };
    const historyFillAccepted = isChoiceHistoryResult ? verifyResult.ok : fillResult.ok;

    if (historyFillAccepted) {
      filled += fillResult.filledCount;
      solved += 1;
    }

    deps.sendAutoSolveProgress({
      running: true,
      solved,
      filled,
      total: options.total,
      current: historyFillAccepted ? solved : solved + 1,
      statusText: historyFillAccepted
        ? (fillResult.ok ? `已复用历史答案：${fillResult.message}` : `已校验当前答案：${verifyResult.message}`)
        : fillResult.ok
          ? `历史答案写入后校验失败：${verifyResult.message}，正在重新解析本题`
          : `历史答案未写入：${fillResult.message}，正在重新解析本题`,
      currentQuestionId: options.currentBlock.id,
      currentPreview: options.currentBlock.previewText,
      currentBlock: deps.toProgressBlock(options.currentBlock),
    });

    if (historyFillAccepted) {
      const advanceResult = await deps.reportSolvedQuestionAndAdvance({
        currentBlock: options.currentBlock,
        currentOrder: options.currentOrder,
        driveFromOrderedPlan: options.driveFromOrderedPlan,
        filled,
        fixedTotal: options.fixedTotal,
        lastFingerprint: options.lastFingerprint,
        solved,
        statusText: fillResult.ok ? `已复用历史答案：${fillResult.message}` : `已校验当前答案：${verifyResult.message}`,
        total: options.total,
      });
      return {
        answerState: options.answerState,
        done: advanceResult === "done",
        filled,
        handled: true,
        historyEntry,
        needsHistoryReview,
        needsQuickAnsweredChoiceReview,
        solved,
      };
    }
  }

  return {
    answerState: options.answerState,
    done: false,
    filled,
    handled: false,
    historyEntry,
    needsHistoryReview,
    needsQuickAnsweredChoiceReview,
    solved,
  };
}
