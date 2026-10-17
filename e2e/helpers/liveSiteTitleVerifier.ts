import { errors, type Page } from "@playwright/test";

/**
 * Only recover after the normal live-title assertion has timed out and a
 * script is observably still loading. A commit-level document response is
 * not evidence that a blocking SPA script has finished.
 *
 * This is a one-shot bounded grace, shared across all visits in one test.
 * Even after recovery, success still requires the actual expected title in
 * the live DOM; neither HTTP 200 nor pending-script telemetry can PASS.
 *
 * Unexpected page/context errors are not readiness timeouts and must never
 * consume the grace budget or be disguised as an upstream script stall.
 */
export function createLiveSiteTitleVerifier(options: {
  page: Page;
  expectedTitle: string;
  pendingScriptCount: () => number;
  baseTimeoutMs: number;
  graceTimeoutMs: number;
}): {
  verify: () => Promise<void>;
  graceUsed: () => boolean;
} {
  if (!Number.isSafeInteger(options.baseTimeoutMs) || options.baseTimeoutMs < 1 ||
      !Number.isSafeInteger(options.graceTimeoutMs) || options.graceTimeoutMs < 1 ||
      options.graceTimeoutMs > 6_000 || options.expectedTitle.length < 1) {
    throw new Error("LIVE_SITE_TITLE_VERIFIER_CONFIG_INVALID");
  }

  let usedGrace = false;
  const verifyWithBudget = async (timeout: number) => {
    // waitForFunction exposes Playwright's typed TimeoutError. expect.poll
    // also rejects on non-timeout failures, which cannot safely authorize
    // another grace interval when the browser context has been lost.
    const handle = await options.page.waitForFunction(
      (expectedTitle: string) => Boolean(document.body?.innerText.includes(expectedTitle)),
      options.expectedTitle,
      { timeout, polling: 100 },
    );
    await handle.dispose();
  };
  return {
    async verify() {
      try {
        await verifyWithBudget(options.baseTimeoutMs);
      } catch (error) {
        if (!(error instanceof errors.TimeoutError) || usedGrace || options.pendingScriptCount() <= 0) {
          throw error;
        }
        // Use the extension only once, only for a real content timeout,
        // and only if script work is in flight. A perpetual loader fails.
        usedGrace = true;
        await verifyWithBudget(options.graceTimeoutMs);
      }
    },
    graceUsed: () => usedGrace,
  };
}
