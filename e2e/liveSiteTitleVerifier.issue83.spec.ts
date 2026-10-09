import type { Page, Request } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { visitLiveTargetUntilReady } from "@/shared/utils/liveSiteReadiness";
import { createLiveSiteTitleVerifier } from "./helpers/liveSiteTitleVerifier";

const url = "https://synthetic.test/question";
const title = "SYNTHETIC_PUBLIC_PROBLEM_LOADED";

// A controlled, entirely intercepted browser site. These tests never visit
// Pintia or promote fixture content into live-platform compatibility claims.
async function setupSyntheticPage(page: Page, delayMs: number, scriptLoadsTitle: boolean) {
  const pending = new Set<Request>();
  let visits = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "script") pending.add(request);
  });
  page.on("requestfinished", (request) => { pending.delete(request); });
  page.on("requestfailed", (request) => { pending.delete(request); });
  await page.route("https://synthetic.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/question") {
      visits += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><html><body><main>LOADING_SHELL</main><script src="/slow-script.js"></script></body></html>',
      });
    } else if (pathname === "/slow-script.js") {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: scriptLoadsTitle
          ? 'document.body.querySelector("main").textContent = "SYNTHETIC_PUBLIC_PROBLEM_LOADED";'
          : 'document.body.querySelector("main").textContent = "UNRELATED_PAGE";',
      }).catch(() => {
        // Navigation can legitimately cancel a controlled delayed script.
      });
    } else {
      await route.abort();
    }
  });
  return { pendingScripts: () => pending.size, visits: () => visits };
}

test("ISSUE83_GRACE_01 preserves a slow in-flight SPA script and verifies the real DOM title", async ({ page }) => {
  const fixture = await setupSyntheticPage(page, 600, true);
  const verifier = createLiveSiteTitleVerifier({
    page,
    expectedTitle: title,
    pendingScriptCount: fixture.pendingScripts,
    baseTimeoutMs: 100,
    graceTimeoutMs: 2_500,
  });
  const result = await visitLiveTargetUntilReady(
    () => page.goto(url, { waitUntil: "commit", timeout: 5_000 }),
    verifier.verify,
    { maxAttempts: 2, betweenAttempts: async () => undefined },
  );
  expect(result).toMatchObject({ ready: true, attemptsUsed: 1, statusCodes: [200] });
  expect(fixture.visits()).toBe(1);
  expect(verifier.graceUsed()).toBe(true);
  expect(await page.locator("body").innerText()).toContain(title);
});

test("ISSUE83_GRACE_02 pending scripts and HTTP 200 never authorize an empty shell", async ({ page }) => {
  const fixture = await setupSyntheticPage(page, 600, false);
  const verifier = createLiveSiteTitleVerifier({
    page,
    expectedTitle: title,
    pendingScriptCount: fixture.pendingScripts,
    baseTimeoutMs: 100,
    graceTimeoutMs: 220,
  });
  const result = await visitLiveTargetUntilReady(
    () => page.goto(url, { waitUntil: "commit", timeout: 5_000 }),
    verifier.verify,
    { maxAttempts: 2, betweenAttempts: async () => undefined },
  );
  expect(result).toMatchObject({ ready: false, attemptsUsed: 2, statusCodes: [200, 200] });
  expect(fixture.visits()).toBe(2);
  expect(verifier.graceUsed()).toBe(true);
  expect(await page.locator("body").innerText()).not.toContain(title);
});

test("ISSUE83_GRACE_03 no pending scripts means no extra wait and no synthetic PASS", async ({ page }) => {
  await page.route("https://synthetic.test/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><body>LOADING_SHELL</body>" });
  });
  const verifier = createLiveSiteTitleVerifier({
    page, expectedTitle: title, pendingScriptCount: () => 0,
    baseTimeoutMs: 100, graceTimeoutMs: 3_000,
  });
  const result = await visitLiveTargetUntilReady(
    () => page.goto(url, { waitUntil: "commit", timeout: 5_000 }),
    verifier.verify,
    { maxAttempts: 1, betweenAttempts: async () => undefined },
  );
  expect(result).toMatchObject({ ready: false, attemptsUsed: 1, statusCodes: [200] });
  expect(verifier.graceUsed()).toBe(false);
});
