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

function testPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>E3B02B UI run owner</title></head>
  <body style="margin:0"><form id="trap" method="post" action="/__trap_submit">
  <input id="answer" name="answer" autocomplete="off"><button type="submit">Submit</button></form>
  <section class="question-item"><h2>What is two plus two?</h2>
  <p>A. 3 &nbsp; B. 4 &nbsp; C. 5</p></section>
  <div style="height:2000000px"></div>
  <script>window.__submitEvents=0;document.getElementById('trap').addEventListener('submit',e=>{
    e.preventDefault();window.__submitEvents++;
  });</script></body></html>`;
}

async function serverFixture(): Promise<{ origin: string; submissions: () => number; close: () => Promise<void> }> {
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
    response.end(testPage());
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

test("@phase14b-e3b2b1 UI_START genuine owner survives account switch without stale STOP authority", async () => {
  test.setTimeout(160_000);
  const backend = await startTestAnalyticsBackend();
  const probe = await serverFixture();
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
