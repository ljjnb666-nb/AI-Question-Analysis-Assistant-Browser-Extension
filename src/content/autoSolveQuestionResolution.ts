import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import { captureSolveStartControlState } from "./answerFiller";
import type { FillAnswerCode } from "./answerTypes";
import { isStaleQuestionRevisionError } from "@/shared/utils/parseAttemptErrors";

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
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => Promise<{ ok: boolean; filledCount: number; message: string; code?: FillAnswerCode }>;
  isChoiceLikeQuestionType: (questionType: ParseResult["questionType"]) => boolean;
  parseBlockForAutoSolve: (block: QuestionBlock) => Promise<ParseResult>;
  parseBlockForAutoSolveQuickReview: (block: QuestionBlock) => Promise<ParseResult>;
  parseBlockForAutoSolveReview: (block: QuestionBlock, previousResult: ParseResult | null) => Promise<ParseResult>;
  recordAutoSolveHistory: (history: HistoryEntry[], block: QuestionBlock, result: ParseResult) => Promise<boolean | void>;
  isCurrentAutoSolveResult?: (block: QuestionBlock, result: ParseResult) => boolean;
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
  stale?: boolean;
  stopAutomation?: true;
  stopReason?: string;
};

const MAX_AUTO_SOLVE_PARSE_RETRIES = 1;
const MAX_AUTO_SOLVE_PARSE_ATTEMPTS = MAX_AUTO_SOLVE_PARSE_RETRIES + 1;

export async function resolveAutoSolveQuestion(
  options: ResolveQuestionOptions,
  deps: ResolveQuestionDeps,
): Promise<ResolveQuestionResult> {
  captureSolveStartControlState(options.currentBlock);
  let questionCompleted = false;
  let progressMessage: string;
  let filledDelta = 0;
  const staleResult = (): ResolveQuestionResult => ({
    filledDelta: 0,
    progressMessage: "STALE_QUESTION_REVISION",
    questionCompleted: false,
    stale: true,
  });

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
    if (deps.isCurrentAutoSolveResult && !deps.isCurrentAutoSolveResult(options.currentBlock, parsed)) return staleResult();
    let parseRetryCount = 0;
    while (parseRetryCount < MAX_AUTO_SOLVE_PARSE_RETRIES && deps.shouldRetryUnstableChoiceParse(parsed)) {
      if (deps.isCurrentAutoSolveResult && !deps.isCurrentAutoSolveResult(options.currentBlock, parsed)) return staleResult();
      parseRetryCount += 1;
      deps.sendProgress({
        solved: options.solved,
        filled: options.filled,
        total: options.total,
        currentBlock: deps.toProgressBlock(options.currentBlock),
        statusText: `Auto-solve parse looks unstable. Retrying (${parseRetryCount + 1}/${MAX_AUTO_SOLVE_PARSE_ATTEMPTS})...`,
      });
      parsed = await parseOnce();
      if (deps.isCurrentAutoSolveResult && !deps.isCurrentAutoSolveResult(options.currentBlock, parsed)) return staleResult();
    }

    const stableParsed = deps.shouldPersistAutoSolveParseResult(parsed);
    if (stableParsed) {
      if (deps.isCurrentAutoSolveResult && !deps.isCurrentAutoSolveResult(options.currentBlock, parsed)) return staleResult();
      const committed = await deps.recordAutoSolveHistory(options.history, options.currentBlock, parsed);
      if (committed === false || (deps.isCurrentAutoSolveResult && !deps.isCurrentAutoSolveResult(options.currentBlock, parsed))) return staleResult();
    }

    if (deps.isCurrentAutoSolveResult && !deps.isCurrentAutoSolveResult(options.currentBlock, parsed)) return staleResult();

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

    if (deps.isCurrentAutoSolveResult && !deps.isCurrentAutoSolveResult(options.currentBlock, parsed)) return staleResult();
    let fillResult: Awaited<ReturnType<typeof deps.fillParsedAnswerInPage>>;
    let verifyResult: { ok: boolean; message: string };
    try {
      fillResult = await deps.fillParsedAnswerInPage(options.currentBlock, parsed);
      const isChoiceParsedResult = deps.isChoiceLikeQuestionType(parsed.questionType);
      verifyResult = fillResult.ok && isChoiceParsedResult
        ? deps.verifyParsedAnswerInPage(options.currentBlock, parsed)
        : { ok: fillResult.ok, message: fillResult.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fillResult = { ok: false, filledCount: 0, code: "PARTIAL_MUTATION_UNPROVABLE", message: `Transaction or final verification threw: ${message}` };
      verifyResult = { ok: false, message: fillResult.message };
    }
    const fillAccepted = fillResult.ok && verifyResult.ok;

    if (fillAccepted) {
      filledDelta = fillResult.filledCount;
      progressMessage = fillResult.ok ? fillResult.message : verifyResult.message;
      questionCompleted = true;
      return { filledDelta, progressMessage, questionCompleted };
    }

    const stopReason = fillResult.ok ? "FILL_VERIFICATION_FAILED" : fillResult.code ?? "FILL_VERIFICATION_FAILED";
    progressMessage = fillResult.ok
      ? `Fill stopped after fresh verification failed: ${verifyResult.message}`
      : `Fill stopped for safety: ${stopReason}`;
    return { filledDelta: 0, progressMessage, questionCompleted: false, stopAutomation: true, stopReason };
  } catch (err) {
    if (isStaleQuestionRevisionError(err)) return staleResult();
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
