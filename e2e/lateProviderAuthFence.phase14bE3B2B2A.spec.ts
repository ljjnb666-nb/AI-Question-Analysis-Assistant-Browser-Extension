import http, { type ServerResponse } from "node:http";
import { expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";
import { seedAIConnection, routeCanonicalOpenAIToFixture } from "./helpers/aiConnectionHarness";
import { readExtensionSettings, seedExtensionSettings, startTestAnalyticsBackend } from "./helpers/authUiHarness";

declare const chrome: {
  runtime: { sendMessage: (message: { type: "AI_CONNECTION_GET_ACTIVE_METADATA" }) => Promise<unknown> };
  tabs: {
    query: (filter: { url: string }) => Promise<Array<{ id?: number }>>;
    sendMessage: (id: number, message:
      | { type: "STOP_AUTO_SOLVE_ALL"; generationId: string }
      | { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT"; expectedUrl: string },
      options: { frameId: number }) => Promise<{
        ok?: boolean; error?: string; snapshot?: {
          candidates?: Array<{ block: { previewText: string; completeness?: { state: string } } }>;
          autoSolve?: { running?: boolean; progress?: unknown };
          detection?: { phase?: string };
        };
      }>;
  };
  storage: { session: { get: (keys: null) => Promise<Record<string, unknown>> } };
};

function pageHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>E3B2B2A delayed provider</title></head>
    <body style="margin:0">
    <form action="/__trap_submit" method="post" id="no-submit">
      <section class="question-item" id="question" style="width:720px;min-height:220px;padding:16px;box-sizing:border-box">
        <div class="questionTit">1. Single-choice question</div>
        <div class="questionContent">What is two plus two?</div>
        <label><input name="q1" type="radio" value="A">A. 3</label>
        <label><input name="q1" type="radio" value="B">B. 4</label>
        <label><input name="q1" type="radio" value="C">C. 5</label>
        <label><input name="q1" type="radio" value="D">D. 6</label>
        <input name="answer" id="answer" autocomplete="off">
      </section>
      <button type="submit">Submit answers</button>
    </form><div style="height:1200px"></div>
    <script>
      window.__domSubmitCount = 0;
      window.__answerChangeCount = 0;
      document.getElementById('no-submit').addEventListener('submit',e => {
        e.preventDefault();window.__domSubmitCount++;
      });
      document.querySelectorAll('input').forEach(el =>
        el.addEventListener('change', () => { window.__answerChangeCount++; }));
    </script></body></html>`;
}

function successResponse(): string {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      questionType: "single_choice", answer: "B", confidence: 1,
      briefExplanation: "Four", detailedExplanation: "2 + 2 = 4",
      recognizedText: "1. What is two plus two? A. 3 B. 4 C. 5 D. 6",
    }) } }],
  });
}

async function probeServer() {
  const pending = new Map<ServerResponse, boolean>();
  let requested = 0;
  let released = false;
  let nativeSubmits = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__trap_submit") {
      nativeSubmits += 1;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("UNAUTHORIZED_SUBMISSION");
      return;
    }
    if (url.pathname === "/api/v1/chat/completions") {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      let stream = false;
      try { stream = (JSON.parse(body) as { stream?: boolean }).stream === true; }
      catch { res.writeHead(400); res.end("invalid request"); return; }
      requested += 1;
      const fulfill = () => {
        if (res.writableEnded || res.destroyed) return;
        if (stream) {
          const answer = JSON.parse(successResponse()) as { choices: Array<{ message: { content: string } }> };
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
          res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.choices[0].message.content } }] })}\n\ndata: [DONE]\n\n`);
        } else {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(successResponse());
        }
      };
      if (released) fulfill();
      else { pending.set(res, stream); res.on("close", () => pending.delete(res)); }
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(pageHtml());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("E3B2B2A probe port unavailable");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests: () => requested,
    pending: () => pending.size,
    nativeSubmits: () => nativeSubmits,
    release: () => {
      released = true;
      for (const [res, stream] of [...pending]) {
        if (res.writableEnded || res.destroyed) continue;
        const answer = JSON.parse(successResponse()) as { choices: Array<{ message: { content: string } }> };
        if (stream) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
          res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.choices[0].message.content } }] })}\n\ndata: [DONE]\n\n`);
        } else {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(successResponse());
        }
      }
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    },
  };
}

async function getWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function tabIdFor(worker: Worker, url: string): Promise<number> {
  const id = await worker.evaluate(async target =>
    (await chrome.tabs.query({ url: target }))[0]?.id ?? null, url);
  if (!id) throw Error("Exam tab not visible to extension");
  return id;
}

async function ownerGenerations(worker: Worker, tabId: number): Promise<string[]> {
  return worker.evaluate(async id => {
    const all = await chrome.storage.session.get(null);
    const prefix = `protectedWorkOwner:autoSolve:${id}:`;
    return Object.entries(all).filter(([key, value]) =>
      key.startsWith(prefix) && (value as { active?: boolean })?.active === true)
      .map(([key]) => key.slice(prefix.length)).sort();
  }, tabId);
}

async function answerState(page: Page) {
  return page.evaluate(() => ({
    text: (document.querySelector("#answer") as HTMLInputElement).value,
    selected: Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(x => x.checked).map(x => x.value),
    submits: (window as unknown as Window & { __domSubmitCount: number }).__domSubmitCount,
    changes: (window as unknown as Window & { __answerChangeCount: number }).__answerChangeCount,
  }));
}

test("@phase14b-e3b2b2a real held-provider reply after auth loss and account switch cannot fill old answers", async () => {
  test.setTimeout(150_000);
  const auth = await startTestAnalyticsBackend();
  const probe = await probeServer();
  let context: BrowserContext | undefined;
  try {
    const oldAccount = await auth.registerAccount("e3b2b2a-first");
    const nextAccount = await auth.registerAccount("e3b2b2a-second");
    context = await launchExtensionContext();
    await routeCanonicalOpenAIToFixture(context, probe.origin);
    const extensionId = await resolveExtensionId(context);
    const worker = await getWorker(context);
    const exam = await context.newPage();
    const examUrl = probe.origin + "/exam";
    await exam.goto(examUrl);
    const tabId = await tabIdFor(worker, examUrl);
    const baseline = await answerState(exam);
    expect(baseline).toEqual({ text: "", selected: [], submits: 0, changes: 0 });
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: auth.baseUrl, userId: oldAccount.userId,
      userEmail: oldAccount.email, authToken: oldAccount.authToken,
    });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
    await expect(panel.getByText(/^(工作台|Workspace)$/)).toBeVisible({ timeout: 25_000 });
    await seedAIConnection(panel, { presetId: "openai", selectedModelId: "gpt-5.5",
      credential: { action: "REPLACE", value: ["fixture", "e3b2b2a", "not-a-real-key"].join("-") } });
    await expect(panel.locator("[data-candidate-workspace]")).toBeVisible({ timeout: 25_000 });

    // First exercise the real viewport detection button. A scan-only owner
    // mark without an eligible candidate must not masquerade as AI execution.
    await panel.getByRole("group", { name: /^(候选题目操作|Candidate actions)$/ })
      .getByRole("button", { name: /^(当前屏|Current View)$/ }).click();
    await expect.poll(async () => {
      const state = await worker.evaluate(async ({ id, url }) =>
        chrome.tabs.sendMessage(id, { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: url }, { frameId: 0 }),
      { id: tabId, url: examUrl });
      return state.snapshot?.candidates?.length ?? 0;
    }, { timeout: 12_000 }).toBeGreaterThan(0);

    // User-visible button must start the production auto-solve runtime. Do not
    // seed owner records, bypass runtime START, or fake the provider request.
    await panel.getByRole("group", { name: /^(候选题目操作|Candidate actions)$/ })
      .getByRole("button", { name: /^(解析并填答|Solve & Fill)$/ }).click();
    await expect.poll(() => ownerGenerations(worker, tabId), { timeout: 20_000 }).toHaveLength(1);
    const [oldGeneration] = await ownerGenerations(worker, tabId);
    // Critical anti-vacuity gate: a real OpenAI-protocol request must be
    // received and held *before* authority is revoked.
    try {
      await expect.poll(() => probe.requests(), { timeout: 15_000 }).toBeGreaterThan(0);
    } catch {
      const state = await worker.evaluate(async ({ id, url }) =>
        chrome.tabs.sendMessage(id, { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: url }, { frameId: 0 }),
      { id: tabId, url: examUrl });
      const metadata = await panel.evaluate(() =>
        chrome.runtime.sendMessage({ type: "AI_CONNECTION_GET_ACTIVE_METADATA" }));
      const ui = await panel.locator("body").innerText();
      throw new Error("AI_REQUEST_NOT_OBSERVED: " + JSON.stringify({
        runtime: state.snapshot, metadata, ui: ui.slice(-1400),
      }).slice(0, 2900));
    }
    expect(probe.pending()).toBeGreaterThan(0);

    await auth.revokeSession(oldAccount.userId, oldAccount.authToken);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expect(popup.getByRole("button", { name: /^(发送验证码|Send Code|登录|Login)$/ }).first())
      .toBeVisible({ timeout: 25_000 });
    await expect.poll(async () => {
      const state = await readExtensionSettings(panel);
      return !state.authToken && !state.userId;
    }, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await ownerGenerations(worker, tabId)).includes(oldGeneration),
      { timeout: 20_000 }).toBe(false);

    // Real second server-issued account becomes authoritative on the same tab.
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: auth.baseUrl, userId: nextAccount.userId,
      userEmail: nextAccount.email, authToken: nextAccount.authToken,
    });
    await expect(panel.getByText(/^(工作台|Workspace)$/)).toBeVisible({ timeout: 25_000 });
    expect(await worker.evaluate(async ({ id, generationId }) =>
      chrome.tabs.sendMessage(id, { type: "STOP_AUTO_SOLVE_ALL", generationId }, { frameId: 0 }),
    { id: tabId, generationId: oldGeneration })).toEqual({ ok: false, error: "STALE_WORK_GENERATION" });

    // Deliver the valid-looking provider answer *after* the new login.
    // A cancelled HTTP request may already have closed; both abort and
    // resolved-late branches must be unable to mutate the page.
    probe.release();
    await exam.waitForTimeout(1100);
    expect(await ownerGenerations(worker, tabId)).not.toContain(oldGeneration);
    expect(await answerState(exam)).toEqual(baseline);
    expect(probe.nativeSubmits()).toBe(0);
  } finally {
    probe.release();
    if (context) await closeExtensionContext(context);
    await probe.close();
    await auth.close();
  }
});
