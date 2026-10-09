/**
 * Public live-site acceptance loads unowned SPA content. A successful HTTP
 * document commit is NOT evidence that the expected problem has hydrated.
 *
 * Retry the entire visit + content-readiness pair, never navigation alone.
 * No fallback to a fixture or weaker title matching: an all-shell result is
 * returned as NOT READY so the caller fails closed with sanitized evidence.
 */
export type LiveTargetVisitResult<T> = {
  response: T | null;
  ready: boolean;
  attemptsUsed: number;
  statusCodes: number[];
};

export async function visitLiveTargetUntilReady<T extends { status(): number }>(
  navigate: () => Promise<T | null>,
  verifyLiveContent: () => Promise<void>,
  options: {
    maxAttempts: number;
    betweenAttempts: () => Promise<void>;
    /** If the page is still loading blocking scripts, do not abort them via another navigation. */
    stopIfContentPending?: () => boolean;
  },
): Promise<LiveTargetVisitResult<T>> {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 5) {
    throw new Error("LIVE_TARGET_ATTEMPTS_INVALID");
  }
  let response: T | null = null;
  const statusCodes: number[] = [];
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    // Navigation may time out or fail without an HTTP response. Treat that
    // attempt as unavailable; do not start production detection.
    try {
      response = await navigate();
    } catch {
      response = null;
    }
    const status = response?.status() ?? 0;
    statusCodes.push(status);
    if (status >= 200 && status < 400) {
      try {
        // Even status 200 is only a document shell until the *real* question
        // appears in the DOM. Never allow an empty or challenged shell PASS.
        await verifyLiveContent();
        return { response, ready: true, attemptsUsed: attempt, statusCodes };
      } catch {
        // The expected content did not become visible in this visit.
        // A forced revisit would cancel in-flight scripts and could repeatedly
        // reset SPA hydration. Fail closed rather than manufacture aborts.
        if (options.stopIfContentPending?.()) {
          return { response, ready: false, attemptsUsed: attempt, statusCodes };
        }
      }
    }
    if (attempt < options.maxAttempts) await options.betweenAttempts();
  }
  return { response, ready: false, attemptsUsed: options.maxAttempts, statusCodes };
}
