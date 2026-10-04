import { StaleQuestionRevisionError } from "./parseAttemptErrors";
import type { ParseQuestionRuntimeContext } from "./parseRouter";

/** The timeout owner revokes the attempt before any caller can start a replacement. */
export async function withParseTimeout<T>(
  run: (context: ParseQuestionRuntimeContext) => Promise<T>,
  timeoutMs: number,
  reason: string,
  withTimeout: <R>(promise: Promise<R>, timeoutMs: number, reason: string) => Promise<R>,
  parent?: ParseQuestionRuntimeContext,
): Promise<T> {
  const child = new AbortController();
  const signal = parent?.signal ? AbortSignal.any([parent.signal, child.signal]) : child.signal;
  const context = { ...parent, signal };
  try {
    const result = await withTimeout(run(context), timeoutMs, reason);
    if (signal.aborted) throw new StaleQuestionRevisionError();
    return result;
  } finally {
    child.abort();
  }
}
