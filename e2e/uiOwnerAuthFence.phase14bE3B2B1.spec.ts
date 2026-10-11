import http from "node:http";
import { expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";
import { readExtensionSettings, seedExtensionSettings, startTestAnalyticsBackend } from "./helpers/authUiHarness";

type WorkMessage =
  | { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT"; expectedUrl: string }
  | { type: "FULL_PAGE_DETECT_CANCELLED"; generationId: string };

type SnapshotResponse = { ok?: boolean; snapshot?: { fullPage?: { running?: boolean } }; error?: string };
declare const chrome: {
  tabs: {
    query: (q: { url: string }) => Promise<Array<{ id?: number }>>;
    sendMessage: (id: number, msg: WorkMessage, opts: { frameId: number }) => Promise<SnapshotResponse>;
  };
  storage: { session: { get: (key: null) => Promise<Record<string, unknown>> } };
};

// Each repeat runs the same production browser/login/STOP lifecycle against
// a slightly different real scrolling geometry. The normal CI (repeat 0)
// preserves its existing fixture exactly; no fake clocks or test-only
// production hooks can make a false-running scan pass.
const scanFixtureVariants = [
  { viewportHeight: 640, fillerHeight: 2_000_000 },
  { viewportHeight: 720, fillerHeight: 1_500_000 },
  { viewportHeight: 600, fillerHeight: 1_250_000 },
  { viewportHeight: 680, fillerHeight: 1_800_000 },
  { viewportHeight: 760, fillerHeight: 1_600_000 },
  { viewportHeight: 640, fillerHeight: 1_300_000 },
] as const;
type ScanFixtureVariant = typeof scanFixtureVariants[number];

function testPage(variant: ScanFixtureVariant): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>E3B02B UI run owner</title></head>
  <body style="margin:0"><form id="trap" method="post" action="/__trap_submit">
  <input id="answer" name="answer" autocomplete="off"><button type="submit">Submit</button></form>
  <!-- A real, question-bearing scroll root is essential: a tall BODY alone
       does not guarantee the detector has a stable scroll lease in CI. -->
  <main id="scan-pane" style="overflow-y:auto;height:${variant.viewportHeight}px;width:min(900px,96vw);">
    <section class="question-item"><h2>What is two plus two?</h2>
      <p>A. 3 &nbsp; B. 4 &nbsp; C. 5 &nbsp; D. 6</p></section>
    <div style="height:${variant.fillerHeight}px"></div>
  </main>
  <script>window.__submitEvents=0;document.getElementById('trap').addEventListener('submit',e=>{
    e.preventDefault();window.__submitEvents++;
  });</script></body></html>`;
}

async function serverFixture(variant: ScanFixtureVariant): Promise<{ origin: string; submissions: () => number; close: () => Promise<void> }> {
  let submissions = 0;
  const server = http.createServer((request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (route === "/__trap_submit") {
      submissions++;
      response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      response.end("UNAUTHORIZED_SUBMISSION");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(testPage(variant));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("E3B02B probe server unavailable");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    submissions: () => submissions,
    close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())),
  };
}

async function workerFor(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function tabIdFor(worker: Worker, url: string): Promise<number> {
  const tabId = await worker.evaluate(async expectedUrl => {
    const matches = await chrome.tabs.query({ url: expectedUrl });
    return matches[0]?.id ?? null;
  }, url);
  if (!tabId) throw Error("E3B02B origin tab not found");
  return tabId;
}

async function leaseIds(worker: Worker, tabId: number): Promise<string[]> {
  return worker.evaluate(async id => {
    const all = await chrome.storage.session.get(null);
    const prefix = `protectedWorkOwner:fullPage:${id}:`;
    return Object.entries(all).filter(([key, v]) =>
      key.startsWith(prefix) && (v as { active?: boolean; completionProtocol?: string })?.active === true
      && (v as { completionProtocol?: string }).completionProtocol === "generation")
      .map(([key]) => key.slice(prefix.length)).sort();
  }, tabId);
}

async function snapshot(worker: Worker, tabId: number, url: string): Promise<SnapshotResponse> {
  return worker.evaluate(async ({ id, url }) =>
    chrome.tabs.sendMessage(id, { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: url },
      { frameId: 0 }), { id: tabId, url });
}

async function staleStop(worker: Worker, tabId: number, generationId: string): Promise<SnapshotResponse> {
  return worker.evaluate(async ({ id, generationId }) =>
    chrome.tabs.sendMessage(id, { type: "FULL_PAGE_DETECT_CANCELLED", generationId },
      { frameId: 0 }), { id: tabId, generationId });
}

async function clickScan(panel: Page): Promise<void> {
  await panel.getByRole("group", { name: /^(候选题目操作|Candidate actions)$/ })
    .getByRole("button", { name: /^(整页扫描|Full Page)$/ }).click();
}

/** Fixture-owned proof of scan progress, not a sleep or test-only production hook. */
async function scanPane(exam: Page): Promise<{ top: number; scrollHeight: number; clientHeight: number }> {
  return exam.locator("#scan-pane").evaluate(el => ({
    top: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
  }));
}

test("@phase14b-e3b2b1 UI_START genuine owner survives account switch without stale STOP authority", async () => {
  test.setTimeout(160_000);
  const variationIndex = test.info().repeatEachIndex;
  const scanVariant = scanFixtureVariants[variationIndex % scanFixtureVariants.length];
  // Numeric fixture-only evidence; account IDs, tokens and page text are never logged.
  console.log(`I121_SOAK_VARIANT repeat=${variationIndex} viewport=${scanVariant.viewportHeight} filler=${scanVariant.fillerHeight}`);
  const backend = await startTestAnalyticsBackend();
  const probe = await serverFixture(scanVariant);
  let context: BrowserContext | undefined;
  try {
    const first = await backend.registerAccount("e3b2b1-user-first");
    const second = await backend.registerAccount("e3b2b1-user-second");
    context = await launchExtensionContext();
    const extensionId = await resolveExtensionId(context);
    const worker = await workerFor(context);
    const url = probe.origin + "/exam";
    // Only one HTTP tab exists: workspace target resolution is unambiguous.
    const exam = await context.newPage();
    await exam.goto(url);
    // The production detector selects this question-bearing overflow root.
    // 2M px gives it the documented 200-step bounded scan, rather than an
    // unspecified body/window scroller that can finish before UI_START checks.
    const fixture = await scanPane(exam);
    expect(fixture.clientHeight).toBeGreaterThanOrEqual(600);
    expect(fixture.scrollHeight - fixture.clientHeight).toBeGreaterThan(120_000);
    const tabId = await tabIdFor(worker, url);
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: backend.baseUrl, userId: first.userId,
      userEmail: first.email, authToken: first.authToken,
    });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
    await expect(panel.getByText(/^(工作台|Workspace)$/)).toBeVisible({ timeout: 25_000 });
    // The live content runtime is hydrated by the PRODUCTION Side Panel.
    await expect(panel.locator("[data-candidate-workspace]")).toBeVisible({ timeout: 25_000 });
    expect(await leaseIds(worker, tabId)).toEqual([]);

    // Use actual accessible UI controls. No owner storage seeding, no synthetic
    // START runtime message. The application must own the UUID and dispatch it.
    await clickScan(panel);
    await expect.poll(() => leaseIds(worker, tabId), { timeout: 10_000 })
      .toHaveLength(1);
    const [oldGeneration] = await leaseIds(worker, tabId);
    expect(oldGeneration).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/);
    await expect.poll(async () => (await snapshot(worker, tabId, url)).snapshot?.fullPage?.running,
      { timeout: 10_000 }).toBe(true);

    // Revoke through the REAL analytics server store. A new real popup gets a
    // real server 401 and clears all surfaces' cached credentials.
    await backend.revokeSession(first.userId, first.authToken);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expect(popup.getByRole("button", { name: /^(发送验证码|Send Code|登录|Login)$/ }).first())
      .toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const settings = await readExtensionSettings(panel);
      return !settings.userId && !settings.authToken;
    }, { timeout: 20_000 }).toBe(true);
    await expect(panel.locator("[data-candidate-workspace]")).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await leaseIds(worker, tabId)).includes(oldGeneration),
      { timeout: 15_000 }).toBe(false);
    expect(await staleStop(worker, tabId, oldGeneration))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });

    // Login again as a DIFFERENT authenticated user via a real server-issued
    // session. The same tab/runtime is now eligible for a new UI-initiated run.
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: backend.baseUrl, userId: second.userId,
      userEmail: second.email, authToken: second.authToken,
    });
    await expect(panel.getByText(/^(工作台|Workspace)$/)).toBeVisible({ timeout: 25_000 });
    await panel.getByRole("tab", { name: /^(候选题|Candidates)$/ }).click();
    await expect(panel.locator("[data-candidate-workspace]")).toBeVisible({ timeout: 25_000 });
    await clickScan(panel);
    await expect.poll(async () => (await leaseIds(worker, tabId)).filter(id => id !== oldGeneration).length,
      { timeout: 10_000 }).toBe(1);
    const [newGeneration] = (await leaseIds(worker, tabId)).filter(id => id !== oldGeneration);
    expect(newGeneration).toBeTruthy();
    // Old cancellation messages must not acquire authority over the new run.
    expect(await staleStop(worker, tabId, oldGeneration))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });
    await expect.poll(async () => (await snapshot(worker, tabId, url)).snapshot?.fullPage?.running,
      { timeout: 10_000 }).toBe(true);
    expect(await leaseIds(worker, tabId)).toContain(newGeneration);
    // A genuine RUNNING state must also produce advancing scroll work; merely
    // writing a generation key or seeing a transient flag is not sufficient.
    await expect.poll(async () => (await scanPane(exam)).top, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const beforeStaleStopTop = (await scanPane(exam)).top;
    expect(await staleStop(worker, tabId, oldGeneration))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });
    await expect.poll(async () => (await scanPane(exam)).top, { timeout: 10_000 })
      .toBeGreaterThan(beforeStaleStopTop);
    expect((await snapshot(worker, tabId, url)).snapshot?.fullPage?.running).toBe(true);
    expect(await leaseIds(worker, tabId)).toContain(newGeneration);

    // Real UI cancels the new run and removes its exact owner identity.
    await panel.getByRole("group", { name: /^(候选题目操作|Candidate actions)$/ })
      .getByRole("button", { name: /^(取消扫描|Cancel scan)$/ }).click();
    await expect.poll(async () => (await leaseIds(worker, tabId)).includes(newGeneration),
      { timeout: 15_000 }).toBe(false);
    expect(await staleStop(worker, tabId, newGeneration))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });

    expect(await exam.locator("#answer").inputValue()).toBe("");
    expect(await exam.evaluate(() => (window as unknown as Window & { __submitEvents: number }).__submitEvents)).toBe(0);
    expect(probe.submissions()).toBe(0); // Includes native HTMLFormElement.submit.
  } finally {
    if (context) await closeExtensionContext(context);
    await probe.close();
    await backend.close();
  }
});


test("@rc03d-r3 real Side Panel close/reopen rehydrates the live scan without stealing its owner", async () => {
  test.setTimeout(140_000);
  const backend = await startTestAnalyticsBackend();
  const probe = await serverFixture(scanFixtureVariants[0]);
  let context: BrowserContext | undefined;
  try {
    const account = await backend.registerAccount("rc03d-r3-panel-reopen");
    context = await launchExtensionContext();
    const extensionId = await resolveExtensionId(context);
    const worker = await workerFor(context);
    const url = probe.origin + "/exam";
    const exam = await context.newPage();
    await exam.goto(url);
    const fixture = await scanPane(exam);
    expect(fixture.scrollHeight - fixture.clientHeight).toBeGreaterThan(120_000);
    const tabId = await tabIdFor(worker, url);
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: backend.baseUrl, userId: account.userId,
      userEmail: account.email, authToken: account.authToken,
    });

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
    await expect(panel.locator("[data-candidate-workspace]")).toBeVisible({ timeout: 25_000 });
    await clickScan(panel);
    await expect.poll(() => leaseIds(worker, tabId), { timeout: 10_000 }).toHaveLength(1);
    const [generation] = await leaseIds(worker, tabId);
    await expect.poll(async () => (await snapshot(worker, tabId, url)).snapshot?.fullPage?.running,
      { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await scanPane(exam)).top, { timeout: 10_000 })
      .toBeGreaterThan(0);

    // Close only the UI document: the authenticated content runtime and its
    // protected-work owner must not be resurrected or replaced by a new panel.
    await panel.close();
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
    await expect(reopened.locator("[data-candidate-workspace]")).toBeVisible({ timeout: 25_000 });
    await expect(reopened.getByRole("group", { name: /^(候选题目操作|Candidate actions)$/ })
      .getByRole("button", { name: /^(取消扫描|Cancel scan)$/ })).toBeVisible({ timeout: 15_000 });
    expect(await leaseIds(worker, tabId)).toEqual([generation]);
    const before = (await scanPane(exam)).top;
    await expect.poll(async () => (await scanPane(exam)).top, { timeout: 10_000 })
      .toBeGreaterThan(before);
    expect((await snapshot(worker, tabId, url)).snapshot?.fullPage?.running).toBe(true);
    // Old or invented generations have no right to STOP the surviving run.
    expect(await staleStop(worker, tabId, "18aabcde-0ee2-4e98-8e12-48fdce879999"))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });

    // Only the reopened panel's REAL cancel control may stop this exact run.
    await reopened.getByRole("group", { name: /^(候选题目操作|Candidate actions)$/ })
      .getByRole("button", { name: /^(取消扫描|Cancel scan)$/ }).click();
    await expect.poll(async () => (await leaseIds(worker, tabId)).includes(generation),
      { timeout: 15_000 }).toBe(false);
    expect(await staleStop(worker, tabId, generation))
      .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });

    expect(await exam.locator("#answer").inputValue()).toBe("");
    expect(await exam.evaluate(() => (window as unknown as Window & { __submitEvents: number }).__submitEvents)).toBe(0);
    expect(probe.submissions()).toBe(0);
  } finally {
    if (context) await closeExtensionContext(context);
    await probe.close();
    await backend.close();
  }
});
