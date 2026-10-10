import { describe, expect, it, vi } from "vitest";
import { createCandidateWorkspaceRuntime } from "@/content/candidateWorkspaceRuntime";
import type { CandidateOrigin, CandidateWorkspaceSnapshot } from "@/shared/types";
import { createWorkspaceHydration } from "./workspaceHydration";
import { chooseWorkspaceOrigin } from "./workspaceTarget";
import { findActiveCandidateId } from "./activeCandidateIdentity";
import { initialSidePanelAppState, sidePanelAppReducer } from "./sidepanelAppState";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function fixture(overrides: Partial<CandidateWorkspaceSnapshot> = {}): CandidateWorkspaceSnapshot {
  const runtime = createCandidateWorkspaceRuntime({ url: () => "https://quiz.example/exam", send: vi.fn(), runtimeInstanceId: "r1", runtimeGeneration: 1 });
  return { ...runtime.snapshot("https://quiz.example/exam").snapshot!, ...overrides };
}
function harness(initial = fixture()) {
  let authenticated = true;
  let origin: CandidateOrigin | null = { tabId: 7, url: initial.originUrl };
  const response = deferred<unknown>();
  const publish = vi.fn();
  const request = vi.fn(() => response.promise);
  const c = createWorkspaceHydration({ isAuthenticated: () => authenticated, resolveOrigin: async () => origin, readOrigin: async () => origin, request, publish });
  return { c, response, publish, request, origin: () => origin!, authLoss: () => { authenticated = false; c.invalidate(); }, route: (url: string) => { origin = { tabId: 7, url }; }, missing: () => { origin = null; },
    event: (s: CandidateWorkspaceSnapshot, tabId = 7) => c.observe({ type: "CANDIDATE_WORKSPACE_UPDATED", snapshot: s }, { tab: { id: tabId, url: s.originUrl }, frameId: 0 } as chrome.runtime.MessageSender),
    last: () => publish.mock.calls[publish.mock.calls.length - 1] };
}

describe("UI-04A Side Panel opening fence", () => {
  it("UI04A-01 restores running state during an unresolved provider await without any future event", async () => {
    const provider = deferred<void>();
    const runtime = createCandidateWorkspaceRuntime({ url: () => "https://quiz.example/exam", send: vi.fn(), runtimeInstanceId: "r1", runtimeGeneration: 1 });
    runtime.setAutoSolveRunning(true);
    const inProgress = provider.promise.then(() => runtime.setAutoSolveRunning(false));
    const s = runtime.snapshot("https://quiz.example/exam").snapshot!;
    const h = harness(s);
    const opening = h.c.sync();
    h.response.resolve({ ok: true, snapshot: s });
    await opening;
    expect(h.last()?.[0]).toBe("ready");
    expect(h.last()?.[1].autoSolve.running).toBe(true);
    provider.resolve(); await inProgress;
  });
  it("UI04A-04/05 newer live progress wins over a late opening snapshot", async () => {
    const h = harness();
    const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    h.event(fixture({ seq: 9, autoSolve: { running: true, progress: null } }));
    h.event(fixture({ seq: 8 }));
    h.response.resolve({ ok: true, snapshot: fixture({ seq: 2 }) });
    await opening;
    expect(h.last()?.[1].seq).toBe(9);
    expect(h.last()?.[1].autoSolve.running).toBe(true);
  });
  it("UI04A-06 completion wins over a late running snapshot", async () => {
    const h = harness(); const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    h.event(fixture({ seq: 4, autoSolve: { running: false, progress: null } }));
    h.response.resolve({ ok: true, snapshot: fixture({ seq: 3, autoSolve: { running: true, progress: null } }) });
    await opening;
    expect(h.last()?.[1].autoSolve.running).toBe(false);
  });
  it("UI04A-07/19 route change invalidates old snapshot even when its seq is larger", async () => {
    const h = harness(); const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    const next = fixture({ originUrl: "https://quiz.example/next", routeEpoch: 1, seq: 1 });
    h.route(next.originUrl);
    h.request.mockImplementationOnce(async () => ({ ok: true, snapshot: next }));
    h.event(next);
    h.response.resolve({ ok: true, snapshot: fixture({ seq: 999 }) });
    await opening;
    await vi.waitFor(() => expect(h.last()?.[1]?.originUrl).toBe(next.originUrl));
    h.event(fixture({ seq: 1000 }));
    expect(h.last()?.[1]?.originUrl).toBe(next.originUrl);
  });
  it("UI04A-08 replacement runtime invalidates an old opening result", async () => {
    const h = harness(); const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    const next = fixture({ runtimeInstanceId: "r2", runtimeGeneration: 2, seq: 1 });
    h.request.mockImplementationOnce(async () => ({ ok: true, snapshot: next }));
    h.event(next);
    h.response.resolve({ ok: true, snapshot: fixture({ seq: 100 }) });
    await opening;
    await vi.waitFor(() => expect(h.last()?.[1]?.runtimeInstanceId).toBe("r2"));
    h.event(fixture({ seq: 999 }));
    expect(h.last()?.[1]?.runtimeInstanceId).toBe("r2");
  });
  it("UI04A-09 isolates Tab B from Tab A's protected candidates and progress", async () => {
    const h = harness(); const opening = h.c.sync();
    h.response.resolve({ ok: true, snapshot: fixture() }); await opening;
    const calls = h.publish.mock.calls.length;
    h.event(fixture({ runtimeInstanceId: "tabA", seq: 40, autoSolve: { running: true, progress: null } }), 9);
    expect(h.publish).toHaveBeenCalledTimes(calls);
    expect(h.last()?.[2].tabId).toBe(7);
  });
  it("UI04A-08 ignores a delayed older document-local runtime generation", async () => {
    const h = harness();
    h.response.resolve({ ok: true, snapshot: fixture({ runtimeInstanceId: "replacement", runtimeGeneration: 2, seq: 4 }) });
    await h.c.sync();
    const count = h.publish.mock.calls.length;
    h.event(fixture({ runtimeInstanceId: "old", runtimeGeneration: 1, seq: 999 }));
    expect(h.publish).toHaveBeenCalledTimes(count);
    expect(h.last()?.[1].runtimeInstanceId).toBe("replacement");
  });
  it.each([null, { ok: false }, { ok: true, snapshot: { ...fixture(), protocolVersion: 2 } }, { ok: true, snapshot: { ...fixture(), seq: -1 } }])("UI04A-10 unavailable/invalid snapshot never fabricates Ready (%j)", async (response) => {
    const h = harness(); const opening = h.c.sync(); h.response.resolve(response); await opening;
    expect(h.last()?.[0]).toBe("runtime_unavailable");
    expect(h.publish.mock.calls.some(([status]) => status === "ready")).toBe(false);
  });
  it("RC03D-B1 rehydrates using a same-origin live snapshot when the transport request fails", async () => {
    const h = harness();
    const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    const live = fixture({ seq: 6, fullPage: { running: true, progress: null } });
    h.event(live);
    h.response.resolve(null);
    await opening;
    expect(h.last()?.[0]).toBe("ready");
    expect(h.last()?.[1].seq).toBe(6);
    expect(h.last()?.[1].fullPage.running).toBe(true);
    // Fail-closed: none of these events grant new protected work authority.
  });

  it("RC03D-B2 never recovers from an unrelated tab or different URL event", async () => {
    const h = harness();
    const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    h.event(fixture({ seq: 5 }), 9);
    h.event(fixture({ originUrl: "https://quiz.example/elsewhere", seq: 6 }), 9);
    h.response.resolve(null);
    await opening;
    expect(h.last()?.[0]).toBe("runtime_unavailable");
    expect(h.publish.mock.calls.some(([status]) => status === "ready")).toBe(false);
  });

  it("RC03D-B3 refuses to guess when competing runtime generations broadcast during failed sync", async () => {
    const h = harness();
    const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    h.event(fixture({ seq: 3, runtimeInstanceId: "r1", runtimeGeneration: 1 }));
    h.event(fixture({ seq: 1, runtimeInstanceId: "r2", runtimeGeneration: 2 }));
    h.response.resolve(null);
    await opening;
    expect(h.last()?.[0]).toBe("runtime_unavailable");
  });

  it("RC03D-B4 an invalid domain response cannot be rescued by a live event", async () => {
    const h = harness();
    const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    h.event(fixture({ seq: 8 }));
    h.response.resolve({ ok: true, snapshot: { ...fixture(), protocolVersion: 999 } });
    await opening;
    expect(h.last()?.[0]).toBe("runtime_unavailable");
  });

  it("RC03D-B5 auth loss or navigation while awaiting transport denies buffered recovery", async () => {
    const h = harness();
    const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    h.event(fixture({ seq: 9 }));
    h.route("https://quiz.example/new");
    h.response.resolve(null);
    await opening;
    expect(h.last()?.[0]).toBe("runtime_unavailable");

    const h2 = harness();
    const pending = h2.c.sync();
    await vi.waitFor(() => expect(h2.request).toHaveBeenCalledOnce());
    h2.event(fixture({ seq: 10 }));
    h2.authLoss();
    h2.response.resolve(null);
    await pending;
    expect(h2.last()).toEqual(["idle"]);
  });

  it("RC03D-B7 retires the previous runtime after verified event-only recovery", async () => {
    const h = harness();
    const opening = h.c.sync();
    h.response.resolve({ ok: true, snapshot: fixture({ seq: 10, runtimeInstanceId: "old", runtimeGeneration: 1 }) });
    await opening;
    const second = deferred<unknown>();
    h.request.mockImplementationOnce(() => second.promise);
    const retry = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    h.event(fixture({ seq: 1, runtimeInstanceId: "replacement", runtimeGeneration: 2 }));
    second.resolve(null);
    await retry;
    expect(h.last()?.[1].runtimeInstanceId).toBe("replacement");
    const count = h.publish.mock.calls.length;
    // Even a forged high generation from the retired ID cannot regain control.
    h.event(fixture({ seq: 99, runtimeInstanceId: "old", runtimeGeneration: 3 }));
    expect(h.publish).toHaveBeenCalledTimes(count);
    expect(h.last()?.[1].runtimeInstanceId).toBe("replacement");
  });

  it("RC03D-B6 stale same-runtime updates cannot override the previous high-water mark on retry", async () => {
    const h = harness();
    const opening = h.c.sync();
    h.response.resolve({ ok: true, snapshot: fixture({ seq: 20 }) });
    await opening;
    const retry = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    // An older event is rejected by the observed high-water mark.
    h.event(fixture({ seq: 19 }));
    await retry;
    expect(h.last()?.[0]).toBe("ready");
    expect(h.last()?.[1].seq).toBe(20);
  });

  it("UI04A-11 auth loss invalidates an awaiting hydration and cannot unlock", async () => {
    const h = harness(); const opening = h.c.sync();
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce());
    h.authLoss(); h.response.resolve({ ok: true, snapshot: fixture() }); await opening;
    expect(h.last()).toEqual(["idle"]);
    h.event(fixture({ seq: 4 }));
    expect(h.last()).toEqual(["idle"]);
  });
  it("UI04A-20 lower/equal seq is ignored while newer same-URL route epoch wins", async () => {
    const h = harness(); const opening = h.c.sync(); h.response.resolve({ ok: true, snapshot: fixture({ seq: 10 }) }); await opening;
    const count = h.publish.mock.calls.length;
    h.event(fixture({ seq: 10 })); h.event(fixture({ seq: 9 }));
    expect(h.publish).toHaveBeenCalledTimes(count);
    h.event(fixture({ routeEpoch: 1, seq: 1 }));
    h.event(fixture({ routeEpoch: 0, seq: 999 }));
    expect(h.last()?.[1].routeEpoch).toBe(1);
  });
  it("UI04A-ORIGIN resolver is deterministic and fails closed on ambiguous tabs", () => {
    expect(chooseWorkspaceOrigin([{ id: 1, url: "chrome://settings", active: true }])).toBeNull();
    const a = { id: 1, url: "https://quiz.example/exam-hub/a", active: false };
    const b = { id: 2, url: "https://quiz.example/exam-hub/b", active: false };
    expect(chooseWorkspaceOrigin([a, b])).toBeNull();
    expect(chooseWorkspaceOrigin([b, a])).toBeNull();
    expect(chooseWorkspaceOrigin([a, { ...b, active: true }])).toEqual({ tabId: 2, url: b.url });
    expect(chooseWorkspaceOrigin([{ ...a, lastAccessed: 10 }, { ...b, lastAccessed: 20 }])).toEqual({ tabId: 2, url: b.url });
    expect(chooseWorkspaceOrigin([{ ...a, lastAccessed: 20 }, { ...b, lastAccessed: 20 }])).toBeNull();
    expect(chooseWorkspaceOrigin([{ ...a, active: true }, { ...b, active: true, lastAccessed: 20 }])).toBeNull();
  });
  it("UI04A-20 a retry cannot revive a lower tuple already observed before its request", async () => {
    const h = harness();
    h.response.resolve({ ok: true, snapshot: fixture({ seq: 1 }) });
    await h.c.sync();
    h.event(fixture({ seq: 8, autoSolve: { running: true, progress: null } }));
    await h.c.sync();
    expect(h.last()?.[0]).toBe("ready");
    expect(h.last()?.[1].seq).toBe(8);
    expect(h.last()?.[1].autoSolve.running).toBe(true);
  });
  it("UI04A-RESULT content success has no panel result, solved count or fill authority", () => {
    const s = fixture({ candidates: [{ block: { id: "q1", previewText: "Q" } as never, selected: true, status: "success" }] });
    const state = sidePanelAppReducer(initialSidePanelAppState, { type: "hydrateWorkspace", status: "ready", snapshot: s, origin: { tabId: 7, url: s.originUrl } });
    expect(state.candidates[0]?.status).toBe("idle");
    expect(state.candidates[0]?.result).toBeUndefined();
  });
  it("UI04A-13/14 missing/ambiguous/conflicting active identity has no highlight", () => {
    const origin = { tabId: 7, url: "https://quiz.example/exam" };
    const block = { id: "q1", identity: { stableId: "s1", contentFingerprint: "f1" } } as never;
    const candidate = { block, origin, status: "idle" as const, selected: false };
    expect(findActiveCandidateId([candidate], origin, "q1", block)).toBe("q1");
    expect(findActiveCandidateId([candidate], origin, undefined, block)).toBeNull();
    expect(findActiveCandidateId([candidate], origin, "q1", undefined)).toBeNull();
    expect(findActiveCandidateId([candidate, candidate], origin, "q1", block)).toBeNull();
    expect(findActiveCandidateId([candidate], origin, "q2", block)).toBeNull();
    expect(findActiveCandidateId([candidate], { ...origin, tabId: 8 }, "q1", block)).toBeNull();
  });
});
