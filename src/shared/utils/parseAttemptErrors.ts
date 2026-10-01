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

export const PROVIDER_NOT_CONFIGURED = "PROVIDER_NOT_CONFIGURED" as const;

/**
 * UI-00A: a provider that requires a key was asked to parse without one.
 * This replaces the old silent mock fallback; `message` carries the
 * natural-language hint while `code` stays machine-stable.
 */
export class ProviderNotConfiguredError extends Error {
  readonly code = PROVIDER_NOT_CONFIGURED;

  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export function isProviderNotConfiguredError(error: unknown): error is ProviderNotConfiguredError {
  return error instanceof ProviderNotConfiguredError
    || (typeof error === "object" && error !== null && "code" in error && error.code === PROVIDER_NOT_CONFIGURED);
}
