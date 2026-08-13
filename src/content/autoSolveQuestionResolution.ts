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

const MAX_AUTO_SOLVE_PARSE_RETRIES = 1;
const MAX_AUTO_SOLVE_PARSE_ATTEMPTS = MAX_AUTO_SOLVE_PARSE_RETRIES + 1;

export async function resolveAutoSolveQuestion(
  options: ResolveQuestionOptions,
  deps: ResolveQuestionDeps,
): Promise<ResolveQuestionResult> {
  let questionCompleted = false;
  let progressMessage: string;
  let filledDelta = 0;

  if (options.currentBlock.completeness?.state === "incomplete" || options.currentBlock.completeness?.state === "unknown") {
    return { filledDelta: 0, questionCompleted: true, progressMessage: "INCOMPLETE_QUESTION: automatic solver withheld this candidate." };
  }

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
    while (parseRetryCount < MAX_AUTO_SOLVE_PARSE_RETRIES && deps.shouldRetryUnstableChoiceParse(parsed)) {
      parseRetryCount += 1;
      deps.sendProgress({
        solved: options.solved,
        filled: options.filled,
        total: options.total,
        currentBlock: deps.toProgressBlock(options.currentBlock),
        statusText: `Auto-solve parse looks unstable. Retrying (${parseRetryCount + 1}/${MAX_AUTO_SOLVE_PARSE_ATTEMPTS})...`,
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
        ? `Auto-solve parse stayed unstable after ${parseRetryCount + 1} attempt(s).`
        : options.needsHistoryReview
          ? `Review complete. Updating question ${options.solved + 1}: ${parsed.answer || "-"}`
          : options.needsQuickAnsweredChoiceReview
            ? `Quick review complete. Verifying question ${options.solved + 1}: ${parsed.answer || "-"}`
            : `Filling question ${options.solved + 1}: ${parsed.answer || "-"}`,
    });

    if (!stableParsed) {
      progressMessage = options.needsQuickAnsweredChoiceReview || options.answerStateComplete
        ? `Auto-solve parse remained unstable after ${MAX_AUTO_SOLVE_PARSE_ATTEMPTS} attempts. Keeping the current answer and continuing.`
        : `Auto-solve parse remained unstable after ${MAX_AUTO_SOLVE_PARSE_ATTEMPTS} attempts. Skipping this question.`;
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
        ? `Quick review verification failed: ${verifyResult.message}. Keeping the current answer and continuing.`
        : `Quick review could not overwrite the answer: ${fillResult.message}. Keeping the current answer and continuing.`;
      questionCompleted = true;
      return { filledDelta, progressMessage, questionCompleted };
    }

    progressMessage = fillResult.ok
      ? `Verification failed after fill: ${verifyResult.message}`
      : `Fill failed: ${fillResult.message}`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (options.needsQuickAnsweredChoiceReview) {
      progressMessage = `Quick review failed. Keeping the current answer and continuing: ${errMsg}`;
      questionCompleted = true;
    } else {
      progressMessage = options.answerStateComplete
        ? `Review failed. Keeping the current answer: ${errMsg}`
        : `Parse failed. Skipping this question: ${errMsg}`;
    }
  }

  return { filledDelta, progressMessage, questionCompleted };
}
