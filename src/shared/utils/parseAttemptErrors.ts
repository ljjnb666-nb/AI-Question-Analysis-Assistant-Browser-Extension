export const STALE_QUESTION_REVISION = "STALE_QUESTION_REVISION" as const;

export class StaleQuestionRevisionError extends Error {
  readonly code = STALE_QUESTION_REVISION;

  constructor() {
    super(STALE_QUESTION_REVISION);
    this.name = "StaleQuestionRevisionError";
  }
}

export function isStaleQuestionRevisionError(error: unknown): error is StaleQuestionRevisionError {
  return error instanceof StaleQuestionRevisionError
    || (typeof error === "object" && error !== null && "code" in error && error.code === STALE_QUESTION_REVISION);
}
