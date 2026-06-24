import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";

type AutoSolveProgressPayload = {
  currentBlock: QuestionBlock;
  filled: number;
  solved: number;
  statusText: string;
  total: number;
};

type ResolveQuestionOptions = {
  answerStateComplete: boolean;
  currentBlock: QuestionBlock;
  filled: number;
  history: HistoryEntry[];
  historyEntry: HistoryEntry | null;
  needsHistoryReview: boolean;
  needsQuickAnsweredChoiceReview: boolean;
  solved: number;
  total: number;
};

type ResolveQuestionDeps = {
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => Promise<{ ok: boolean; filledCount: number; message: string }>;
  isChoiceLikeQuestionType: (questionType: ParseResult["questionType"]) => boolean;
  parseBlockForAutoSolve: (block: QuestionBlock) => Promise<ParseResult>;
  parseBlockForAutoSolveQuickReview: (block: QuestionBlock) => Promise<ParseResult>;
  parseBlockForAutoSolveReview: (block: QuestionBlock, previousResult: ParseResult | null) => Promise<ParseResult>;
  recordAutoSolveHistory: (history: HistoryEntry[], block: QuestionBlock, result: ParseResult) => Promise<void>;
  sendProgress: (payload: AutoSolveProgressPayload) => void;
  shouldPersistAutoSolveParseResult: (result: ParseResult) => boolean;
  shouldRetryUnstableChoiceParse: (result: ParseResult) => boolean;
  toProgressBlock: (block: QuestionBlock) => QuestionBlock;
  verifyParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => { ok: boolean; message: string };
};

type ResolveQuestionResult = {
  filledDelta: number;
  progressMessage: string;
  questionCompleted: boolean;
};

export async function resolveAutoSolveQuestion(
  options: ResolveQuestionOptions,
  deps: ResolveQuestionDeps,
): Promise<ResolveQuestionResult> {
  let questionCompleted = false;
  let progressMessage: string;
  let filledDelta = 0;

  try {
    const parseOnce = () => (
      options.needsHistoryReview
        ? deps.parseBlockForAutoSolveReview(options.currentBlock, options.historyEntry?.result ?? null)
        : options.needsQuickAnsweredChoiceReview
          ? deps.parseBlockForAutoSolveQuickReview(options.currentBlock)
          : deps.parseBlockForAutoSolve(options.currentBlock)
    );

    let parsed = await parseOnce();
    let parseRetryCount = 0;
    while (parseRetryCount < 2 && deps.shouldRetryUnstableChoiceParse(parsed)) {
      parseRetryCount += 1;
      deps.sendProgress({
        solved: options.solved,
        filled: options.filled,
        total: options.total,
        currentBlock: deps.toProgressBlock(options.currentBlock),
        statusText: `第 ${options.solved + 1} 题解析结果不稳定，正在重试解析（${parseRetryCount + 1}/3）...`,
      });
      parsed = await parseOnce();
    }

    const stableParsed = deps.shouldPersistAutoSolveParseResult(parsed);
    if (stableParsed) {
      await deps.recordAutoSolveHistory(options.history, options.currentBlock, parsed);
    }

    deps.sendProgress({
      solved: options.solved,
      filled: options.filled,
      total: options.total,
      currentBlock: deps.toProgressBlock(options.currentBlock),
      statusText: !stableParsed
        ? `第 ${options.solved + 1} 题重试 ${parseRetryCount + 1} 次后仍未得到稳定答案`
        : options.needsHistoryReview
          ? `复核完成，正在更新第 ${options.solved + 1} 题答案：${parsed.answer || "-"}`
          : options.needsQuickAnsweredChoiceReview
            ? `快速复核完成，正在校验第 ${options.solved + 1} 题答案：${parsed.answer || "-"}`
            : `正在填写第 ${options.solved + 1} 题，答案：${parsed.answer || "-"}`,
    });

    if (!stableParsed) {
      progressMessage = options.needsQuickAnsweredChoiceReview || options.answerStateComplete
        ? "重解析 3 次后仍未得到稳定答案，保留当前作答并继续"
        : "重解析 3 次后仍未得到稳定答案，已跳过本题";
      questionCompleted = true;
      return { filledDelta, progressMessage, questionCompleted };
    }

    const fillResult = await deps.fillParsedAnswerInPage(options.currentBlock, parsed);
    const isChoiceParsedResult = deps.isChoiceLikeQuestionType(parsed.questionType);
    const verifyResult = isChoiceParsedResult
      ? deps.verifyParsedAnswerInPage(options.currentBlock, parsed)
      : { ok: true, message: fillResult.message };
    const fillAccepted = isChoiceParsedResult ? verifyResult.ok : fillResult.ok;

    if (fillAccepted) {
      filledDelta = fillResult.filledCount;
      progressMessage = fillResult.ok ? fillResult.message : verifyResult.message;
      questionCompleted = true;
      return { filledDelta, progressMessage, questionCompleted };
    }

    if (options.needsQuickAnsweredChoiceReview) {
      progressMessage = fillResult.ok
        ? `快速复核后校验失败：${verifyResult.message}，保留当前作答并继续`
        : `快速复核未能覆盖：${fillResult.message}，保留当前作答并继续`;
      questionCompleted = true;
      return { filledDelta, progressMessage, questionCompleted };
    }

    progressMessage = fillResult.ok
      ? `填写后校验失败：${verifyResult.message}`
      : `填写失败：${fillResult.message}`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (options.needsQuickAnsweredChoiceReview) {
      progressMessage = `快速复核失败，保留现有答案并继续：${errMsg}`;
      questionCompleted = true;
    } else {
      progressMessage = options.answerStateComplete
        ? `复核失败，保留现有答案：${errMsg}`
        : `解析失败，已跳过：${errMsg}`;
    }
  }

  return { filledDelta, progressMessage, questionCompleted };
}
