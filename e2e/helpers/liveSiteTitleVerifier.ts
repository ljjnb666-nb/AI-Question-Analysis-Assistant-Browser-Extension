import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Only recover after the normal live-title assertion has timed out and a
 * script is observably still loading. A commit-level document response is
 * not evidence that a blocking SPA script has finished.
 *
 * This is a one-shot bounded grace, shared across all visits in one test.
 * Even after recovery, success still requires the actual expected title in
 * the live DOM; neither HTTP 200 nor pending-script telemetry can PASS.
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
  const titleVisible = async () => {
    const body = options.page.locator("body");
    if (await body.count() === 0) return false;
    return (await body.innerText()).includes(options.expectedTitle);
  };
  const verifyWithBudget = async (timeout: number) => {
    await expect.poll(titleVisible, {
      timeout,
      intervals: [100, 250, 500, 1_000],
    }).toBe(true);
  };
  return {
    async verify() {
      try {
        await verifyWithBudget(options.baseTimeoutMs);
      } catch (error) {
        if (usedGrace || options.pendingScriptCount() <= 0) throw error;
        // Use the extension only once, and only if script work is in flight.
        // A perpetual loader still fails: never convert a shell into success.
        usedGrace = true;
        await verifyWithBudget(options.graceTimeoutMs);
      }
    },
    graceUsed: () => usedGrace,
  };
}
